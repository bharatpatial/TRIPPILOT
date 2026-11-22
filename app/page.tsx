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
      const selectedStart = new Date(
        `${controller.form.start}T12:00:00`,
      );
      const departureDate = Number.isNaN(selectedStart.getTime())
        ? new Date()
        : selectedStart;
      const returnDate = new Date(departureDate);
      returnDate.setDate(returnDate.getDate() + destination.days - 1);
      const returnDateValue = [
        returnDate.getFullYear(),
        String(returnDate.getMonth() + 1).padStart(2, "0"),
        String(returnDate.getDate()).padStart(2, "0"),
      ].join("-");

      controller.setForm({
        ...controller.form,
        destination: destination.name,
        end: returnDateValue,
        travelType: destination.travelType,
      });
      controller.setPreferences(destination.description);
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
          onPlan={planFeaturedTrip}
        />
        <TripPlannerForm controller={controller} />
      </section>
    </TripPilotShell>
  );
}
