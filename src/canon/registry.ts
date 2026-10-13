/** A row of topup.campaign_registry as the reads use it: ids, the lane, the status. */
export interface RegistryCampaign {
  campaign_id: number;
  campaign_name?: string | null;
  client_tag: string;
  smartlead_client_id: number | null;
  lane: string | null;
  /** Missing means ACTIVE, so an older registry row still counts. */
  status?: string | null;
  /** Stored segment dimensions, when the registry has them. Used only as recorded cells, never invented. */
  band?: string | null;
  mail_class?: string | null;
  gift_key?: string | null;
}

export function registryRows(rows: readonly Record<string, unknown>[]): RegistryCampaign[] {
  const out: RegistryCampaign[] = [];
  for (const row of rows) {
    const id = Number(row.campaign_id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const client = row.smartlead_client_id == null ? null : Number(row.smartlead_client_id);
    out.push({
      campaign_id: id,
      campaign_name: row.campaign_name == null ? null : String(row.campaign_name),
      client_tag: String(row.client_tag ?? ""),
      smartlead_client_id: client != null && Number.isFinite(client) ? client : null,
      lane: row.lane == null ? null : String(row.lane),
      status: row.status == null ? null : String(row.status),
      band: row.band == null ? null : String(row.band),
      mail_class: row.mail_class == null ? null : String(row.mail_class),
      gift_key: row.gift_key == null ? null : String(row.gift_key),
    });
  }
  return out;
}
