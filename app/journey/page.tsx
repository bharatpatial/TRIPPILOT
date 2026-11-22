"use client";

import { FormEvent, useMemo, useState } from "react";
import { TripPilotShell, useTripPilot } from "../context/TripContext";
import {
  JourneyCategory,
  JourneyPlannerState,
  useJourneyState,
} from "../context/JourneyContext";

const categoryLabels: Record<JourneyCategory, string> = {
  all: "All stops",
  restaurant: "Restaurants",
  fuel: "Petrol & diesel",
  cng: "CNG stations",
  toll: "Toll points",
};

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours ? `${hours} hr ${remaining} min` : `${remaining} min`;
}

export default function JourneyPage() {
  const controller = useTripPilot("journey");
  const { state: journeyState, setState: setJourneyState } = useJourneyState();
  const origin = journeyState.origin ?? "";
  const destination = journeyState.destination ?? "";
  const { result, selectedRoute, category, mileage, fuelPrice, tollEstimate } =
    journeyState;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function updateJourney(patch: Partial<JourneyPlannerState>) {
    setJourneyState((current) => ({ ...current, ...patch }));
  }

  async function calculateRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    updateJourney({ origin, destination, result: null });
    setLoading(true);
    try {
      const response = await fetch("/api/route-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, destination }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not calculate the route.");
      updateJourney({
        result: payload,
        selectedRoute: 0,
        category: "all",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const activeRoute = result?.routes[selectedRoute];
  const routeMap = useMemo(() => {
    if (!activeRoute?.geometry.coordinates?.length) return null;
    const coordinates = activeRoute.geometry.coordinates;
    const extraCoordinates = selectedRoute === 0
      ? (result?.facilities || []).map((facility) => [facility.lon, facility.lat] as [number, number])
      : [];
    const boundsCoordinates = [...coordinates, ...extraCoordinates];
    const bounds = boundsCoordinates.reduce((value, point) => ({
      minLon: Math.min(value.minLon, point[0]),
      maxLon: Math.max(value.maxLon, point[0]),
      minLat: Math.min(value.minLat, point[1]),
      maxLat: Math.max(value.maxLat, point[1]),
    }), { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity });
    const { minLon, maxLon, minLat, maxLat } = bounds;
    const lonSpan = maxLon - minLon || 0.01;
    const latSpan = maxLat - minLat || 0.01;
    const project = (lon: number, lat: number) => ({
      x: 28 + ((lon - minLon) / lonSpan) * 544,
      y: 252 - ((lat - minLat) / latSpan) * 224,
    });
    return {
      routePoints: coordinates.map(([lon, lat]) => {
        const point = project(lon, lat);
        return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
      }).join(" "),
      start: project(coordinates[0][0], coordinates[0][1]),
      end: project(coordinates[coordinates.length - 1][0], coordinates[coordinates.length - 1][1]),
      facilities: selectedRoute === 0 ? (result?.facilities || []).map((facility) => ({
        ...project(facility.lon, facility.lat),
        id: facility.id,
        category: facility.category,
      })) : [],
    };
  }, [activeRoute, result, selectedRoute]);
  const filteredFacilities = useMemo(() => {
    if (!result) return [];
    return result.facilities.filter((facility) => category === "all" || facility.category === category);
  }, [result, category]);

  const fuelCost = activeRoute && Number(mileage) > 0 && Number(fuelPrice) >= 0
    ? Math.round((activeRoute.distanceKm / Number(mileage)) * Number(fuelPrice))
    : 0;
  const tollValue = tollEstimate.trim() === "" ? 0 : Math.max(0, Number(tollEstimate) || 0);
  const tollPriceKnown = Boolean(result?.tollPricing?.status === "available" && typeof result.tollPricing.total === "number");
  const estimatedJourneyCost = fuelCost + (tollPriceKnown ? Number(result?.tollPricing?.total || 0) : tollValue);
  const googleMapsUrl = result
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(result.origin)}&destination=${encodeURIComponent(result.destination)}&travelmode=driving`
    : "";
  const osmDirectionsUrl = result
    ? `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${result.start.lat}%2C${result.start.lon}%3B${result.end.lat}%2C${result.end.lon}`
    : "";

  return (
    <TripPilotShell controller={controller}>
      <main className="featurePage journeyPlannerPage">
        <div className="featureHeading">
          <span>SMARTER JOURNEYS START HERE</span>
          <h1>Road Trip Planner</h1>
          <p>Compare driving routes, discover useful stops and estimate your road-trip expenses.</p>
        </div>

        <form className="journeySearchPanel" onSubmit={calculateRoute}>
          <label>
            STARTING POINT
            <input value={origin} onChange={(event) => updateJourney({ origin: event.target.value })} placeholder="e.g. Ferozepur, Punjab" required />
          </label>
          <span className="journeySearchArrow">→</span>
          <label>
            DESTINATION
            <input value={destination} onChange={(event) => updateJourney({ destination: event.target.value })} placeholder="e.g. Manali, Himachal Pradesh" required />
          </label>
          <button type="submit" disabled={loading || !origin.trim() || !destination.trim()}>
            {loading ? "Finding routes…" : "Find my route"}
          </button>
        </form>

        {error && <div className="journeyAlert journeyAlertError" role="alert">{error}</div>}

        {!result && !loading && !error && (
          <section className="journeyWelcome">
            <div className="journeyWelcomeIcon">⌁</div>
            <h2>Your road journey, made smarter</h2>
            <p>Enter your starting point and destination to see driving route options, food stops, fuel stations and mapped toll points.</p>
            <button type="button" onClick={() => updateJourney({ origin: "Ferozepur, Punjab", destination: "Manali, Himachal Pradesh" })}>Try a sample route</button>
          </section>
        )}

        {loading && (
          <div className="journeyLoading" role="status" aria-live="polite">
            <div className="journeyStage journeyTrack-road" aria-hidden="true">
              <div className="journeyTrack" />
              <svg className="journeyLoadingCar" viewBox="0 0 64 32">
                <path d="M3 20h4l4-9c1.4-3 4-4.5 7.3-4.5h19c5 0 8.6 2.5 11.2 6.5l4.4 7H58a3 3 0 0 1 3 3v3H3z" fill="currentColor" />
                <path d="M15.5 12.2 18 9.5c.7-.8 1.8-1.2 3-1.2h7.5v8.5H13.4zm15.2-3.9h6.6c3.5 0 6 1.8 8.1 5.2l2.1 3.3H30.7z" fill="#dce7ff" />
                <circle cx="17" cy="25" r="5.5" fill="#263451" />
                <circle cx="17" cy="25" r="2.4" fill="#dce7ff" />
                <circle cx="49" cy="25" r="5.5" fill="#263451" />
                <circle cx="49" cy="25" r="2.4" fill="#dce7ff" />
                <path d="M58 21h2v3h-2z" fill="#ffd36a" />
              </svg>
            </div>
            <span>Calculating routes and searching along the way…</span>
          </div>
        )}

        {result && activeRoute && (
          <>
            <section className="journeyResultHeading">
              <div>
                <span>YOUR ROAD JOURNEY</span>
                <h2>{result.origin} <b>→</b> {result.destination}</h2>
              </div>
              <a href={googleMapsUrl} target="_blank" rel="noreferrer">Open directions in Google Maps ↗</a>
            </section>

            <section className="journeyRouteGrid">
              <div className="journeyRouteList">
                <h3>Available driving routes</h3>
                {result.routes.map((route, index) => (
                  <button key={route.id} type="button" className={`journeyRouteCard ${selectedRoute === index ? "selected" : ""}`} onClick={() => updateJourney({ selectedRoute: index })}>
                    <span className="journeyRouteRadio">{selectedRoute === index ? "●" : "○"}</span>
                    <span className="journeyRouteCardText">
                      <strong>{index === 0 ? "Recommended route" : `Alternative route ${index}`}</strong>
                      <small>{formatDuration(route.durationMinutes)} estimated driving time</small>
                    </span>
                    <span className="journeyRouteNumbers"><b>{route.distanceKm.toLocaleString("en-IN")} km</b><small>{formatDuration(route.durationMinutes)}</small></span>
                  </button>
                ))}
                <p className="journeySourceNote">Route options and travel times are estimates from the public OSRM routing service. Actual traffic and road conditions may differ.</p>
              </div>
              <div className="journeyMapPanel">
                <div className="journeyMapGraphic journeyRealRouteMap">
                  {routeMap && (
                    <svg viewBox="0 0 600 280" role="img" aria-label={`Driving route from ${result.origin} to ${result.destination}`}>
                      <defs>
                        <pattern id="journey-grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M 36 0 L 0 0 0 36" fill="none" stroke="#d5dfd9" strokeWidth="1" /></pattern>
                      </defs>
                      <rect width="600" height="280" fill="#eaf0ed" />
                      <rect width="600" height="280" fill="url(#journey-grid)" />
                      <polyline points={routeMap.routePoints} fill="none" stroke="#ffffff" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
                      <polyline points={routeMap.routePoints} fill="none" stroke="#5269ed" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                      {routeMap.facilities.map((marker) => (
                        <circle key={marker.id} cx={marker.x} cy={marker.y} r="5" fill={marker.category === "toll" ? "#d58a2c" : marker.category === "restaurant" ? "#e16c58" : marker.category === "cng" ? "#168c66" : "#2788c8"} stroke="#fff" strokeWidth="2" />
                      ))}
                      <circle cx={routeMap.start.x} cy={routeMap.start.y} r="11" fill="#5269ed" stroke="#fff" strokeWidth="4" />
                      <text x={routeMap.start.x} y={routeMap.start.y + 4} textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">A</text>
                      <circle cx={routeMap.end.x} cy={routeMap.end.y} r="11" fill="#168c66" stroke="#fff" strokeWidth="4" />
                      <text x={routeMap.end.x} y={routeMap.end.y + 4} textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">B</text>
                    </svg>
                  )}
                  <div className="journeyMapCaption"><b>{activeRoute.distanceKm.toLocaleString("en-IN")} km</b><span>{formatDuration(activeRoute.durationMinutes)}</span></div>
                </div>
                <div className="journeyMapLegend"><span><i className="route" /> Route</span><span><i className="food" /> Food</span><span><i className="fuel" /> Fuel / CNG</span><span><i className="toll" /> Toll point</span></div>
                {selectedRoute !== 0 && <small className="journeySchematicNote">Stop markers are currently loaded for the recommended route only. Recalculate the primary route to refresh nearby stops.</small>}
                <div className="journeyMapLinks">
                  <a href={osmDirectionsUrl} target="_blank" rel="noreferrer">View route on OpenStreetMap ↗</a>
                  <a href={googleMapsUrl} target="_blank" rel="noreferrer">Google Maps ↗</a>
                </div>
              </div>
            </section>

            <section className="journeyCostPanel">
              <div className="journeySectionTitle"><div><span>ROAD-TRIP ESTIMATOR</span><h2>Estimate your driving cost</h2></div><strong>₹{estimatedJourneyCost.toLocaleString("en-IN")}</strong></div>
              <div className="journeyCostInputs">
                <label>Vehicle mileage (km/l)<input type="number" min="1" step="0.1" value={mileage} onChange={(event) => updateJourney({ mileage: event.target.value })} /></label>
                <label>Fuel price (₹/litre)<input type="number" min="0" step="0.1" value={fuelPrice} onChange={(event) => updateJourney({ fuelPrice: event.target.value })} /></label>
                <label>{tollPriceKnown ? "Expected toll total (₹) · provider estimate" : "Toll estimate (₹) · enter manually if known"}<input type="number" min="0" step="1" value={tollPriceKnown ? String(result?.tollPricing?.total ?? 0) : tollEstimate} onChange={(event) => updateJourney({ tollEstimate: event.target.value })} disabled={tollPriceKnown} placeholder="Not available from current map data" /></label>
              </div>
              <div className="journeyCostBreakdown"><span>Estimated fuel cost <b>₹{fuelCost.toLocaleString("en-IN")}</b></span><span>{tollPriceKnown ? "Provider toll estimate" : "Toll price status"} <b>{tollPriceKnown ? `₹${Number(result?.tollPricing?.total || 0).toLocaleString("en-IN")}` : "Not available"}</b></span></div>
              <p>Fuel estimate is for this one-way route. Toll plazas mapped by OpenStreetMap do not include dependable current vehicle-specific fees. TripPilot will not treat missing toll data as ₹0; enter a known amount manually until a toll-pricing provider is connected.</p>
            </section>

            <section className="journeyStopsSection">
              <div className="journeySectionTitle"><div><span>DISCOVER ALONG YOUR ROUTE</span><h2>Useful stops on the way</h2></div><span className="journeyStopsCount">{result.facilities.length} mapped places</span></div>
              <div className="journeyCategoryTabs">
                {(Object.keys(categoryLabels) as JourneyCategory[]).map((key) => (
                  <button key={key} type="button" className={category === key ? "active" : ""} onClick={() => updateJourney({ category: key })}>{categoryLabels[key]} <small>{key === "all" ? result.facilities.length : result.facilities.filter((item) => item.category === key).length}</small></button>
                ))}
              </div>
              {!filteredFacilities.length ? (
                <div className="journeyEmptyStops">No mapped {category === "all" ? "places" : categoryLabels[category].toLowerCase()} were found near this route. Try another route or search again later.</div>
              ) : (
                <div className="journeyFacilityGrid">
                  {filteredFacilities.map((facility) => (
                    <article className="journeyFacilityCard" key={facility.id}>
                      <span className={`journeyFacilityIcon ${facility.category}`}>{facility.category === "restaurant" ? "🍽" : facility.category === "toll" ? "₹" : facility.category === "cng" ? "CNG" : "⛽"}</span>
                      <div className="journeyFacilityInfo"><strong>{facility.name}</strong><small>{categoryLabels[facility.category]} · {facility.distanceFromRouteKm} km from route · {facility.distanceAlongRouteKm} km along route</small>{facility.details.length > 0 && <small>{facility.details.join(" · ")}</small>}</div>
                      <a href={facility.sourceUrl} target="_blank" rel="noreferrer" aria-label={`View ${facility.name} on OpenStreetMap`}>Map</a><a href={facility.mapsUrl} target="_blank" rel="noreferrer" aria-label={`Open ${facility.name} in Google Maps`}>↗</a>
                    </article>
                  ))}
                </div>
              )}
              <p className="journeySourceNote">
                {result.placesProvider === "Geoapify" ? (
                  <>Place search powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a>; toll points use <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap data</a>. Listings may be incomplete, duplicated or outdated. Check opening hours and services before relying on a stop.</>
                ) : (
                  <>Place data comes from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>. Listings may be incomplete, duplicated or outdated. Check opening hours and services before relying on a stop.</>
                )}
              </p>
            </section>

            <section className="journeyZoyaNote"><span>✦</span><div><strong>Independent road-trip planning</strong><p>Your route, stops and driving-cost estimates stay in this section and do not change your TripPilot itinerary.</p></div></section>
            <details className="journeyDataNotes"><summary>About route and toll data</summary><p>{result.dataNotes.routing}</p><p>{result.dataNotes.places}</p><p>{result.dataNotes.tolls}</p></details>
          </>
        )}
      </main>
    </TripPilotShell>
  );
}
