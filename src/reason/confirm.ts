import type { Repo } from "../db/repo.js";
import { receiptConfirmCard } from "../slack/cards.js";
import type { SlackConsole } from "../slack/console.js";
import type { RunRow } from "../domain/runs.js";

function filtersPlain(filters: Record<string, unknown>): string {
  const titles = Array.isArray(filters.job_titles) ? (filters.job_titles as string[]).join(", ") : "";
  const bands = Array.isArray(filters.company_size) ? (filters.company_size as string[]).join(", ") : "";
  const countries = Array.isArray(filters.countries) ? (filters.countries as string[]).join(", ") : "";
  return [`Titles: ${titles || "—"}`, `Bands: ${bands || "—"}`, `Geo: ${countries || "—"}`].join("\n");
}

/** After the first run on a lane, post each backfill lane row for confirm or edit. */
export async function postBackfillConfirmations(d: { repo: Repo; console: SlackConsole }, run: RunRow): Promise<number> {
  const receipts = await d.repo.listPullReceipts(run.client_tag, run.lane);
  let n = 0;
  for (const r of receipts) {
    if (r.granularity !== "lane") continue;
    if (r.written_by !== "claude_backfill") continue;
    if (r.josh_confirmed) continue;
    const receiptId = r.receipt_id;
    if (!receiptId) continue;
    await d.console.ask({
      run,
      kind: "receipt_confirm",
      audience: "owner",
      payload: { receipt_id: receiptId },
      text: `Confirm reconstructed receipt for ${run.client_tag}/${run.lane}`,
      blocks: (cardId) =>
        receiptConfirmCard({
          cardId,
          receiptId,
          clientTag: run.client_tag,
          lane: run.lane,
          filters: filtersPlain(r.company_filters),
          writtenBy: r.written_by,
        }),
    });
    n += 1;
  }
  return n;
}
