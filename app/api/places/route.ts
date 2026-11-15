import {
  NextRequest,
  NextResponse
} from "next/server";


/* =========================================================
   PLACE TYPE
   ========================================================= */

type Place = {
  title: string;
  description: string;
  image: string | null;
  lat: number;
  lon: number;
  source: string;
  mapsUrl: string;
  category: string;
};


/* =========================================================
   APP IDENTIFICATION
   ========================================================= */

const USER_AGENT =
  "TripPilot/1.0 (free attraction discovery)";
const GEOCODING_TIMEOUT_MS = 5000;
const WIKIPEDIA_TIMEOUT_MS = 6000;
const OVERPASS_LOOKUP_TIMEOUT_MS = 7000;
const OVERPASS_ENDPOINT_TIMEOUT_MS = 4500;
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

async function fetchOverpass(query: string) {
  const deadline =
    Date.now() + OVERPASS_LOOKUP_TIMEOUT_MS;
  let lastError: unknown;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(
          Math.min(OVERPASS_ENDPOINT_TIMEOUT_MS, remainingMs),
        ),
        next: { revalidate: 86400 },
      });

      if (!response.ok) {
        throw new Error(
          `OpenStreetMap search returned status ${response.status}`,
        );
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("OpenStreetMap search is temporarily unavailable");
}


/* =========================================================
   CREATE GOOGLE MAPS LINK
   ========================================================= */

function createMapsUrl(
  title: string,
  lat: number,
  lon: number
) {
  const query = encodeURIComponent(
    `${title} @${lat},${lon}`
  );

  return (
    "https://www.google.com/maps/search/" +
    `?api=1&query=${query}`
  );
}


/* =========================================================
   IDENTIFY ATTRACTION CATEGORY
   ========================================================= */

function getOsmCategory(
  tags: Record<string, string>
) {
  const category =
    tags.tourism ||
    tags.historic ||
    tags.leisure ||
    tags.amenity ||
    tags.natural ||
    "attraction";

  return category
    .replaceAll("_", " ")
    .replace(
      /\b\w/g,
      (letter) => letter.toUpperCase()
    );
}


/* =========================================================
   CREATE ATTRACTION DESCRIPTION
   ========================================================= */

function createDescription(
  title: string,
  category: string,
  location: string
) {
  return (
    `${title} is a mapped ` +
    `${category.toLowerCase()} near ${location}. ` +
    "Open it in Google Maps to check directions, " +
    "visitor information and reviews."
  );
}


/* =========================================================
   SEARCH NEARBY ATTRACTIONS
   ========================================================= */

export async function GET(
  request: NextRequest
) {
  const location = request.nextUrl.searchParams
    .get("location")
    ?.trim();

  if (!location) {
    return NextResponse.json(
      {
        error: "Location is required"
      },
      {
        status: 400
      }
    );
  }

  try {
    /* =====================================================
       FIND THE DESTINATION COORDINATES
       ===================================================== */

    const geocodingParameters =
      new URLSearchParams({
        q: location,
        format: "json",
        limit: "1",
        addressdetails: "1"
      });

    const geocodingResponse = await fetch(
      "https://nominatim.openstreetmap.org/search?" +
        geocodingParameters.toString(),

      {
        headers: {
          "User-Agent": USER_AGENT
        },
        signal: AbortSignal.timeout(
          GEOCODING_TIMEOUT_MS,
        ),
        next: {
          revalidate: 86400
        }
      }
    );

    if (!geocodingResponse.ok) {
      throw new Error(
        "Location lookup failed"
      );
    }

    const matchingLocations =
      await geocodingResponse.json();

    if (
      !Array.isArray(matchingLocations) ||
      matchingLocations.length === 0
    ) {
      return NextResponse.json({
        places: [],

        message:
          `We could not verify ${location} ` +
          "on the map."
      });
    }

    const matchedLocation =
      matchingLocations[0];

    const latitude = Number(
      matchedLocation.lat
    );

    const longitude = Number(
      matchedLocation.lon
    );


    /* =====================================================
       BUILD OPENSTREETMAP ATTRACTION QUERY
       ===================================================== */

    const searchRadius = 15000;

    const nearbyLocation =
      `around:${searchRadius},` +
      `${latitude},${longitude}`;

    const overpassQuery = `
      [out:json][timeout:8];

      (
        nwr(${nearbyLocation})
          [tourism~"attraction|museum|viewpoint|gallery|zoo|theme_park"];

        nwr(${nearbyLocation})
          [historic~"castle|fort|monument|memorial|archaeological_site|ruins"];

        nwr(${nearbyLocation})
          [amenity="place_of_worship"]
          [name];

        nwr(${nearbyLocation})
          [leisure~"park|nature_reserve"];

        nwr(${nearbyLocation})
          [natural~"beach|waterfall|peak|cave_entrance"];
      );

      out center tags 45;
    `;


    /* =====================================================
       BUILD WIKIPEDIA QUERY
       ===================================================== */

    const wikipediaParameters =
      new URLSearchParams({
        action: "query",

        generator: "geosearch",

        ggsprimary: "all",

        ggsnamespace: "0",

        ggsradius: "10000",

        ggslimit: "24",

        ggscoord:
          `${latitude}|${longitude}`,

        prop:
          "coordinates|pageimages|extracts",

        piprop: "thumbnail",

        pithumbsize: "900",

        exintro: "1",

        explaintext: "1",

        exsentences: "2",

        format: "json",

        origin: "*"
      });


    /* =====================================================
       FETCH OPENSTREETMAP AND WIKIPEDIA DATA
       ===================================================== */

    const [overpassResult, wikipediaResult] =
      await Promise.allSettled([
        fetchOverpass(overpassQuery),
        fetch(
          "https://en.wikipedia.org/w/api.php?" +
            wikipediaParameters.toString(),
          {
            signal: AbortSignal.timeout(
              WIKIPEDIA_TIMEOUT_MS,
            ),
            next: {
              revalidate: 86400
            }
          }
        ).then((response) => {
          if (!response.ok) {
            throw new Error(
              `Wikipedia search returned status ${response.status}`,
            );
          }

          return response.json();
        })
      ]);

    if (
      overpassResult.status === "rejected" &&
      wikipediaResult.status === "rejected"
    ) {
      throw new Error(
        "Attraction data providers are temporarily unavailable.",
      );
    }

    if (overpassResult.status === "rejected") {
      console.warn(
        "OpenStreetMap attractions could not be loaded:",
        overpassResult.reason,
      );
    }

    if (wikipediaResult.status === "rejected") {
      console.warn(
        "Wikipedia attractions could not be loaded:",
        wikipediaResult.reason,
      );
    }

    const overpassData =
      overpassResult.status === "fulfilled"
        ? overpassResult.value
        : { elements: [] };

    const wikipediaData =
      wikipediaResult.status === "fulfilled"
        ? wikipediaResult.value
        : {};


    /* =====================================================
       EXCLUDE IRRELEVANT SEARCH RESULTS
       ===================================================== */

    const blockedTerms =
      /station|railway|junction|village|district|constituency|municipal council|highway|politician|actor|film|album/i;


    /* =====================================================
       FORMAT WIKIPEDIA ATTRACTIONS
       ===================================================== */

    const wikipediaPages = Object.values(
      wikipediaData?.query?.pages || {}
    );

    const wikipediaPlaces: Place[] =
      wikipediaPages

        .map((page: any) => {
          const placeLatitude = Number(
            page.coordinates?.[0]?.lat
          );

          const placeLongitude = Number(
            page.coordinates?.[0]?.lon
          );

          return {
            title: page.title,

            description:
              page.extract ||
              "Verified nearby place from Wikipedia.",

            image:
              page.thumbnail?.source ||
              null,

            lat: placeLatitude,

            lon: placeLongitude,

            source:
              "https://en.wikipedia.org/" +
              `?curid=${page.pageid}`,

            mapsUrl: createMapsUrl(
              page.title,
              placeLatitude,
              placeLongitude
            ),

            category:
              "Wikipedia Landmark"
          };
        })

        .filter((place: Place) => {
          return (
            Number.isFinite(place.lat) &&
            Number.isFinite(place.lon) &&
            place.description.length > 70 &&
            !blockedTerms.test(place.title)
          );
        });


    /* =====================================================
       FORMAT OPENSTREETMAP ATTRACTIONS
       ===================================================== */

    const openStreetMapPlaces: Place[] =
      (overpassData.elements || [])

        .map((item: any) => {
          const tags =
            item.tags || {};

          const title =
            tags["name:en"] ||
            tags.name;

          const placeLatitude = Number(
            item.lat ??
              item.center?.lat
          );

          const placeLongitude = Number(
            item.lon ??
              item.center?.lon
          );

          if (!title) {
            return null;
          }

          if (
            !Number.isFinite(
              placeLatitude
            )
          ) {
            return null;
          }

          if (
            !Number.isFinite(
              placeLongitude
            )
          ) {
            return null;
          }

          if (
            blockedTerms.test(title)
          ) {
            return null;
          }

          const category =
            getOsmCategory(tags);

          return {
            title,

            description:
              createDescription(
                title,
                category,
                location
              ),

            image:
              tags.image ||
              null,

            lat:
              placeLatitude,

            lon:
              placeLongitude,

            source:
              "https://www.openstreetmap.org/" +
              `${item.type}/${item.id}`,

            mapsUrl:
              createMapsUrl(
                title,
                placeLatitude,
                placeLongitude
              ),

            category
          };
        })

        .filter(Boolean) as Place[];


    /* =====================================================
       REMOVE DUPLICATE ATTRACTIONS
       ===================================================== */

    const seenPlaces =
      new Set<string>();

    const allPlaces = [
      ...wikipediaPlaces,

      ...openStreetMapPlaces
    ];

    const uniquePlaces =
      allPlaces.filter((place) => {
        const normalizedTitle =
          place.title

            .toLowerCase()

            .replace(
              /[^a-z0-9]/g,
              ""
            );

        if (!normalizedTitle) {
          return false;
        }

        if (
          seenPlaces.has(
            normalizedTitle
          )
        ) {
          return false;
        }

        seenPlaces.add(
          normalizedTitle
        );

        return true;
      });


    /* =====================================================
       PRIORITIZE ATTRACTIONS WITH IMAGES
       ===================================================== */

    const places = uniquePlaces

      .sort(
        (first, second) => {
          return (
            Number(
              Boolean(second.image)
            ) -

            Number(
              Boolean(first.image)
            )
          );
        }
      )

      .slice(0, 12);


    /* =====================================================
       RETURN RESULTS
       ===================================================== */

    return NextResponse.json({
      location:
        matchedLocation.display_name,

      coordinates: {
        lat: latitude,

        lon: longitude
      },

      places,

      providers: [
        ...(overpassResult.status === "fulfilled"
          ? ["OpenStreetMap"]
          : []),
        ...(wikipediaResult.status === "fulfilled"
          ? ["Wikipedia", "Wikimedia Commons"]
          : [])
      ]
    });
  } catch (error) {
    console.error(
      "Free attraction search error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Verified place search is temporarily unavailable."
      },

      {
        status: 502
      }
    );
  }
}