/**
 * Role-inbox locals for Lane E Maps rows (D65). info@ / office@ and the
 * rest have no person. Company comes from the Maps business name.
 * First-name/greeting fallback is configurable on the recipe; default
 * is unchanged (hold). Ask Josh before growing this set.
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
