// Turns a successful write request into a sentence an Admin can read in the
// Activity Logs, e.g. "Approved reschedule request (BK-0012)".
// Keep this file identical across the Booking, Dispatch and Completion services;
// each service lists its own routes in audit-rules.ts.

export type AuditContext = { body: Record<string, unknown>; result: Record<string, unknown>; query: URLSearchParams; params: string[] };
/** A label of null means the request is not a user action worth logging (e.g. a route-distance lookup). */
export type AuditRule = { method: string | string[]; pattern: RegExp; label: (ctx: AuditContext) => string | null };

export const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const asText = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** The booking number a person would recognise, taken from the response first and then the request. */
export function bookingRef(ctx: AuditContext) {
  for (const source of [ctx.result, asObject(ctx.result.booking), ctx.body]) {
    const ref = asText(source.bookingNo) ?? asText(source.bookingNumber);
    if (ref) return ref;
  }
  return undefined;
}

export const withRef = (label: string, ref?: string) => (ref ? `${label} (${ref})` : label);

function matchRule(rules: AuditRule[], method: string, path: string) {
  for (const rule of rules) {
    const methods = Array.isArray(rule.method) ? rule.method : [rule.method];
    const match = methods.includes(method) ? rule.pattern.exec(path) : null;
    if (match) return { rule, params: match.slice(1) };
  }
  return undefined;
}

/** The generic label older rows were saved with, built from the HTTP verb and the last URL segment. */
export function legacyAction(method: string, path: string) {
  const verb = method === 'POST' ? 'Created' : method === 'DELETE' ? 'Deleted' : 'Updated';
  const noun = path.split('/').filter(Boolean).filter((part) => !/^[0-9a-f-]{20,}$/i.test(part)).pop()?.replaceAll('-', ' ') ?? 'record';
  return `${verb} ${noun}`.slice(0, 100);
}

/** Returns the readable action, null to skip logging, or the legacy label for a route no rule covers yet. */
export function describeAction(rules: AuditRule[], method: string, url: string, body: unknown, result: unknown): string | null {
  const [path, search = ''] = url.split('?');
  const found = matchRule(rules, method, path);
  if (!found) return legacyAction(method, path);
  const label = found.rule.label({ body: asObject(body), result: asObject(result), query: new URLSearchParams(search), params: found.params });
  return label === null ? null : label.slice(0, 100);
}

/** Re-describes rows saved before readable labels existed, using the path they stored. */
export function relabelLegacy<T extends { action: string; path: string }>(rules: AuditRule[], row: T): T | null {
  const verb = row.action.split(' ')[0];
  const methods = verb === 'Created' ? ['POST'] : verb === 'Deleted' ? ['DELETE'] : verb === 'Updated' ? ['PUT', 'PATCH'] : [];
  for (const method of methods) {
    if (legacyAction(method, row.path) !== row.action) continue;
    const found = matchRule(rules, method, row.path);
    if (!found) return row;
    const label = found.rule.label({ body: {}, result: {}, query: new URLSearchParams(), params: found.params });
    return label === null ? null : { ...row, action: label.slice(0, 100) };
  }
  return row;
}
