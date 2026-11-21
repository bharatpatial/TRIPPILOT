# TripPilot Road Trip Planner — first integration

This update adds a standalone **Road Trip Planner** section to the existing Next.js app.

## What's included

- New page: `app/journey/page.tsx`
- New API: `app/api/route-intelligence/route.ts`
- Sidebar navigation entry and route registration in `app/context/TripContext.tsx`
- Matching responsive and dark-mode styles appended to `app/globals.css`
- Uses the existing trip origin, destination and budget fields from `TripContext`.

## Data providers

- **Nominatim / OpenStreetMap**: converts origin and destination names to coordinates.
- **OSRM public routing service**: returns driving route alternatives, distance and estimated duration.
- **Geoapify Places API**: when `GEOAPIFY_API_KEY` is configured, searches restaurants, cafes, fast food and fuel stations along the route corridor in one request. The free plan currently includes 3,000 requests per day and does not require a credit card. Geoapify attribution is shown in the stops section.
- **Overpass API / OpenStreetMap**: fallback when Geoapify is not configured, errors or returns no places; it also supplies mapped toll points where available.

To enable Geoapify, create a free key at [Geoapify MyProjects](https://myprojects.geoapify.com/) and add it to your local `.env.local` file:

```env
GEOAPIFY_API_KEY=your_key_here
```

Keep the key server-side: do not prefix it with `NEXT_PUBLIC_` or commit `.env.local`. Restart the dev server after adding it. See the [Geoapify Places API docs](https://apidocs.geoapify.com/docs/places/) for current limits and terms.

## Run locally

From the project folder:

```bash
npm install
npm run dev
```

Open `http://localhost:3000/journey` or choose **Road Trip Planner** in the sidebar.

## Important data limitations

- This is a first working integration and uses public community services. They can be slow, rate-limited or temporarily unavailable.
- Geoapify's free quota is limited. The OpenStreetMap fallback may also time out or have incomplete local coverage.
- Route distance and duration are estimates; live traffic is not included.
- OpenStreetMap facility coverage varies by area. A missing result does not prove that a business or station does not exist.
- Toll booths/plazas may be mapped, but current vehicle-specific toll fees are not reliably available in OpenStreetMap. The app now marks toll pricing as unavailable instead of silently treating missing prices as ₹0. Automatic toll totals require a licensed toll-pricing provider and credentials.
- Fuel cost is an editable one-way estimate based on the mileage and per-litre price entered by the user.
- The route overview graphic is illustrative. Use the OpenStreetMap or Google Maps links for the actual route map and navigation.
- The combined budget panel compares the existing itinerary estimate with the added route estimate. Check for duplicated transport costs before treating it as a final trip total.

## Next development pass

1. Replace or supplement public routing with a provider suitable for production traffic.
2. Add a reliable toll-price data provider for the regions being supported.
3. Add route corridor distance calculations and richer map markers.
4. Let users save selected stops into the day-wise itinerary and avoid double-counting transport expenses.
5. Add caching, request limits and clearer retry states for public map services.
