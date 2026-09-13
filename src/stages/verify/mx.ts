import type { MailClass } from "./sendable.js";

/**
 * Free MX classification (D34). Gateway hosts are SEG. Used when the
 * verifier CSV has no mail_class so gateway domains do not land in OTHER.
 */

const SEG_HOST = /proofpoint|pphosted|mimecast|messagelabs|emailsecurity|barracuda|cisco|ironport|forcepoint|symantec|messagelabs|ppe-hosted|protection\.outlook|google\.com|aspmx|ppe\./i;

export function mailClassFromMxHost(host: string | null | undefined): MailClass {
  if (!host || !host.trim()) return "unknown";
  return SEG_HOST.test(host) ? "seg" : "direct";
}

export type MxResolver = (domain: string) => Promise<string | null>;

export async function resolveMxHost(domain: string, resolve: MxResolver = defaultResolveMx): Promise<string | null> {
  if (!domain || !domain.includes(".")) return null;
  try {
    return await resolve(domain);
  } catch {
    return null;
  }
}

async function defaultResolveMx(domain: string): Promise<string | null> {
  const { resolveMx } = await import("node:dns/promises");
  const recs = await resolveMx(domain);
  const first = recs.sort((a, b) => a.priority - b.priority)[0];
  return first?.exchange ?? null;
}
