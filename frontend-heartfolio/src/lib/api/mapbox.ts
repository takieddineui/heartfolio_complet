/**
 * §6 — Mapbox search for the milestone location field.
 *
 * USES THE SEARCH BOX API, NOT GEOCODING v5. This was written against
 * Geocoding v5 (`/geocoding/v5/mapbox.places/{query}.json`), which Mapbox
 * has since stripped of Points of Interest: v5 still resolves addresses
 * and places, but no longer returns cafés, restaurants or landmarks.
 * Those are precisely what a milestone names — "the bar where we met" is
 * a POI, not an address — so the field would have looked like it worked
 * while being unable to find the one place the customer wanted. Geocoding
 * v6 does not restore POIs either; the Search Box API is the endpoint
 * that has them.
 *
 * TWO CALLS, NOT ONE, AND DELIBERATELY SO. Search Box splits interactive
 * search into `/suggest` (as the customer types) and `/retrieve` (once
 * they pick one). `/suggest` does not return coordinates at all — that is
 * what `/retrieve` is for. The one-shot `/forward` endpoint would return
 * coordinates directly and be a smaller change, but it is billed per
 * request, so every 300ms pause in typing would cost one; suggest and
 * retrieve share a session token and bill as a single session no matter
 * how many keystrokes it took. The field already has a distinct selection
 * step, so the two-call shape costs nothing in UX.
 *
 * STILL UNTESTED AGAINST THE LIVE API. There is no Mapbox token in this
 * environment. Written against Mapbox's documented Search Box request and
 * response shapes, but never exercised against a real response — the same
 * caveat the v5 version carried. Verify with a real token.
 *
 * THE TOKEN IS CLIENT-SIDE ON PURPOSE, not a security lapse. Mapbox's
 * search tokens are designed to be public — the same pattern as Paddle's
 * client token (`paddle-client.ts`) or Plausible's domain
 * (`analytics.tsx`). The actual security boundary is a URL/referrer
 * restriction configured on the token itself, in the Mapbox dashboard,
 * not secrecy of the token string. A server-proxied search would add a
 * round-trip for zero real protection.
 */

const SEARCH_BOX_BASE = "https://api.mapbox.com/search/searchbox/v1";

/** A place the customer can pick, before coordinates are known. */
export interface MapboxSuggestion {
  /** Mapbox's own id for the feature. Required by `/retrieve` — a
   *  suggestion cannot be turned into coordinates without it. */
  id: string;
  /** The short name, e.g. "Café A Brasileira". */
  name: string;
  /** Context that disambiguates two places sharing a name, e.g.
   *  "Rua Garrett 120, Lisboa, Portugal". May be empty. */
  context: string;
}

/** A resolved place, with coordinates. Unchanged in shape from the v5
 *  version so the stored `LocationValue` (§6) does not have to migrate —
 *  existing saved projects keep working. */
export interface MapboxPlace {
  id: string;
  /** What is shown on the artwork: name and context joined, so the poster
   *  reads "Café A Brasileira, Lisboa" rather than a bare name. */
  name: string;
  lat: number;
  lng: number;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

/** True when a token is configured at all. The input degrades to a plain
 *  disabled state without one, rather than firing requests that will 401. */
export function isMapboxConfigured(): boolean {
  return Boolean(MAPBOX_TOKEN);
}

/**
 * A session token groups one customer's typing plus the final retrieve
 * into a single billable session.
 *
 * `crypto.randomUUID` is available in every browser this app supports and
 * in Node 19+, but the fallback matters: this module is imported by a
 * component that Next may render on the server, and an exception thrown
 * during import would take the whole Studio down rather than degrade the
 * one field.
 */
export function newMapboxSessionToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `hf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Suggestions for what the customer has typed so far.
 *
 * `types` stays broad — POIs first, since that is the whole reason for
 * this endpoint, but addresses, places, localities and neighborhoods too:
 * §6 requires precise locations including small towns, and a village that
 * only resolves as a `locality` must still be findable.
 *
 * Returns [] rather than throwing on an empty/short query, matching the
 * previous behaviour the caller's debounce relies on.
 */
export async function suggestMapboxPlaces(
  query: string,
  sessionToken: string,
  signal?: AbortSignal,
  locale?: string
): Promise<MapboxSuggestion[]> {
  if (!MAPBOX_TOKEN || query.trim().length < 2) return [];

  const url = new URL(`${SEARCH_BOX_BASE}/suggest`);
  url.searchParams.set("q", query);
  url.searchParams.set("access_token", MAPBOX_TOKEN);
  url.searchParams.set("session_token", sessionToken);
  url.searchParams.set("limit", "10");

  /**
   * NO `types` FILTER, DELIBERATELY. This used to send
   * `poi,address,place,locality,neighborhood`, which reads as broad and is
   * not: the full set also includes `street`, `district`, `region`,
   * `block`, `postcode` and `country`, so street names and districts were
   * excluded outright. A milestone happens on a street as readily as in a
   * café. Omitting the parameter lets Search Box return everything it has
   * and rank it, which is what it is designed to do.
   */

  /**
   * WITHOUT PROXIMITY, RESULTS ARE RANKED GLOBALLY BY PROMINENCE. That is
   * why searching "Lisbon" returned Lisbon in Maine, Ohio, Connecticut and
   * Wisconsin alongside the Portuguese one, and why a neighbourhood café
   * loses to every same-named business on earth. `ip` biases ranking to
   * the searcher's own region using the request's IP — no browser
   * permission prompt, nothing stored, and it only reorders results rather
   * than excluding anywhere.
   */
  url.searchParams.set("proximity", "ip");

  /**
   * `language` AFFECTS THE RESPONSE ONLY, NOT MATCHING.
   *
   * Mapbox's docs are explicit: "The ISO language code to be returned. If
   * not provided, the default is English." An earlier version of this file
   * claimed it was the language to SEARCH in — that description belongs to
   * the Geocoding API, not Search Box, and the mistake is worth recording
   * because it made a harmless parameter look like the cause of a matching
   * problem it cannot cause.
   *
   * It is sent so the DROPDOWN is readable in the customer's own language.
   * It does not decide what gets stored: the caller keeps the text the
   * customer typed as the location name (see `pick()` in field-inputs),
   * precisely because no parameter here can answer "in whatever language
   * the query was written in".
   */
  if (locale) url.searchParams.set("language", locale);

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    throw new Error(`Mapbox suggest failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    suggestions?: { mapbox_id: string; name: string; place_formatted?: string }[];
  };

  return (data.suggestions ?? []).map((suggestion) => ({
    id: suggestion.mapbox_id,
    name: suggestion.name,
    context: suggestion.place_formatted ?? "",
  }));
}

/**
 * Turns a picked suggestion into a place with coordinates.
 *
 * Must use the SAME session token as the `/suggest` calls that produced
 * the suggestion — that pairing is what makes the exchange one session
 * rather than two billable requests.
 *
 * Returns null when the feature cannot be resolved, rather than throwing:
 * the caller's job is then to leave the field unset, which is a state the
 * form already handles, instead of surfacing an error for something the
 * customer cannot act on.
 */
export async function retrieveMapboxPlace(
  mapboxId: string,
  sessionToken: string,
  signal?: AbortSignal,
  locale?: string
): Promise<MapboxPlace | null> {
  if (!MAPBOX_TOKEN) return null;

  const url = new URL(`${SEARCH_BOX_BASE}/retrieve/${encodeURIComponent(mapboxId)}`);
  url.searchParams.set("access_token", MAPBOX_TOKEN);
  url.searchParams.set("session_token", sessionToken);

  // Sent HERE but not on `/suggest`: by this point the customer has picked
  // a specific feature, so there is nothing left to match — only a name to
  // store. Asking for it in their own language means the keepsake reads
  // "Lisbonne" for a French session where Mapbox has the translation, and
  // falls back to the local name where it does not.
  if (locale) url.searchParams.set("language", locale);

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    throw new Error(`Mapbox retrieve failed: ${response.status}`);
  }

  // `/retrieve` answers with a GeoJSON FeatureCollection, even for the
  // single feature that was asked for.
  const data = (await response.json()) as {
    features?: {
      geometry?: { coordinates?: [number, number] };
      properties?: { mapbox_id?: string; name?: string; place_formatted?: string };
    }[];
  };

  const feature = data.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  if (!feature || !coordinates) return null;

  // GeoJSON orders coordinates [lng, lat] — easy to transpose silently,
  // named explicitly here rather than destructured positionally so a
  // future edit cannot swap them without the variable names looking wrong.
  const [lng, lat] = coordinates;
  const name = feature.properties?.name ?? "";
  const context = feature.properties?.place_formatted ?? "";

  return {
    id: feature.properties?.mapbox_id ?? mapboxId,
    name: context ? `${name}, ${context}` : name,
    lat,
    lng,
  };
}
