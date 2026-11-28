import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { BookingClient, BookingRecord } from '../booking-client.service';
import { DispatchClient } from '../dispatch-client.service';
import { queueNotifications } from '../notifications/notification-outbox';
import { postServiceReadyNotices } from '../notifications/completion-notices';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The mobile app's payment choices, as the web's Daily Sales names them (spec bms/0022). */
const REPORTED_PAYMENT: Record<string, string> = { CASH: 'Cash', BANK_TRANSFER: 'BDO', GCASH: 'GCash', XENDIT: 'Xendit' };
const REPORTED_ADD_ON_PAYMENT: Record<string, string> = { ...REPORTED_PAYMENT, COD: 'Cash', UNPAID: 'Unpaid' };

/** What a driver's form adds to a save, besides the shared post-service fields. */
type TeamSubmission = {
  baseVersion: string | null; submittedAt: Date | null;
  reportedPaymentMethod: string | null; reportedAddOnPayment: string | null;
};

/**
 * Who is saving. `web`: Customer Support or Admin on the Post-Service page. `team`: the assigned
 * driver from the mobile app. `retry`: Admin re-sending a stuck completion; it changes no owner.
 */
type SaveSource = { kind: 'web' } | { kind: 'retry' } | { kind: 'team'; submission: TeamSubmission };

const changedByOffice = (current: unknown) => new ConflictException({
  code: 'POST_SERVICE_CHANGED', message: 'The office updated this record. Check it and submit again if needed.', current,
});

function optionalText(value: unknown, name: string, max: number): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw new BadRequestException(`Invalid ${name}`);
  return value.trim() || null;
}

@Injectable()
export class WorkService {
  constructor(private readonly prisma: PrismaService, private readonly bookings: BookingClient, private readonly dispatch: DispatchClient) {}

  private isCancelled(booking: BookingRecord) {
    return /^cancelled?$/i.test(String(booking.status).trim());
  }

  private async ensurePostServiceReady(bookingId: string) {
    const ready = await this.dispatch.postServiceReadyBookingUuids();
    if (!ready.includes(bookingId)) {
      throw new ConflictException('Post-service is available after the booking is assigned, required dispatch details are complete, and the job order is distributed');
    }
  }

  private ensureNotCancelled(booking: BookingRecord) {
    if (this.isCancelled(booking)) {
      throw new ConflictException('Cancelled bookings cannot proceed through post-service');
    }
  }

  private async format(booking: BookingRecord) {
    const [outcome, collections] = await Promise.all([
      this.prisma.workOutcome.findUnique({ where: { bookingUuid: booking.id } }),
      this.prisma.collection.findMany({ where: { bookingUuid: booking.id, status: 'VERIFIED' } }),
    ]);
    const refunds = collections.length ? await this.prisma.refund.findMany({
      where: { collectionId: { in: collections.map((item) => item.id) }, projectionState: 'SYNCED' },
    }) : [];
    const paid = collections.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0) -
      refunds.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0);
    const due = booking.amount === null ? null : Math.round(Number(booking.amount) * 100);
    const downpayment = booking.downpayment == null ? 0 : Math.round(Number(booking.downpayment) * 100);
    const settled = paid + downpayment;
    return {
      bookingId: booking.bookingId, bookingNo: booking.bookingNo, client: booking.client,
      service: booking.service, date: booking.date, status: booking.status,
      amount: booking.amount === null ? null : Number(booking.amount),
      paymentStatus: settled === 0 ? 'Pending' : due !== null && settled >= due ? 'Paid' : 'Partial',
      amountPaid: paid / 100, downpayment: downpayment / 100,
      remainingBalance: due === null ? null : Math.max(0, due - settled) / 100, paymentMethod: collections.at(-1)?.method ?? null,
      protectiveMaterials: booking.protectiveMaterials,
      postServiceStatus: outcome?.postServiceStatus ?? 'Pending Review',
      arrivalTime: outcome?.arrivalTime ?? null, additionalMaterials: outcome?.additionalMaterials ?? [],
      issueReported: outcome?.issueReported ?? false, issueDetails: outcome?.issueDetails ?? null,
      completionNotes: outcome?.completionNotes ?? null, finalizedAt: outcome?.finalizedAt ?? null,
      finalizedBy: outcome?.finalizedBy ?? null,
    };
  }

  async list() {
    const [bookings, readyUuids, submittedWork] = await Promise.all([
      this.bookings.list(),
      this.dispatch.postServiceReadyBookingUuids(),
      this.prisma.workOutcome.findMany({
        where: { status: 'COMPLETED', arrivalTime: { not: null } },
        select: { bookingUuid: true, arrivalTime: true, issueReported: true, issueDetails: true },
      }),
    ]);
    const ready = new Set(readyUuids);
    const submitted = new Set(submittedWork
      .filter((work) => work.arrivalTime?.trim() && (!work.issueReported || work.issueDetails?.trim()))
      .map((work) => work.bookingUuid));
    return Promise.all(bookings.filter((item) =>
      ready.has(item.id) && submitted.has(item.id) && !this.isCancelled(item),
    ).map((item) => this.format(item)));
  }

  async get(id: string) {
    const booking = await this.bookings.resolve(id);
    this.ensureNotCancelled(booking);
    await this.ensurePostServiceReady(booking.id);
    return this.format(booking);
  }

  async pending() {
    const outcomes = await this.prisma.workOutcome.findMany({ where: { status: 'PENDING' }, orderBy: { updatedAt: 'desc' } });
    const activeOutcomes = await Promise.all(outcomes.map(async (outcome) => ({
      outcome,
      booking: await this.bookings.get(outcome.bookingUuid),
    })));
    return activeOutcomes
      .filter(({ booking }) => !this.isCancelled(booking))
      .map(({ outcome }) => outcome);
  }

  async retry(id: string, actor: string) {
    const outcome = await this.prisma.workOutcome.findUnique({ where: { bookingUuid: id } });
    if (!outcome) throw new NotFoundException('Work outcome not found');
    if (outcome.status !== 'PENDING') throw new ConflictException('Only pending work confirmation can be retried');
    return this.save(id, {
      status: 'Completed', postServiceStatus: outcome.postServiceStatus, arrivalTime: outcome.arrivalTime,
      additionalMaterials: outcome.additionalMaterials, issueReported: outcome.issueReported,
      issueDetails: outcome.issueDetails, completionNotes: outcome.completionNotes,
    }, actor, { kind: 'retry' });
  }

  async upsert(id: string, input: Record<string, unknown>, actor: string) {
    if (['paymentStatus', 'paymentMethod', 'amountPaid'].some((field) => input[field] !== undefined)) {
      throw new BadRequestException('Work completion cannot record a payment; use Collections');
    }
    return this.save(id, input, actor, { kind: 'web' });
  }

  /**
   * The post-service state of every booking this driver is assigned to, for the mobile app: whether a
   * form was sent, whether the office finalized it, and its `version` (spec bms/0022).
   */
  async teamStatus(actor: string) {
    const bookingUuids = await this.dispatch.driverBookingUuids(actor);
    const outcomes = bookingUuids.length
      ? await this.prisma.workOutcome.findMany({ where: { bookingUuid: { in: bookingUuids } } })
      : [];
    const byBooking = new Map(outcomes.map((item) => [item.bookingUuid, item]));
    return {
      items: bookingUuids.map((bookingUuid) => {
        const outcome = byBooking.get(bookingUuid);
        return {
          bookingUuid,
          submitted: !!outcome && outcome.status !== 'DRAFT',
          finalized: outcome?.postServiceStatus === 'Finalized',
          version: outcome?.updatedAt.toISOString() ?? null,
        };
      }),
    };
  }

  /** The record as the driver's app sees it: the web's view, the driver's report, the lock and the version. */
  private async teamView(booking: BookingRecord) {
    const [base, outcome] = await Promise.all([
      this.format(booking),
      this.prisma.workOutcome.findUnique({ where: { bookingUuid: booking.id } }),
    ]);
    return {
      ...base, bookingUuid: booking.id,
      reportedPaymentMethod: outcome?.reportedPaymentMethod ?? null,
      reportedAddOnPayment: outcome?.reportedAddOnPayment ?? null,
      submittedAt: outcome?.submittedAt?.toISOString() ?? null,
      postServiceLocked: outcome?.postServiceStatus === 'Finalized',
      version: outcome?.updatedAt.toISOString() ?? null,
    };
  }

  /**
   * A driver's post-service form from the mobile app (spec bms/0022). Only the assigned driver may
   * send it. It never makes the driver the finalizer, and it is refused when the office finalized
   * the record or changed it after the copy the phone was editing.
   */
  async submitFromTeam(bookingUuid: string, body: Record<string, unknown>, actor: string) {
    if (!UUID.test(bookingUuid)) throw new BadRequestException('Invalid booking ID');
    if (!(await this.dispatch.driverBookingUuids(actor)).includes(bookingUuid)) {
      throw new ForbiddenException("This job order isn't assigned to you as driver");
    }
    const addOns = body.addOns ?? [];
    if (!Array.isArray(addOns) || addOns.length > 50 || addOns.some((item) => typeof item !== 'string' || !item.trim() || item.length > 150)) {
      throw new BadRequestException('Invalid add-ons');
    }
    if (body.serviceCompleted !== undefined && typeof body.serviceCompleted !== 'boolean' ||
      body.issueReported !== undefined && typeof body.issueReported !== 'boolean') {
      throw new BadRequestException('Invalid work completion details');
    }
    const paymentMethod = body.paymentMethod == null ? null : REPORTED_PAYMENT[String(body.paymentMethod)];
    const addOnPayment = body.addOnPayment == null ? null : REPORTED_ADD_ON_PAYMENT[String(body.addOnPayment)];
    if (paymentMethod === undefined || addOnPayment === undefined) throw new BadRequestException('Invalid payment method');
    const submittedAt = body.submittedAt == null ? null : new Date(String(body.submittedAt));
    if (submittedAt && !Number.isFinite(submittedAt.getTime())) throw new BadRequestException('Invalid submission time');
    if (body.baseVersion != null && typeof body.baseVersion !== 'string') throw new BadRequestException('Invalid version');
    const issueReported = body.issueReported === true;
    const done = body.serviceCompleted === true || issueReported;
    return this.save(bookingUuid, {
      ...(done && { status: 'Completed' }),
      postServiceStatus: done ? 'Completed' : 'Pending Review',
      arrivalTime: optionalText(body.arrivalTime, 'arrival time', 20),
      additionalMaterials: (addOns as string[]).map((item) => item.trim()),
      completionNotes: optionalText(body.completionNotes, 'completion notes', 5000),
      issueReported,
      issueDetails: optionalText(body.issueDetails, 'issue details', 5000),
    }, actor, { kind: 'team', submission: {
      baseVersion: (body.baseVersion as string | null | undefined) ?? null, submittedAt,
      reportedPaymentMethod: paymentMethod, reportedAddOnPayment: addOnPayment,
    } });
  }

  private async save(id: string, input: Record<string, unknown>, actor: string, source: SaveSource) {
    const booking = await this.bookings.resolve(id);
    this.ensureNotCancelled(booking);
    await this.ensurePostServiceReady(booking.id);
    const completionNotes = input.completionNotes == null ? null : String(input.completionNotes).trim();
    const issueReported = input.issueReported === true;
    const issueDetails = input.issueDetails == null ? null : String(input.issueDetails).trim();
    const arrivalTime = input.arrivalTime == null ? null : String(input.arrivalTime);
    const additionalMaterials = input.additionalMaterials ?? [];
    if (completionNotes && completionNotes.length > 5000 || issueDetails && issueDetails.length > 5000 ||
      issueReported && !issueDetails || !Array.isArray(additionalMaterials) || additionalMaterials.some((item) => typeof item !== 'string') ||
      arrivalTime && !/^(?:([01]\d|2[0-3]):[0-5]\d|(?:0?[1-9]|1[0-2]):[0-5]\d\s*(?:AM|PM))$/i.test(arrivalTime)) {
      throw new BadRequestException('Invalid work completion details');
    }
    const complete = input.status === 'Completed' || input.postServiceStatus === 'Completed' || input.postServiceStatus === 'Issue Reported' || booking.status === 'Completed';
    const existing = await this.prisma.workOutcome.findUnique({ where: { bookingUuid: booking.id } });
    const team = source.kind === 'team' ? source.submission : null;
    if (team && existing) {
      if (existing.postServiceStatus === 'Finalized') {
        throw new ConflictException({ code: 'POST_SERVICE_FINALIZED', message: 'Finalized by office' });
      }
      // A retry of the driver's own last save passes even with an old version (its reply was lost).
      if (team.baseVersion !== existing.updatedAt.toISOString() && existing.lastEditedBy !== actor) {
        throw changedByOffice(await this.teamView(booking));
      }
    }
    if (existing?.status === 'COMPLETED' && !complete) throw new ConflictException('Completed work cannot be reopened through this form');
    const requestedPostServiceStatus = String(input.postServiceStatus ?? 'Pending Review');
    const postServiceStatus = issueReported
      ? 'Issue Reported'
      : requestedPostServiceStatus === 'Finalized' || existing?.postServiceStatus === 'Finalized'
        ? 'Finalized'
        : complete
          ? 'Completed'
          : requestedPostServiceStatus;
    const commandId = existing?.confirmCommandId ?? (complete ? randomUUID() : null);
    // Only the web save makes someone the finalizer; Daily Sales drafts belong to that person
    // (spec bms/0022). A driver's form or an Admin retry leaves it as it was.
    const finalizes = complete && source.kind === 'web';
    const fields = {
      postServiceStatus, arrivalTime, additionalMaterials: additionalMaterials as string[],
      issueReported, issueDetails, completionNotes,
      ...(source.kind !== 'retry' && { lastEditedBy: actor }),
      ...(team && { submittedBy: actor, submittedAt: team.submittedAt,
        reportedPaymentMethod: team.reportedPaymentMethod, reportedAddOnPayment: team.reportedAddOnPayment }),
    };
    const update = {
      ...fields,
      ...(complete && { confirmCommandId: commandId,
        bookingVersion: existing?.status === 'PENDING' ? existing.bookingVersion : booking.version }),
      ...(finalizes && { finalizedBy: actor, finalizedAt: new Date() }),
    };
    if (team && existing) {
      // Saved only if nobody changed the record since it was read above.
      const { count } = await this.prisma.workOutcome.updateMany({
        where: { bookingUuid: booking.id, updatedAt: existing.updatedAt }, data: update,
      });
      if (!count) throw changedByOffice(await this.teamView(booking));
    } else {
      await this.prisma.workOutcome.upsert({ where: { bookingUuid: booking.id }, create: {
        bookingUuid: booking.id, bookingIdAlias: booking.bookingId, bookingNo: booking.bookingNo,
        client: booking.client, service: booking.service, serviceDate: booking.date,
        amountDue: booking.amount === null ? null : String(booking.amount),
        status: complete ? 'PENDING' : 'DRAFT', ...fields,
        finalizedBy: finalizes ? actor : null, finalizedAt: finalizes ? new Date() : null,
        confirmCommandId: commandId, bookingVersion: complete ? booking.version : null,
      }, update });
    }
    if (complete && existing?.status !== 'COMPLETED') {
      let outcome = await this.prisma.workOutcome.findUniqueOrThrow({ where: { bookingUuid: booking.id } });
      try {
        try {
          await this.bookings.command(booking.id, {
            commandId: outcome.confirmCommandId, expectedVersion: outcome.bookingVersion,
            kind: 'ConfirmWorkCompletion',
          });
        } catch (error) {
          if (!(error instanceof ConflictException)) throw error;
          const current = await this.bookings.get(booking.id);
          if (current.status !== 'Assigned') throw error;
          outcome = await this.prisma.workOutcome.update({ where: { bookingUuid: booking.id }, data: {
            confirmCommandId: randomUUID(), bookingVersion: current.version,
          } });
          await this.bookings.command(booking.id, {
            commandId: outcome.confirmCommandId, expectedVersion: outcome.bookingVersion,
            kind: 'ConfirmWorkCompletion',
          });
        }
      } catch (error) {
        await this.prisma.workOutcome.update({ where: { bookingUuid: booking.id }, data: {
          lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown error',
        } });
        throw new ServiceUnavailableException('Work completion is pending Booking confirmation; retry');
      }
      await this.prisma.$transaction(async (tx) => {
        const done = await tx.workOutcome.update({ where: { bookingUuid: booking.id }, data: { status: 'COMPLETED', lastError: null } });
        await queueNotifications(tx, postServiceReadyNotices({ ...done, bookingUuid: booking.id }));
      });
    }
    return team ? this.teamView(await this.bookings.get(booking.id)) : this.get(booking.id);
  }
}
