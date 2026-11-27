import { asText, bookingRef, withRef, type AuditContext, type AuditRule } from './audit-actions';

const ID = '([^/]+)';
const DECISIONS: Record<string, string> = { approve: 'Approved', reject: 'Rejected', withdraw: 'Withdrew', resubmit: 'Resubmitted' };

function approvalItem(type: string, ctx: AuditContext) {
  if (type === 'collection') return 'collection';
  if (type === 'refund') return 'refund request';
  if (type === 'crew') {
    const kind = asText(ctx.result.kind) === 'EMERGENCY' ? 'crew emergency' : 'crew leave request';
    const name = asText(ctx.result.crewName);
    return name ? `${kind} for ${name}` : kind;
  }
  const change = asText(ctx.result.type) ?? asText(ctx.result.subtype);
  return change === 'cancel' ? 'cancellation request' : change === 'reschedule' ? 'reschedule request' : 'reschedule/cancellation request';
}

function catalog(segment: string, noun: string): AuditRule[] {
  const named = (ctx: AuditContext) => asText(ctx.result.name) ?? asText(ctx.body.name);
  return [
    { method: 'POST', pattern: new RegExp(`^/bms/config/${segment}$`), label: (ctx) => withRef(`Created ${noun}`, named(ctx)) },
    { method: 'PATCH', pattern: new RegExp(`^/bms/config/${segment}/${ID}$`), label: (ctx) => withRef(`Updated ${noun}`, named(ctx)) },
    { method: 'DELETE', pattern: new RegExp(`^/bms/config/${segment}/${ID}$`), label: (ctx) => withRef(`Deleted ${noun}`, named(ctx)) },
  ];
}

export const AUDIT_RULES: AuditRule[] = [
  // Reading notifications (spec bms/0021) changes nothing worth an activity log line.
  { method: 'POST', pattern: /^\/notifications(\/|$)/, label: () => null },
  // Distance lookups while filling in the booking form change nothing.
  { method: 'POST', pattern: /^\/booking\/route$/, label: () => null },
  { method: 'POST', pattern: /^\/booking$/, label: (ctx) => withRef('Created booking', bookingRef(ctx)) },
  { method: 'PUT', pattern: new RegExp(`^/booking/${ID}/details$`), label: (ctx) => withRef('Updated booking details', bookingRef(ctx)) },
  {
    method: 'PUT', pattern: new RegExp(`^/booking/${ID}$`), label: (ctx) => {
      const status = asText(ctx.body.status);
      return withRef(status ? `Updated booking status to ${status}` : 'Updated booking', bookingRef(ctx));
    },
  },
  {
    method: 'POST', pattern: new RegExp(`^/booking/${ID}/change-requests$`), label: (ctx) =>
      withRef(ctx.body.type === 'cancel' ? 'Requested booking cancellation' : 'Requested booking reschedule', bookingRef(ctx)),
  },
  {
    method: 'POST', pattern: new RegExp(`^/approvals/(booking|collection|refund|crew)/${ID}/(approve|reject|withdraw|resubmit)$`), label: (ctx) => {
      const [type, , decision] = ctx.params;
      return withRef(`${DECISIONS[decision]} ${approvalItem(type, ctx)}`, bookingRef(ctx));
    },
  },
  ...catalog('booking-services', 'booking service'),
  ...catalog('services-offered', 'service offered'),
  ...catalog('protective-materials', 'protective material'),
  {
    method: 'POST', pattern: new RegExp(`^/integrations/(?:welinc|wix)/review/${ID}$`), label: (ctx) =>
      ctx.body.action === 'dismiss' ? 'Reviewed incoming booking update (dismissed)'
        : ctx.body.action === 'apply' ? 'Reviewed incoming booking update (applied)'
          : 'Reviewed incoming booking update',
  },
];
