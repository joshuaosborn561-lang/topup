/**
 * Maps and PermitStack spend. $0 proceeds. Under $5 the operator taps.
 * $5 or more is Josh (`approve_spend`). The auto cap is $5.
 */
export function mapsPermitAsk(worstCaseCents: number, autoCapCents: number): "proceed" | "operator" | "owner" {
  if (worstCaseCents <= 0) return "proceed";
  if (worstCaseCents >= autoCapCents) return "owner";
  return "operator";
}
