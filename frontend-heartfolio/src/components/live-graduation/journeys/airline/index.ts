import type { JourneyDefinition } from "../types";
import styles from "./airline.module.css";
import { AirlineStart } from "./start";
import { AirlinePage } from "./page";
import { AirlineFinale } from "./finale";
import { AIRLINE_KIT, AIRLINE_PARTICLE_COLORS, airlineParticle } from "./sounds";

/** Next Chapter Airways: tear the boarding pass, stamp a passport, take off. */
export const airline: JourneyDefinition = {
  id: "airline",
  themeColor: "#0f2742",
  Start: AirlineStart,
  Page: AirlinePage,
  Finale: AirlineFinale,
  rootClass: styles.root!,
  kit: AIRLINE_KIT,
  particle: airlineParticle,
  particleColors: AIRLINE_PARTICLE_COLORS,
};
