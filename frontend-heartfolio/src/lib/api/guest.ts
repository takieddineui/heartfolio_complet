/**
 * Guest identity — Django sessions, nothing else.
 *
 * Heartfolio has no accounts, no passwords and no tokens. The backend maps
 * an opaque `sessionid` cookie to a `Customer` row once an email is known
 * (`apps/customers`). The frontend therefore never sends, stores or reads a
 * customer id: it calls `identifyGuest(email)` once, and every later request
 * is attributed by the cookie the browser already holds.
 *
 * WHEN IDENTITY IS ESTABLISHED — a real ordering constraint, not a
 * preference: `customers.email` is `NOT NULL`, so a Customer cannot exist
 * before the customer has typed an email. That means every session-owned
 * endpoint (projects, assets, orders) returns 401 until then. The email is
 * collected at the first checkout step, so the Studio holds personalization
 * state locally and persists it at checkout, immediately before the order is
 * created. Anything else would require either a UI change (asking for an
 * email up front) or a schema change (anonymous customers) — neither is in
 * scope, and neither is necessary.
 */

import { apiFetch } from "./client";

export interface GuestIdentity {
  /** `null` until an email has been submitted for this session. */
  customerId: string | null;
  email: string | null;
}

/**
 * Reads the identity attached to the current session, and — as a deliberate
 * side effect the backend documents — causes Django to issue the CSRF cookie
 * the first unsafe request will need. Safe for an anonymous visitor: it
 * creates no Customer row and persists no session.
 */
export async function getGuestIdentity(signal?: AbortSignal): Promise<GuestIdentity> {
  return apiFetch<GuestIdentity>("/guest", { method: "GET", signal });
}

/**
 * Resolves-or-creates the Customer for this email and binds it to the
 * session. Idempotent and case-insensitive server-side (the column is
 * `citext`), so a returning customer re-entering the same address resumes
 * the same identity rather than creating a duplicate.
 *
 * Throttled by the backend (`guest_identity` scope) — a 429 surfaces as an
 * `ApiError` with code `throttled`.
 */
export async function identifyGuest(email: string, signal?: AbortSignal): Promise<GuestIdentity> {
  return apiFetch<GuestIdentity>("/guest", { method: "POST", body: { email: email.trim() }, signal });
}

/** True once this session can call the session-owned endpoints. */
export function isIdentified(identity: GuestIdentity | null): boolean {
  return Boolean(identity?.customerId);
}
