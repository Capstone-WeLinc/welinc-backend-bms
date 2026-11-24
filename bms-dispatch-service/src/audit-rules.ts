import { asObject, asText, bookingRef, withRef, type AuditContext, type AuditRule } from './audit-actions';

const ID = '([^/]+)';

/** Crew are never created or deleted in BMS any more, only edited (spec bms/0012). */
function person(segment: 'drivers' | 'helpers', noun: string): AuditRule[] {
  const named = (ctx: AuditContext) => asText(ctx.result.fullName) ?? asText(ctx.body.fullName) ?? asText(ctx.result.name) ?? asText(ctx.body.name);
  return [
    {
      method: 'PATCH', pattern: new RegExp(`^/bms/config/${segment}/${ID}/status$`), label: (ctx) => {
        const status = asText(ctx.body.status);
        return withRef(status ? `Updated ${noun} status to ${status}` : `Updated ${noun} status`, named(ctx));
      },
    },
    { method: 'PATCH', pattern: new RegExp(`^/bms/config/${segment}/${ID}$`), label: (ctx) => withRef(`Updated ${noun}`, named(ctx)) },
  ];
}

export const AUDIT_RULES: AuditRule[] = [
  {
    method: 'PUT', pattern: new RegExp(`^/scheduling/${ID}/assign$`), label: (ctx) => {
      const plate = asText(asObject(ctx.result.vehicle).plateNumber);
      return withRef(plate ? `Assigned truck ${plate} and team` : 'Assigned truck and team', bookingRef(ctx));
    },
  },
  { method: 'POST', pattern: new RegExp(`^/dispatch/assignments/${ID}/retry$`), label: (ctx) => withRef('Retried truck assignment', bookingRef(ctx)) },
  { method: 'POST', pattern: new RegExp(`^/dispatch/assignments/${ID}/release$`), label: (ctx) => withRef('Released assignment for review', bookingRef(ctx)) },
  { method: 'POST', pattern: /^\/job-order$/, label: (ctx) => withRef('Created job order', bookingRef(ctx)) },
  { method: 'PUT', pattern: new RegExp(`^/job-order/${ID}/distribute$`), label: (ctx) => withRef('Distributed job order', bookingRef(ctx)) },
  {
    method: 'PUT', pattern: new RegExp(`^/job-order/${ID}$`), label: (ctx) =>
      withRef(ctx.body.status === 'Distributed' ? 'Distributed job order' : 'Updated job order', bookingRef(ctx)),
  },
  ...person('drivers', 'driver'),
  ...person('helpers', 'helper'),
  {
    method: 'POST', pattern: /^\/crew-leave\/self$/, label: (ctx) => {
      const kind = (asText(ctx.result.kind) ?? asText(ctx.body.kind))?.toUpperCase() === 'EMERGENCY' ? 'emergency' : 'leave';
      return withRef(`Filed own ${kind}`, asText(ctx.result.crewName));
    },
  },
  { method: 'POST', pattern: new RegExp(`^/crew-leave/self/${ID}/withdraw$`), label: (ctx) => withRef('Withdrew own leave request', asText(ctx.result.crewName)) },
];
