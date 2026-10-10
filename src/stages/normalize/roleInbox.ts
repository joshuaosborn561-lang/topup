/**
 * Role-inbox locals for Lane E Maps rows (D65, D67). info@ / office@ and
 * the rest have no person. Company comes from maps_raw.name. First-name
 * / greeting fallback is configurable on the recipe; default is
 * unchanged (hold). D67 adds locals seen on job 46b1c941 that are
 * generic role inboxes, not a brand or a person. Ask Josh before
 * growing this set again.
 */

export const ROLE_INBOX_LOCALS: ReadonlySet<string> = new Set([
  "info",
  "office",
  "admin",
  "hello",
  "contact",
  "sales",
  "support",
  "team",
  "mail",
  "inbox",
  "enquiry",
  "inquiry",
  "inquire",
  "reception",
  "help",
  "service",
  "services",
  "general",
  "billing",
  "accounts",
  "hr",
  "jobs",
  "careers",
  "marketing",
  "press",
  "media",
  "staff",
  "customerservice",
  "concierge",
  "boxoffice",
  "events",
  "rentals",
  "orders",
  "recruiting",
  "reservations",
  "adoptions",
  "parties",
  "storage",
]);

export function roleInboxLocal(email: string | null | undefined): string | null {
  if (!email || !email.includes("@")) return null;
  const local = email.slice(0, email.indexOf("@")).trim().toLowerCase();
  return local || null;
}

export function isRoleInbox(email: string | null | undefined): boolean {
  const local = roleInboxLocal(email);
  return local != null && ROLE_INBOX_LOCALS.has(local);
}
