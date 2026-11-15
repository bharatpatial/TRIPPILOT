"use client";

import { useState } from "react";

export type FeaturedTripPreset = {
  name: string;
  className: string;
  days: number;
  travelType: string;
  description: string;
};

type Props = {
  onSelect: (destination: string) => void;
  onPlan: (destination: FeaturedTripPreset) => void;
};

const destinations: FeaturedTripPreset[] = [
  {
    name: "Manali",
    className: "manali",
    days: 4,
    travelType: "Adventure",
    description: "Mountain scenery and outdoor exploring",
  },
  {
    name: "Goa",
    className: "goa",
    days: 5,
    travelType: "Relaxation",
    description: "Beaches, local food and a slower pace",
  },
  {
    name: "Jaipur",
    className: "jaipur",
    days: 3,
    travelType: "Family",
    description: "Palaces, markets and cultural sights",
  },
  {
    name: "London",
    className: "london",
    days: 5,
    travelType: "Friends",
    description: "City landmarks, museums and food",
  },
  {
    name: "Switzerland",
    className: "switzerland",
    days: 6,
    travelType: "Romantic",
    description: "Alpine scenery and relaxed days",
  },
  {
    name: "Egypt",
    className: "egypt",
    days: 5,
    travelType: "Adventure",
    description: "Historic sites and guided exploration",
  },
];

export default function FeaturedDestinations({
  onSelect,
  onPlan,
}: Props) {
  const [selectedTrip, setSelectedTrip] =
    useState<FeaturedTripPreset | null>(null);

  return (
    <div className="plannerMain">
      <div className="welcome">
        <span>PLAN WITH INTELLIGENCE</span>
        <h1>
          Where will your next
          <br />
          <em>story begin?</em>
        </h1>
        <p>
          You’re the pilot. Zoya is your copilot. Together, we make your
          trip easier to design.
        </p>
      </div>

      <div className="destinationStrip">
        {destinations.map((destination) => (
          <div className="destinationOption" key={destination.name}>
            <button
              type="button"
              className={`destinationPhoto ${destination.className}`}
              onClick={() => onSelect(destination.name)}
              aria-label={`Ask Zoya to show attractions in ${destination.name}`}
            >
              <span>
                {destination.name}
                <small>Explore attractions →</small>
              </span>
            </button>
            <button
              type="button"
              className="destinationPlanAction"
              onClick={() => {
                setSelectedTrip(destination);
                onPlan(destination);
              }}
              aria-label={`Use the ${destination.name} trip idea`}
            >
              Use this trip
            </button>
          </div>
        ))}
      </div>

      {selectedTrip && (
        <div className="featuredTripPreview" aria-live="polite">
          <div>
            <strong>
              {selectedTrip.name} · {selectedTrip.days} days ·{" "}
              {selectedTrip.travelType}
            </strong>
            <p>
              {selectedTrip.description}. Add your starting point and dates
              in the planner to continue.
            </p>
          </div>
          <span>Trip idea selected ✓</span>
        </div>
      )}

      <div className="happyTravellers">
        <span>
          <i>A</i>
          <i>R</i>
          <i>M</i>
        </span>
        <div>
          <b>12,000+ happy travellers</b>
          <small>Journeys planned with Zoya</small>
        </div>
      </div>
    </div>
  );
}
