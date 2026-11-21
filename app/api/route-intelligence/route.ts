import { NextRequest, NextResponse } from "next/server";

type Coordinate = { lat: number; lon: number };

type RouteOption = {
  id: number;
  distanceKm: number;
  durationMinutes: number;
  geometry: { coordinates: [number, number][] };
};

type RoutingResponse = {
  code?: string;
  routes?: Array<{
    distance: number;
    duration: number;
    geometry: RouteOption["geometry"];
  }>;
};

type Facility = {
  id: string;
  name: string;
  category: "restaurant" | "fuel" | "cng" | "toll";
  lat: number;
  lon: number;
  distanceFromRouteKm: number;
  distanceAlongRouteKm: number;
  details: string[];
  mapsUrl: string;
  sourceUrl: string;
};

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements?: OverpassElement[];
};

type GeoapifyFeature = {
  properties?: {
    place_id?: string;
    name?: string;
    categories?: string[];
    lat?: number;
    lon?: number;
    operator?: string;
    opening_hours?: string;
    address_line2?: string;
    datasource?: { raw?: Record<string, string> };
  };
  geometry?: { coordinates?: [number, number] };
};

type GeoapifyResponse = {
  features?: GeoapifyFeature[];
};

const EARTH_RADIUS_KM = 6371;
const ROUTE_SAMPLE_SPACING_KM = 15;
const ROUTE_SEARCH_RADIUS_METERS = 3000;
const MAX_ROUTE_SAMPLES = 40;
const GEOAPIFY_MAX_ROUTE_POSITIONS = 1500;
// Short timeout limits waiting on shared public Overpass servers.
const OVERPASS_TIMEOUT_MS = 7000;
const FACILITY_LOOKUP_TIMEOUT_MS = 10000;
const GEOAPIFY_PLACES_TIMEOUT_MS = 25000;
const ROUTING_LOOKUP_TIMEOUT_MS = 14000;
const ROUTING_ENDPOINT_TIMEOUT_MS = 8000;
const GEOAPIFY_CATEGORIES = [
  "catering.restaurant",
  "catering.cafe",
  "catering.fast_food",
  "catering.food_court",
  "service.vehicle.fuel",
];

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const ROUTING_ENDPOINTS = [
  "https://router.project-osrm.org/route/v1/driving/",
  "https://routing.openstreetmap.de/routed-car/route/v1/driving/",
];

async function findDrivingRoute(
  start: Coordinate,
  end: Coordinate,
): Promise<RoutingResponse> {
  const coordinates = `${start.lon},${start.lat};${end.lon},${end.lat}`;
  const deadline = Date.now() + ROUTING_LOOKUP_TIMEOUT_MS;
  let lastError: unknown;

  for (const endpoint of ROUTING_ENDPOINTS) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;

    const url =
      `${endpoint}${coordinates}` +
      "?alternatives=true&overview=full&geometries=geojson&steps=false";

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(
          Math.min(ROUTING_ENDPOINT_TIMEOUT_MS, remainingMs),
        ),
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Routing service returned status ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      console.warn(
        "A driving route service could not be reached:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `Driving route lookup failed: ${lastError.message}`
      : "Driving route services are temporarily unavailable",
  );
}

async function geocode(place: string): Promise<Coordinate | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", place);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "TripPilot/1.1 (travel route planner)",
      "Accept-Language": "en",
    },
    signal: AbortSignal.timeout(12000),
    next: { revalidate: 86400 },
  });

  if (!response.ok) {
    throw new Error(`Location lookup failed for ${place}`);
  }

  const results: Array<{ lat: string; lon: string }> = await response.json();
  if (!Array.isArray(results) || results.length === 0) return null;

  const lat = Number(results[0].lat);
  const lon = Number(results[0].lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function haversineKm(a: Coordinate, b: Coordinate): number {
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) *
      Math.cos(rad(b.lat)) *
      Math.sin(dLon / 2) ** 2;

  return (
    EARTH_RADIUS_KM *
    2 *
    Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
  );
}

function sampleRoute(points: [number, number][]): Coordinate[] {
  if (points.length < 2) {
    return points.map(([lon, lat]) => ({ lat, lon }));
  }

  const cumulative = [0];

  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(
      cumulative[i - 1] +
        haversineKm(
          { lat: points[i - 1][1], lon: points[i - 1][0] },
          { lat: points[i][1], lon: points[i][0] },
        ),
    );
  }

  const total = cumulative[cumulative.length - 1];
  const count = Math.min(
    MAX_ROUTE_SAMPLES,
    Math.max(2, Math.ceil(total / ROUTE_SAMPLE_SPACING_KM) + 1),
  );

  const samples: Coordinate[] = [];

  for (let i = 0; i < count; i += 1) {
    const target = (total * i) / (count - 1);
    let segment = cumulative.findIndex(
      (distance, index) =>
        index < cumulative.length - 1 &&
        distance <= target &&
        cumulative[index + 1] >= target,
    );

    if (segment < 0) segment = cumulative.length - 2;

    const segmentLength = cumulative[segment + 1] - cumulative[segment];
    const fraction = segmentLength
      ? (target - cumulative[segment]) / segmentLength
      : 0;

    samples.push({
      lon:
        points[segment][0] +
        (points[segment + 1][0] - points[segment][0]) * fraction,
      lat:
        points[segment][1] +
        (points[segment + 1][1] - points[segment][1]) * fraction,
    });
  }

  return samples;
}

function getCenter(element: OverpassElement): Coordinate | null {
  const lat = Number(element.lat ?? element.center?.lat);
  const lon = Number(element.lon ?? element.center?.lon);

  return Number.isFinite(lat) && Number.isFinite(lon)
    ? { lat, lon }
    : null;
}

function getFacilityCategory(
  tags: Record<string, string>,
): Facility["category"] | null {
  if (
    tags.barrier === "toll_booth" ||
    tags.barrier === "toll_gantry" ||
    tags.highway === "toll_gantry"
  ) {
    return "toll";
  }

  if (
    tags.amenity === "fuel" &&
    ["yes", "true"].includes((tags["fuel:cng"] || "").toLowerCase())
  ) {
    return "cng";
  }

  if (tags.amenity === "fuel") return "fuel";

  if (
    ["restaurant", "cafe", "fast_food", "food_court"].includes(
      tags.amenity || "",
    )
  ) {
    return "restaurant";
  }

  return null;
}

// Finds the closest position on the complete route geometry to a facility.
function nearestRoutePosition(
  point: Coordinate,
  route: [number, number][],
): { distanceKm: number; alongKm: number } {
  const lat0 = (point.lat * Math.PI) / 180;
  const kmPerLon = 111.32 * Math.cos(lat0);

  const project = (lon: number, lat: number) => ({
    x: (lon - point.lon) * kmPerLon,
    y: (lat - point.lat) * 110.574,
  });

  let bestDistance = Infinity;
  let bestAlong = 0;
  let travelled = 0;

  for (let i = 0; i < route.length - 1; i += 1) {
    const [lonA, latA] = route[i];
    const [lonB, latB] = route[i + 1];

    const a = project(lonA, latA);
    const b = project(lonB, latB);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;

    const t = lengthSquared
      ? Math.max(
          0,
          Math.min(1, -(a.x * dx + a.y * dy) / lengthSquared),
        )
      : 0;

    const distance = Math.hypot(a.x + t * dx, a.y + t * dy);
    const segmentKm = haversineKm(
      { lat: latA, lon: lonA },
      { lat: latB, lon: lonB },
    );

    if (distance < bestDistance) {
      bestDistance = distance;
      bestAlong = travelled + segmentKm * t;
    }

    travelled += segmentKm;
  }

  return { distanceKm: bestDistance, alongKm: bestAlong };
}

function simplifyRouteForPlaces(
  routePoints: [number, number][],
): [number, number][] {
  if (routePoints.length <= GEOAPIFY_MAX_ROUTE_POSITIONS) {
    return routePoints;
  }

  return Array.from({ length: GEOAPIFY_MAX_ROUTE_POSITIONS }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (routePoints.length - 1)) /
        (GEOAPIFY_MAX_ROUTE_POSITIONS - 1),
    );
    return routePoints[sourceIndex];
  });
}

function buildOverpassQuery(
  samples: Coordinate[],
  includeBusinesses: boolean,
): string {
  const selectors = samples
    .map(
      ({ lat, lon }) => `
        ${
          includeBusinesses
            ? `nwr(around:${ROUTE_SEARCH_RADIUS_METERS},${lat},${lon})[amenity~"^(fuel|restaurant|cafe|fast_food|food_court)$"];`
            : ""
        }
        nwr(around:${ROUTE_SEARCH_RADIUS_METERS},${lat},${lon})[barrier~"^(toll_booth|toll_gantry)$"];
        nwr(around:${ROUTE_SEARCH_RADIUS_METERS},${lat},${lon})[highway="toll_gantry"];
      `,
    )
    .join("\n");

  return `[out:json][timeout:8];(${selectors});out center tags;`;
}

async function queryOverpass(
  query: string,
  deadline: number,
): Promise<OverpassElement[]> {
  let lastError: unknown;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "TripPilot/1.1 (travel route planner)",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(
          Math.min(OVERPASS_TIMEOUT_MS, remainingMs),
        ),
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`OpenStreetMap query failed (${response.status})`);
      }

      const payload: OverpassResponse = await response.json();
      return Array.isArray(payload.elements) ? payload.elements : [];
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("OpenStreetMap facility lookup failed");
}

async function findFacilities(
  routePoints: [number, number][],
  includeBusinesses = true,
): Promise<Facility[]> {
  if (routePoints.length < 2) {
    return [];
  }

  const samples = sampleRoute(routePoints);
  const deadline = Date.now() + FACILITY_LOOKUP_TIMEOUT_MS;
  const elements = await queryOverpass(
    buildOverpassQuery(samples, includeBusinesses),
    deadline,
  );

  const unique = new Map<string, Facility>();

  for (const element of elements) {
    const tags = element.tags || {};
    const category = getFacilityCategory(tags);
    const coordinate = getCenter(element);
    const name = String(
      tags.name || tags["name:en"] || tags.brand || "",
    ).trim();

    // Do not create fictional names for unnamed map features.
    if (!category || !coordinate || !name) continue;

    const id = `${element.type}-${element.id}`;
    const nearest = nearestRoutePosition(coordinate, routePoints);

    if (nearest.distanceKm > ROUTE_SEARCH_RADIUS_METERS / 1000) continue;

    const details = [
      tags.operator,
      tags.opening_hours,
      tags["fuel:diesel"] === "yes" ? "Diesel" : "",
      tags["fuel:petrol"] === "yes" ? "Petrol" : "",
      tags["fuel:cng"] === "yes" ? "CNG" : "",
      tags.brand && tags.brand !== name ? tags.brand : "",
    ].filter((value): value is string => Boolean(value));

    unique.set(id, {
      id,
      name,
      category,
      lat: coordinate.lat,
      lon: coordinate.lon,
      distanceFromRouteKm: Math.round(nearest.distanceKm * 10) / 10,
      distanceAlongRouteKm: Math.round(nearest.alongKm * 10) / 10,
      details,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${name} ${coordinate.lat},${coordinate.lon}`,
      )}`,
      sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    });
  }

  return [...unique.values()].sort(
    (a, b) => a.distanceAlongRouteKm - b.distanceAlongRouteKm,
  );
}

async function findGeoapifyFacilities(
  routePoints: [number, number][],
  apiKey: string,
): Promise<Facility[]> {
  const response = await fetch("https://api.geoapify.com/v2/places", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      categories: GEOAPIFY_CATEGORIES,
      filter: {
        type: "polyline",
        geometry: {
          type: "LineString",
          coordinates: simplifyRouteForPlaces(routePoints),
        },
        buffer: ROUTE_SEARCH_RADIUS_METERS,
      },
      limit: 500,
      lang: "en",
    }),
    signal: AbortSignal.timeout(GEOAPIFY_PLACES_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    const responseText = await response.text();
    let providerMessage = "";
    try {
      const parsed: unknown = JSON.parse(responseText);
      if (parsed && typeof parsed === "object") {
        const errorPayload = parsed as {
          message?: unknown;
          error?: unknown;
        };
        const detail =
          typeof errorPayload.message === "string"
            ? errorPayload.message
            : typeof errorPayload.error === "string"
              ? errorPayload.error
              : "";
        providerMessage = detail.slice(0, 180);
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }

    throw new Error(
      `Geoapify Places API returned status ${response.status}${
        providerMessage ? `: ${providerMessage}` : ""
      }`,
    );
  }

  const payload: GeoapifyResponse = await response.json();
  if (!Array.isArray(payload.features)) {
    throw new Error("Geoapify Places API returned an invalid response");
  }

  const unique = new Map<string, Facility>();

  for (const feature of payload.features) {
    const properties = feature.properties || {};
    const categories = properties.categories || [];
    const raw = properties.datasource?.raw || {};
    const coordinates = feature.geometry?.coordinates;
    const lat = Number(properties.lat ?? coordinates?.[1]);
    const lon = Number(properties.lon ?? coordinates?.[0]);
    const name = String(properties.name || "").trim();

    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const isFuel = categories.includes("service.vehicle.fuel");
    const isRestaurant = categories.some((category) =>
      category.startsWith("catering."),
    );
    if (!isFuel && !isRestaurant) continue;

    const category: Facility["category"] =
      isFuel && ["yes", "true"].includes((raw["fuel:cng"] || "").toLowerCase())
        ? "cng"
        : isFuel
          ? "fuel"
          : "restaurant";
    const coordinate = { lat, lon };
    const nearest = nearestRoutePosition(coordinate, routePoints);

    if (nearest.distanceKm > ROUTE_SEARCH_RADIUS_METERS / 1000) continue;

    const id =
      properties.place_id || `geoapify-${category}-${lat.toFixed(6)}-${lon.toFixed(6)}`;
    const details = [
      properties.operator || raw.operator,
      properties.opening_hours || raw.opening_hours,
      raw["fuel:diesel"] === "yes" ? "Diesel" : "",
      raw["fuel:petrol"] === "yes" ? "Petrol" : "",
      category === "cng" ? "CNG" : "",
      properties.address_line2,
    ].filter((value): value is string => Boolean(value));

    unique.set(id, {
      id,
      name,
      category,
      lat,
      lon,
      distanceFromRouteKm: Math.round(nearest.distanceKm * 10) / 10,
      distanceAlongRouteKm: Math.round(nearest.alongKm * 10) / 10,
      details,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${name} ${lat},${lon}`,
      )}`,
      sourceUrl: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`,
    });
  }

  return [...unique.values()].sort(
    (a, b) => a.distanceAlongRouteKm - b.distanceAlongRouteKm,
  );
}

async function getRouteFacilities(
  routePoints: [number, number][],
): Promise<{
  facilities: Facility[];
  facilitiesWarning: string;
  placesProvider: "Geoapify" | "OpenStreetMap";
}> {
  const apiKey = process.env.GEOAPIFY_API_KEY?.trim();

  if (!apiKey) {
    try {
      const facilities = await findFacilities(routePoints);
      return {
        facilities,
        facilitiesWarning: facilities.length
          ? ""
          : "No named facilities were found in the OpenStreetMap data near this route. Configure a free Geoapify key for route-corridor place search; map coverage may still be incomplete.",
        placesProvider: "OpenStreetMap",
      };
    } catch (error) {
      console.error("Route facilities lookup failed:", error);
      return {
        facilities: [],
        facilitiesWarning:
          "OpenStreetMap place searches timed out. Configure a free Geoapify key or try again later; route calculation is still available.",
        placesProvider: "OpenStreetMap",
      };
    }
  }

  let geoapifyFailureReason = "returned no named places";

  try {
    const [geoapifyFacilities, tollLookup] = await Promise.allSettled([
      findGeoapifyFacilities(routePoints, apiKey),
      findFacilities(routePoints, false),
    ]);

    if (geoapifyFacilities.status === "rejected") {
      throw geoapifyFacilities.reason;
    }

    if (geoapifyFacilities.value.length) {
      const tollFacilities =
        tollLookup.status === "fulfilled" ? tollLookup.value : [];
      if (tollLookup.status === "rejected") {
        console.error("OpenStreetMap toll lookup failed:", tollLookup.reason);
      }

      return {
        facilities: [...geoapifyFacilities.value, ...tollFacilities].sort(
          (a, b) => a.distanceAlongRouteKm - b.distanceAlongRouteKm,
        ),
        facilitiesWarning:
          tollLookup.status === "rejected"
            ? "Food and fuel stops were loaded from Geoapify, but mapped toll points could not be loaded from OpenStreetMap."
            : "",
        placesProvider: "Geoapify",
      };
    }
  } catch (error) {
    console.error("Geoapify places lookup failed:", error);
    if (
      error instanceof Error &&
      error.message.startsWith("Geoapify Places API returned status ")
    ) {
      geoapifyFailureReason = error.message.replace(
        "Geoapify Places API returned status ",
        "returned HTTP ",
      );
    } else if (
      error instanceof Error &&
      error.message === "Geoapify Places API returned an invalid response"
    ) {
      geoapifyFailureReason = "returned an invalid response";
    } else {
      geoapifyFailureReason = "request failed or timed out";
    }
  }

  try {
    const facilities = await findFacilities(routePoints);
    const facilitiesWarning = facilities.length
      ? `Geoapify ${geoapifyFailureReason}; these results use OpenStreetMap data.`
      : `Geoapify ${geoapifyFailureReason}, and OpenStreetMap did not return named stops. Map coverage may be incomplete.`;

    return {
      facilities,
      facilitiesWarning,
      placesProvider: "OpenStreetMap",
    };
  } catch (error) {
    console.error("OpenStreetMap fallback lookup failed:", error);
    return {
      facilities: [],
      facilitiesWarning:
        `Geoapify ${geoapifyFailureReason}, and OpenStreetMap stop searches could not be completed. Check the key or try again later.`,
      placesProvider: "OpenStreetMap",
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const origin = String(body.origin || "").trim();
    const destination = String(body.destination || "").trim();

    if (!origin || !destination) {
      return NextResponse.json(
        { error: "Please enter both a starting point and destination." },
        { status: 400 },
      );
    }

    if (origin.toLowerCase() === destination.toLowerCase()) {
      return NextResponse.json(
        { error: "Starting point and destination must be different." },
        { status: 400 },
      );
    }

    const start = await geocode(origin);

    // Nominatim asks clients to keep requests to approximately one per second.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const end = await geocode(destination);

    if (!start || !end) {
      return NextResponse.json(
        {
          error:
            "We could not find one of these locations. Try adding the city or state.",
        },
        { status: 404 },
      );
    }

    let routePayload: RoutingResponse;
    try {
      routePayload = await findDrivingRoute(start, end);
    } catch (error) {
      console.error("Driving route lookup failed:", error);
      return NextResponse.json(
        {
          error:
            "The driving route service is temporarily unavailable. Please try again shortly.",
        },
        { status: 503 },
      );
    }

    if (routePayload.code !== "Ok" || !routePayload.routes?.length) {
      return NextResponse.json(
        { error: "No driving route was found for these locations." },
        { status: 404 },
      );
    }

    const routes: RouteOption[] = routePayload.routes.map(
      (route, index) => ({
        id: index + 1,
        distanceKm: Math.round((route.distance / 1000) * 10) / 10,
        durationMinutes: Math.round(route.duration / 60),
        geometry: route.geometry,
      }),
    );

    const {
      facilities,
      facilitiesWarning,
      placesProvider,
    } = await getRouteFacilities(routes[0].geometry.coordinates);

    return NextResponse.json({
      origin,
      destination,
      start,
      end,
      routes,
      facilities,
      facilitiesWarning,
      placesProvider,
      tollPricing: {
        status: "unavailable",
        total: null,
        currency: "INR",
        provider: null,
        message:
          "Toll locations may be mapped, but live vehicle-specific toll prices require a toll-pricing provider. No toll amount has been assumed.",
      },
      dataNotes: {
        routing:
          "Driving route geometry and distance come from a public OSRM-compatible routing service, with a fallback if the primary is unavailable; live traffic is not included.",
        places: `Named facilities are searched using ${placesProvider}. Distances are calculated against the full route geometry, not sampled route points. Coverage and opening status may be incomplete.`,
        tolls:
          "OpenStreetMap toll features identify mapped locations only; they do not provide dependable current vehicle-specific fees. Toll prices are therefore shown as unavailable rather than incorrectly as zero.",
      },
    });
  } catch (error) {
    console.error("Route intelligence error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to calculate this journey right now.",
      },
      { status: 500 },
    );
  }
}
