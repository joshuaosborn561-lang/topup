import { col } from "../../lib/csv.js";

/**
 * Sendable rule (design 3.3 E): mv = ok, or mv = catch_all/unknown AND No2Bounce
 * said deliverable (confidence "confirmed"). Anything else is not sent. An
 * "unresolved_catchall" (accept-all domain that N2B could not confirm) is
 * ambiguous, and ambiguous means drop (brief section 8).
 *
 * Every lead carries verify_path so a bounce spike can be traced to the
 * catch-all subset without a rebuild: mv_ok | catch_all_n2b.
 */

export type VerifyPath = "mv_ok" | "catch_all_n2b";
export type MailClass = "seg" | "native_filter" | "direct" | "unknown";

export interface Verdict {
  email: string;
  domain: string;
  mv_status: string;
  n2b_status: string | null;
  mail_class: MailClass;
  mx_host: string | null;
  gateway_provider: string | null;
  sendable: boolean;
  verify_path: VerifyPath | null;
  ev_status: "sendable" | "rejected" | "unresolved";
}

export function segmentFor(mailClass: MailClass | string | null | undefined): "SEG" | "OTHER" {
  return mailClass === "seg" ? "SEG" : "OTHER";
}

function mailClassOf(raw: string): MailClass {
  const v = raw.trim().toLowerCase();
  return v === "seg" || v === "native_filter" || v === "direct" ? v : "unknown";
}

/** Map one row of the verifier's SENDABLE / REJECTED / UNRESOLVED CSV to a verdict. */
export function verdictFromCsvRow(row: Record<string, string>, file: "sendable" | "rejected" | "unresolved"): Verdict | null {
  const email = col(row, "email", "Email", "email_address").trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  const domain = email.split("@")[1] ?? "";
  const source = col(row, "verification_source").trim().toLowerCase();
  const status = col(row, "verification_status").trim().toLowerCase();
  const confidence = col(row, "confidence").trim().toLowerCase();
  const mail_class = mailClassOf(col(row, "mail_class"));
  const mx_host = col(row, "mx_host").trim() || null;
  const gateway_provider = col(row, "gateway_provider").trim() || null;

  let mv_status = "unknown";
  let n2b_status: string | null = null;
  if (source === "millionverifier") mv_status = status || "unknown";
  else if (source === "no2bounce") {
    // MV deferred to the second vendor: the address was catch_all or unknown.
    mv_status = "catch_all_or_unknown";
    n2b_status = status || null;
  } else if (status === "never_verified" || !source) {
    mv_status = "never_verified";
  }

  const sendable =
    file === "sendable" &&
    ((source === "millionverifier" && status === "ok") || (source === "no2bounce" && confidence === "confirmed"));

  const verify_path: VerifyPath | null = !sendable ? null : source === "millionverifier" ? "mv_ok" : "catch_all_n2b";
  const ev_status: Verdict["ev_status"] = sendable ? "sendable" : file === "unresolved" || mv_status === "never_verified" ? "unresolved" : "rejected";

  return { email, domain, mv_status, n2b_status, mail_class, mx_host, gateway_provider, sendable, verify_path, ev_status };
}
