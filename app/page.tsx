"use client";

import { useCallback, useEffect, useState } from "react";
import FeaturedDestinations, {
  FeaturedTripPreset,
} from "./components/FeaturedDestinations";
import TripPilotIntro from "./components/TripPilotIntro";
import TripPlannerForm from "./components/TripPlannerForm";
import {
  TripPilotShell,
  useTripPilot,
} from "./context/TripContext";

let hasShownIntroInCurrentPageLoad = false;

export default function HomePage() {
  const [introComplete, setIntroComplete] = useState(
    hasShownIntroInCurrentPageLoad,
  );
  const finishIntro = useCallback(() => {
    hasShownIntroInCurrentPageLoad = true;
    setIntroComplete(true);
  }, []);

  useEffect(() => {
    hasShownIntroInCurrentPageLoad = true;
  }, []);

  return (
    <>
      {!introComplete && <TripPilotIntro onComplete={finishIntro} />}
      <HomePlanner />
    </>
  );
}

function HomePlanner() {
  const controller = useTripPilot("planner");

  const planFeaturedTrip = useCallback(
    (destination: FeaturedTripPreset) => {
      controller.setForm({
        ...controller.form,
        destination: destination.name,
        travelType: destination.travelType,
      });
      document
        .getElementById("tripPlannerForm")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [controller],
  );

  return (
    <TripPilotShell controller={controller}>
      <section className="plannerScreen">
        <FeaturedDestinations
          onSelect={controller.openFeaturedDestination}
          onPlan={planFeaturedTrip}
        />
        <TripPlannerForm controller={controller} />
      </section>
    </TripPilotShell>
  );
}
