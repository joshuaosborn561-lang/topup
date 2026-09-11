import type { BalanceReader } from "./rails.js";

/**
 * Vendor balance readers. Each one asks the vendor for ITS number; none of
 * them compute anything. A vendor with no key configured has no reader, and
 * /health says so — a missing reader is reported, never guessed around.
 *
 * Verification runs through the verifier server, which holds the MV and N2B
 * keys. When Josh also gives this service read-only keys, these readers make
 * rail 4 a live balance check instead of a credits-used check.
 */

export function millionVerifierReader(apiKey: string, fetchImpl: typeof fetch = fetch): BalanceReader {
  return {
    vendor: "millionverifier",
    async read() {
      const res = await fetchImpl(`https://api.millionverifier.com/api/v3/credits?api=${encodeURIComponent(apiKey)}`);
      if (!res.ok) return null;
      const body = (await res.json()) as { credits?: number };
      return typeof body.credits === "number" ? body.credits : null;
    },
  };
}

export function no2bounceReader(token: string, fetchImpl: typeof fetch = fetch): BalanceReader {
  return {
    vendor: "no2bounce",
    async read() {
      const res = await fetchImpl("https://api.no2bounce.com/api/v1/credits", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { credits?: number; balance?: number };
      const v = body.credits ?? body.balance;
      return typeof v === "number" ? v : null;
    },
  };
}

export function readersFromEnv(env: NodeJS.ProcessEnv): BalanceReader[] {
  const out: BalanceReader[] = [];
  if (env.MILLIONVERIFIER_API_KEY) out.push(millionVerifierReader(env.MILLIONVERIFIER_API_KEY));
  if (env.NO2BOUNCE_API_TOKEN) out.push(no2bounceReader(env.NO2BOUNCE_API_TOKEN));
  return out;
}
