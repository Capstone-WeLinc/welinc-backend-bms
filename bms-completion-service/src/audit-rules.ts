import { asText, bookingRef, withRef, type AuditRule } from './audit-actions';

const ID = '([^/]+)';

export const AUDIT_RULES: AuditRule[] = [
  { method: 'POST', pattern: /^\/collections$/, label: (ctx) => withRef('Recorded collection', bookingRef(ctx)) },
  { method: 'POST', pattern: new RegExp(`^/collections/refunds/${ID}/retry$`), label: (ctx) => withRef('Retried refund', bookingRef(ctx)) },
  { method: 'POST', pattern: new RegExp(`^/collections/${ID}/verify$`), label: (ctx) => withRef('Verified collection', bookingRef(ctx)) },
  { method: 'POST', pattern: new RegExp(`^/collections/${ID}/reject$`), label: (ctx) => withRef('Rejected collection', bookingRef(ctx)) },
  { method: 'POST', pattern: new RegExp(`^/collections/${ID}/refunds$`), label: (ctx) => withRef('Refunded collection', bookingRef(ctx)) },
  { method: 'POST', pattern: new RegExp(`^/collections/${ID}/refund-requests$`), label: (ctx) => withRef('Requested refund', bookingRef(ctx)) },
  {
    method: 'POST', pattern: /^\/daily-sales\/submit$/, label: (ctx) => {
      const date = asText(ctx.query.get('date'));
      return date ? `Submitted daily sales for ${date}` : 'Submitted daily sales';
    },
  },
  { method: 'POST', pattern: new RegExp(`^/post-service/${ID}/retry$`), label: (ctx) => withRef('Retried post-service confirmation', bookingRef(ctx)) },
  {
    method: 'PUT', pattern: new RegExp(`^/post-service/${ID}$`), label: (ctx) => {
      const status = asText(ctx.result.postServiceStatus) ?? asText(ctx.body.postServiceStatus);
      const label = ctx.body.issueReported === true || status === 'Issue Reported' ? 'Reported issue on post-service'
        : status === 'Finalized' ? 'Finalized post-service'
          : status === 'Completed' || ctx.body.status === 'Completed' ? 'Completed post-service'
            : 'Updated post-service details';
      return withRef(label, bookingRef(ctx));
    },
  },
];
