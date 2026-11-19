import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { BookingClient, BookingRecord } from '../booking-client.service';
import { DispatchClient } from '../dispatch-client.service';

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
    return this.upsert(id, {
      status: 'Completed', postServiceStatus: outcome.postServiceStatus, arrivalTime: outcome.arrivalTime,
      additionalMaterials: outcome.additionalMaterials, issueReported: outcome.issueReported,
      issueDetails: outcome.issueDetails, completionNotes: outcome.completionNotes,
    }, actor);
  }

  async upsert(id: string, input: Record<string, unknown>, actor: string) {
    if (['paymentStatus', 'paymentMethod', 'amountPaid'].some((field) => input[field] !== undefined)) {
      throw new BadRequestException('Work completion cannot record a payment; use Collections');
    }
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
    await this.prisma.workOutcome.upsert({ where: { bookingUuid: booking.id }, create: {
      bookingUuid: booking.id, bookingIdAlias: booking.bookingId, bookingNo: booking.bookingNo,
      client: booking.client, service: booking.service, serviceDate: booking.date,
      amountDue: booking.amount === null ? null : String(booking.amount),
      status: complete ? 'PENDING' : 'DRAFT', postServiceStatus, arrivalTime,
      additionalMaterials: additionalMaterials as string[], issueReported, issueDetails, completionNotes,
      finalizedBy: complete ? actor : null, finalizedAt: complete ? new Date() : null,
      confirmCommandId: commandId, bookingVersion: complete ? booking.version : null,
    }, update: {
      postServiceStatus, arrivalTime, additionalMaterials: additionalMaterials as string[],
      issueReported, issueDetails, completionNotes,
      ...(complete && { finalizedBy: actor, finalizedAt: new Date(), confirmCommandId: commandId,
        bookingVersion: existing?.status === 'PENDING' ? existing.bookingVersion : booking.version }),
    } });
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
      await this.prisma.workOutcome.update({ where: { bookingUuid: booking.id }, data: { status: 'COMPLETED', lastError: null } });
    }
    return this.get(booking.id);
  }
}
