import { geocode, haversineMiles, type CityCoords, type LatLon } from "./geo.js";
import { normalizeCity } from "./names.js";

/**
 * Conversational location: a port of
 * `skills/conversational-location/scripts/conversational_location.py` (D25).
 * A city geocodes to lat/lon; if it lands inside a metro's radius it gets that
 * metro's label, nearest metro winning where radii overlap. Anchor cities get
 * the label too (Chicago -> Chicagoland, on purpose). A city outside every
 * radius keeps its own cleaned name: Bozeman IS the conversational name.
 *
 * The script (D33) and this port agree: the raw `city` column is never
 * written (this returns a new value), and a city that cannot be geocoded
 * gets a BLANK location, never a broken sentence. The step 7 hold then
 * catches the blank when the copy uses it.
 */

/** (label, anchor lat, anchor lon, radius miles). Tighter metros first so they win on distance. Verbatim from the script. */
export const METROS: ReadonlyArray<readonly [string, number, number, number]> = [
  // California (specific before broad)
  ["Orange County", 33.7175, -117.8311, 22],
  ["the Inland Empire", 34.0633, -117.6509, 30],
  ["the Bay Area", 37.6879, -122.1705, 45],
  ["Greater Sacramento", 38.5816, -121.4944, 35],
  ["San Diego", 32.7157, -117.1611, 35],
  ["the LA area", 34.0522, -118.2437, 40],
  // Texas
  ["DFW", 32.79, -96.9, 50],
  ["Greater Houston", 29.7604, -95.3698, 50],
  ["the Austin area", 30.2672, -97.7431, 35],
  ["the San Antonio area", 29.4241, -98.4936, 35],
  // Florida
  ["South Florida", 26.3683, -80.1289, 70],
  ["the Tampa Bay area", 27.9506, -82.4572, 45],
  ["Central Florida", 28.5383, -81.3792, 45],
  ["Jacksonville", 30.3322, -81.6557, 35],
  // Northeast / Mid-Atlantic
  ["the NYC area", 40.7128, -74.006, 45],
  ["the DMV", 38.9072, -77.0369, 40],
  ["Greater Philadelphia", 39.9526, -75.1652, 40],
  ["Greater Boston", 42.3601, -71.0589, 40],
  ["Greater Baltimore", 39.2904, -76.6122, 28],
  ["Greater Pittsburgh", 40.4406, -79.9959, 35],
  ["the Hartford area", 41.7658, -72.6734, 30],
  ["the Providence area", 41.824, -71.4128, 25],
  ["the Buffalo area", 42.8864, -78.8784, 30],
  ["the Rochester area", 43.1566, -77.6088, 28],
  ["the Albany area", 42.6526, -73.7562, 30],
  // Midwest
  ["Chicagoland", 41.8781, -87.6298, 55],
  ["Metro Detroit", 42.3314, -83.0458, 45],
  ["the Twin Cities", 44.9778, -93.265, 45],
  ["Greater Cleveland", 41.4993, -81.6944, 35],
  ["Greater Cincinnati", 39.1031, -84.512, 35],
  ["Central Ohio", 39.9612, -82.9988, 35],
  ["Greater St. Louis", 38.627, -90.1994, 40],
  ["the Kansas City area", 39.0997, -94.5786, 40],
  ["Greater Milwaukee", 43.0389, -87.9065, 30],
  ["Greater Indianapolis", 39.7684, -86.1581, 35],
  ["the Omaha area", 41.2565, -95.9345, 30],
  ["Greater Grand Rapids", 42.9634, -85.6681, 28],
  // South
  ["Metro Atlanta", 33.749, -84.388, 45],
  ["the Nashville area", 36.1627, -86.7816, 40],
  ["the Triangle", 35.8436, -78.7852, 30],
  ["the Charlotte area", 35.2271, -80.8431, 35],
  ["the Triad", 36.0726, -79.792, 30],
  ["Greater New Orleans", 29.9511, -90.0715, 35],
  ["the Memphis area", 35.1495, -90.049, 35],
  ["the Birmingham area", 33.5186, -86.8104, 30],
  ["Greater Richmond", 37.5407, -77.436, 30],
  ["Hampton Roads", 36.8508, -76.2859, 35],
  ["the Louisville area", 38.2527, -85.7585, 30],
  ["the Charleston area", 32.7765, -79.9311, 30],
  ["the Greenville area", 34.8526, -82.394, 28],
  ["the Knoxville area", 35.9606, -83.9207, 30],
  ["Oklahoma City", 35.4676, -97.5164, 30],
  ["the Tulsa area", 36.154, -95.9928, 30],
  ["Little Rock", 34.7465, -92.2896, 28],
  // Mountain / West
  ["Metro Denver", 39.7392, -104.9903, 40],
  ["Metro Phoenix", 33.4484, -112.074, 40],
  ["the Las Vegas area", 36.1699, -115.1398, 30],
  ["the Salt Lake area", 40.7608, -111.891, 35],
  ["the Boise area", 43.615, -116.2023, 30],
  ["the Albuquerque area", 35.0844, -106.6504, 30],
  ["the Tucson area", 32.2226, -110.9747, 30],
  // Pacific Northwest
  ["the Seattle area", 47.6062, -122.3321, 40],
  ["the Portland area", 45.5152, -122.6784, 35],
  ["the Spokane area", 47.6588, -117.426, 28],
];

export interface LocationResult {
  /** The merge value. Metro label, the cleaned city, or "" for NO_GEOCODE / no city. */
  location: string;
  metro: string | null;
  city: string | null;
  geo: LatLon | null;
  source: "metro" | "city" | "no_geocode" | "no_city";
  flags: string[];
}

/** Nearest metro whose radius contains the point, or null. */
export function metroFor(p: LatLon): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const [label, lat, lon, radius] of METROS) {
    const d = haversineMiles(p, { lat, lon });
    if (d <= radius && d < bestD) {
      best = label;
      bestD = d;
    }
  }
  return best;
}

export function conversationalLocation(rawCity: string | null | undefined, rawState: string | null | undefined, coords: CityCoords): LocationResult {
  const c = normalizeCity(rawCity);
  if (!c.city) return { location: "", metro: null, city: null, geo: null, source: "no_city", flags: c.flags };
  const geo = geocode(c.city, rawState, coords);
  if (!geo) return { location: "", metro: null, city: c.city, geo: null, source: "no_geocode", flags: [...c.flags, "no_geocode"] };
  const metro = metroFor(geo);
  if (metro) return { location: metro, metro, city: c.city, geo, source: "metro", flags: c.flags };
  return { location: c.city, metro: null, city: c.city, geo, source: "city", flags: [...c.flags, "outside_every_metro"] };
}
