"use client";

import {
  createContext,
  ReactNode,
  SetStateAction,
  useContext,
  useMemo,
  useState,
} from "react";

export type JourneyRouteOption = {
  id: number;
  distanceKm: number;
  durationMinutes: number;
  geometry: { coordinates: [number, number][] };
};

export type JourneyFacility = {
  id: string;
  name: string;
  category: "restaurant" | "fuel" | "cng" | "toll";
  lat: number;
  lon: number;
  distanceFromRouteKm: number;
  distanceAlongRouteKm: number;
  details: string[];
  sourceUrl: string;
  mapsUrl: string;
};

export type JourneyResult = {
  origin: string;
  destination: string;
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  routes: JourneyRouteOption[];
  facilities: JourneyFacility[];
  facilitiesWarning: string;
  placesProvider: "Geoapify" | "OpenStreetMap";
  tollPricing?: {
    status: "unavailable" | "available";
    total: number | null;
    currency: string;
    provider: string | null;
    message: string;
  };
  dataNotes: { routing: string; places: string; tolls: string };
};

export type JourneyCategory = "all" | JourneyFacility["category"];

export type JourneyPlannerState = {
  origin: string | null;
  destination: string | null;
  result: JourneyResult | null;
  selectedRoute: number;
  category: JourneyCategory;
  mileage: string;
  fuelPrice: string;
  tollEstimate: string;
};

const initialJourneyState: JourneyPlannerState = {
  origin: null,
  destination: null,
  result: null,
  selectedRoute: 0,
  category: "all",
  mileage: "15",
  fuelPrice: "100",
  tollEstimate: "",
};

const JourneyContext = createContext<{
  state: JourneyPlannerState;
  setState: (action: SetStateAction<JourneyPlannerState>) => void;
} | null>(null);

export function JourneyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialJourneyState);
  const value = useMemo(() => ({ state, setState }), [state]);

  return (
    <JourneyContext.Provider value={value}>
      {children}
    </JourneyContext.Provider>
  );
}

export function useJourneyState() {
  const context = useContext(JourneyContext);
  if (!context) {
    throw new Error("useJourneyState must be used inside JourneyProvider.");
  }
  return context;
}
