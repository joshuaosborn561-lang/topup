import { haversineMiles, type LatLon } from "./geo.js";
import { normalizeState } from "./names.js";

/**
 * Local sports team: a port of
 * `skills/sports-team-assignment/scripts/assign_team.py` (D25). Decision order,
 * first match wins:
 *
 *   1. no city/state              -> blank NO_CITY_STATE
 *   2. city override              -> that team            [skipped in pro_only]
 *   3. no coordinates             -> blank NO_GEOCODE
 *   4. FL panhandle (lon < -84.5) -> blank PANHANDLE_FL_BLANK
 *   5. pro team within 35 mi      -> that team (home market beats a college in the same town)
 *   6. nearest of pro / college, both within 120 mi (Notre Dame 50) -> whichever is closer, ties to pro
 *   7. otherwise                  -> blank OUT_OF_RANGE
 *
 * Nickname only, current franchise names only. `pro_only` (mandatory for
 * education lanes) disables college and the city overrides.
 *
 * One rule the spine and the skills index add on top of the script: an
 * ambiguous college nickname (the school-qualified ones in the table) goes to
 * null and the lead routes to the AirPods tier. The script would have written
 * "LSU Tigers"; the index says null, and the index wins.
 */

export type League = "mlb" | "nfl";
export type LeaguePref = League | "both";

type Team = readonly [string, number, number];

export const MLB: readonly Team[] = [
  ["Diamondbacks", 33.4453, -112.0667], ["Braves", 33.8907, -84.4677], ["Orioles", 39.2839, -76.6217], ["Red Sox", 42.3467, -71.0972],
  ["Cubs", 41.9484, -87.6553], ["White Sox", 41.8299, -87.6338], ["Reds", 39.0975, -84.5069], ["Guardians", 41.4962, -81.6852],
  ["Rockies", 39.7559, -104.9942], ["Tigers", 42.339, -83.0485], ["Astros", 29.7573, -95.3555], ["Royals", 39.0517, -94.4803],
  ["Angels", 33.8003, -117.8827], ["Dodgers", 34.0739, -118.24], ["Marlins", 25.7781, -80.2197], ["Brewers", 43.028, -87.9712],
  ["Twins", 44.9817, -93.2778], ["Mets", 40.7571, -73.8458], ["Yankees", 40.8296, -73.9262], ["Athletics", 38.5816, -121.4944],
  ["Phillies", 39.9061, -75.1665], ["Pirates", 40.4469, -80.0057], ["Padres", 32.7073, -117.1566], ["Giants", 37.7786, -122.3893],
  ["Mariners", 47.5914, -122.3325], ["Cardinals", 38.6226, -90.1928], ["Rays", 27.7683, -82.6534], ["Rangers", 32.7473, -97.0845],
  ["Blue Jays", 43.6414, -79.3894], ["Nationals", 38.873, -77.0074],
];

export const NFL: readonly Team[] = [
  ["Cardinals", 33.5276, -112.2626], ["Falcons", 33.7553, -84.4006], ["Ravens", 39.278, -76.6227], ["Bills", 42.7738, -78.787],
  ["Panthers", 35.2258, -80.8528], ["Bears", 41.8623, -87.6167], ["Bengals", 39.0955, -84.5161], ["Browns", 41.5061, -81.6995],
  ["Cowboys", 32.7473, -97.0945], ["Broncos", 39.7439, -105.0201], ["Lions", 42.34, -83.0456], ["Packers", 44.5013, -88.0622],
  ["Texans", 29.6847, -95.4107], ["Colts", 39.7601, -86.1639], ["Jaguars", 30.3239, -81.6373], ["Chiefs", 39.0489, -94.4839],
  ["Raiders", 36.0909, -115.1833], ["Chargers", 33.9535, -118.3392], ["Rams", 33.9535, -118.3392], ["Dolphins", 25.958, -80.2389],
  ["Vikings", 44.9736, -93.2575], ["Patriots", 42.0909, -71.2643], ["Saints", 29.9511, -90.0812], ["Giants", 40.8135, -74.0745],
  ["Jets", 40.8135, -74.0745], ["Eagles", 39.9008, -75.1675], ["Steelers", 40.4468, -80.0158], ["49ers", 37.4033, -121.9694],
  ["Seahawks", 47.5952, -122.3316], ["Buccaneers", 27.9759, -82.5033], ["Titans", 36.1665, -86.7713], ["Commanders", 38.9077, -76.8645],
];

/** College towns where college sport dominates; schools inside pro markets are deliberately absent. */
export const COLLEGES: readonly Team[] = [
  ["Crimson Tide", 33.2098, -87.5692], ["Auburn Tigers", 32.6099, -85.4808], ["Bulldogs", 33.9519, -83.3576], ["Gators", 29.6516, -82.3248],
  ["LSU Tigers", 30.4515, -91.1871], ["Ole Miss Rebels", 34.3665, -89.5192], ["Mississippi State Bulldogs", 33.4504, -88.8184],
  ["Razorbacks", 36.0626, -94.1574], ["Gamecocks", 34.0007, -81.0348], ["Volunteers", 35.9606, -83.9207], ["Kentucky Wildcats", 38.0406, -84.5037],
  ["Missouri Tigers", 38.9517, -92.3341], ["Aggies", 30.628, -96.3344], ["Sooners", 35.2226, -97.4395], ["Longhorns", 30.2672, -97.7431],
  ["Wolverines", 42.2808, -83.743], ["Spartans", 42.737, -84.4839], ["Buckeyes", 39.9612, -82.9988], ["Nittany Lions", 40.7934, -77.86],
  ["Badgers", 43.0731, -89.4012], ["Hawkeyes", 41.6611, -91.5302], ["Cyclones", 42.0308, -93.6319], ["Cornhuskers", 40.8136, -96.7026],
  ["Boilermakers", 40.4259, -86.9081], ["Hoosiers", 39.1653, -86.5264], ["Fighting Illini", 40.1164, -88.2434], ["Fighting Irish", 41.6764, -86.252],
  ["Clemson Tigers", 34.6834, -82.8374], ["Tar Heels", 35.9132, -79.0558], ["Blue Devils", 35.994, -78.8986], ["Hokies", 37.2296, -80.4139],
  ["Cavaliers", 38.0293, -78.4767], ["Seminoles", 30.4383, -84.2807], ["Demon Deacons", 36.0999, -80.2442], ["Orange", 43.0481, -76.1474],
  ["Louisville Cardinals", 38.2527, -85.7585], ["Red Raiders", 33.5779, -101.8552], ["Oklahoma State Cowboys", 36.1156, -97.0584],
  ["K-State Wildcats", 39.1836, -96.5717], ["Jayhawks", 38.9717, -95.2353], ["Baylor Bears", 31.5493, -97.1467], ["Mountaineers", 39.6295, -79.9559],
  ["BYU Cougars", 40.2338, -111.6585], ["Ducks", 44.0521, -123.0868], ["Beavers", 44.5646, -123.262], ["Washington State Cougars", 46.7298, -117.1817],
  ["Arizona Wildcats", 32.2226, -110.9747], ["Buffaloes", 40.015, -105.2705], ["Boise State Broncos", 43.615, -116.2023],
  ["Fresno State Bulldogs", 36.7378, -119.7871], ["Montana Grizzlies", 46.8721, -113.994], ["Wyoming Cowboys", 41.3114, -105.5911],
];

/**
 * School-qualified nicknames: the skill qualifies them because the bare word
 * means another team too ("Tigers" is Detroit). The spine sends these to null.
 */
export const AMBIGUOUS_COLLEGE_NICKNAMES: ReadonlySet<string> = new Set([
  "Auburn Tigers", "LSU Tigers", "Ole Miss Rebels", "Mississippi State Bulldogs", "Kentucky Wildcats", "Missouri Tigers",
  "Clemson Tigers", "Louisville Cardinals", "Oklahoma State Cowboys", "K-State Wildcats", "Baylor Bears", "BYU Cougars",
  "Washington State Cougars", "Arizona Wildcats", "Boise State Broncos", "Fresno State Bulldogs", "Montana Grizzlies", "Wyoming Cowboys",
]);

/** Cities with no reasonable MLB/NFL answer but a real local team. Skipped in pro_only. */
export const CITY_OVERRIDES: ReadonlyMap<string, string> = new Map([
  ["memphis|TN", "Grizzlies"],
  ["orlando|FL", "Magic"],
  ["portland|OR", "Trail Blazers"],
  ["raleigh|NC", "Hurricanes"],
]);

/** Exact match only, never substring: "Spokane Indians" must survive. */
const RENAMES: ReadonlyMap<string, string> = new Map([
  ["Indians", "Guardians"],
  ["Redskins", "Commanders"],
]);

export const HOME_RADIUS_MI = 35;
export const COLLEGE_RADIUS_MI = 120;
export const REGIONAL_RADIUS_MI = 120;
export const NOTRE_DAME_RADIUS_MI = 50;

export type TeamSource = "MLB" | "NFL" | "College" | "CityOverride" | "NO_CITY_STATE" | "NO_GEOCODE" | "PANHANDLE_FL_BLANK" | "OUT_OF_RANGE" | "AMBIGUOUS_NICKNAME";

export interface TeamResult {
  team: string | null;
  source: TeamSource;
  gift: "team" | "airpods";
}

function nearest(p: LatLon, table: readonly Team[], radius: number): { name: string; d: number } | null {
  let best: { name: string; d: number } | null = null;
  for (const [name, lat, lon] of table) {
    const d = haversineMiles(p, { lat, lon });
    const r = name === "Fighting Irish" ? NOTRE_DAME_RADIUS_MI : radius;
    if (d <= r && (best === null || d < best.d)) best = { name, d };
  }
  return best;
}

function pro(name: string, league: League): TeamResult {
  return { team: RENAMES.get(name) ?? name, source: league === "mlb" ? "MLB" : "NFL", gift: "team" };
}

function blank(source: TeamSource): TeamResult {
  return { team: null, source, gift: "airpods" };
}

/** assign_team.py assign() for one league. `geo` is the row's coordinates from geo.ts, null when NO_GEOCODE. */
export function assignTeamForLeague(city: string | null, state: string | null, geo: LatLon | null, league: League, proOnly: boolean): TeamResult {
  const c = (city ?? "").trim();
  const st = normalizeState(state);
  if (!c || !st) return blank("NO_CITY_STATE");
  const override = proOnly ? undefined : CITY_OVERRIDES.get(`${c.toLowerCase()}|${st}`);
  if (override) return { team: override, source: "CityOverride", gift: "team" };
  if (!geo) return blank("NO_GEOCODE");
  if (st === "FL" && geo.lon < -84.5) return blank("PANHANDLE_FL_BLANK");

  const table = league === "mlb" ? MLB : NFL;
  const p = nearest(geo, table, REGIONAL_RADIUS_MI);
  if (p && p.d <= HOME_RADIUS_MI) return pro(p.name, league);
  if (proOnly) return p ? pro(p.name, league) : blank("OUT_OF_RANGE");

  const col = nearest(geo, COLLEGES, COLLEGE_RADIUS_MI);
  const college = (name: string): TeamResult => (AMBIGUOUS_COLLEGE_NICKNAMES.has(name) ? blank("AMBIGUOUS_NICKNAME") : { team: name, source: "College", gift: "team" });
  if (col && p) return col.d < p.d ? college(col.name) : pro(p.name, league);
  if (col) return college(col.name);
  if (p) return pro(p.name, league);
  return blank("OUT_OF_RANGE");
}

/**
 * The gift ladder: MLB first, NFL second, AirPods when both are blank
 * (`--league both`). A single league is just that league.
 */
export function assignTeam(city: string | null, state: string | null, geo: LatLon | null, opts: { league: LeaguePref; pro_only: boolean }): TeamResult {
  if (opts.league !== "both") return assignTeamForLeague(city, state, geo, opts.league, opts.pro_only);
  const mlb = assignTeamForLeague(city, state, geo, "mlb", opts.pro_only);
  if (mlb.team) return mlb;
  const nfl = assignTeamForLeague(city, state, geo, "nfl", opts.pro_only);
  return nfl.team ? nfl : mlb.source === "AMBIGUOUS_NICKNAME" ? mlb : nfl;
}
