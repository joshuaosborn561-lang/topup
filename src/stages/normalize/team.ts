/**
 * Local sports team (skill: sports-team-assignment). A lot of campaigns open
 * with a ticket offer, so the team has to be right or absent — never wrong.
 *
 *   - teams come from topup.ref_sports_teams keyed by conversational metro
 *   - league preference: NFL, then NBA, MLB, NHL (tickets people actually want)
 *   - a nickname in topup.ref_ambiguous_nicknames (Cavaliers: Cleveland or
 *     Virginia) resolves to NO team; the lead goes to the AirPods gift tier
 *   - no metro / no team -> null team -> AirPods tier
 *   - `pro_only` is the default posture; college is never assigned from a city
 */

export interface TeamRow {
  team: string;
  league: string;
  metro: string;
  pro: boolean;
}

export interface TeamRefs {
  teams: readonly TeamRow[];
  ambiguous: ReadonlySet<string>; // lower case nicknames
}

export type LeaguePref = "nfl" | "nba" | "mlb" | "nhl" | "both" | "all";

export interface TeamResult {
  team: string | null;
  league: string | null;
  gift: "team" | "airpods";
  flags: string[];
}

const ORDER = ["NFL", "NBA", "MLB", "NHL", "MLS", "NCAA"];

function leaguesFor(pref: LeaguePref): string[] {
  switch (pref) {
    case "nfl":
      return ["NFL"];
    case "nba":
      return ["NBA"];
    case "mlb":
      return ["MLB"];
    case "nhl":
      return ["NHL"];
    case "both":
      return ["NFL", "NBA"];
    case "all":
      return ORDER;
  }
}

export function assignTeam(metro: string | null, refs: TeamRefs, opts: { league: LeaguePref; pro_only: boolean }): TeamResult {
  if (!metro) return { team: null, league: null, gift: "airpods", flags: ["no_metro"] };
  const allowed = leaguesFor(opts.league);
  const candidates = refs.teams
    .filter((t) => t.metro.toLowerCase() === metro.toLowerCase())
    .filter((t) => allowed.includes(t.league.toUpperCase()))
    .filter((t) => !opts.pro_only || t.pro)
    .sort((a, b) => ORDER.indexOf(a.league.toUpperCase()) - ORDER.indexOf(b.league.toUpperCase()));
  for (const c of candidates) {
    if (refs.ambiguous.has(c.team.toLowerCase())) {
      // Ambiguous nickname: skip it. If nothing unambiguous remains, no team.
      continue;
    }
    return { team: c.team, league: c.league, gift: "team", flags: [] };
  }
  if (candidates.length > 0) return { team: null, league: null, gift: "airpods", flags: ["ambiguous_nickname"] };
  return { team: null, league: null, gift: "airpods", flags: ["no_team_for_metro"] };
}
