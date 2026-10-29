/**
 * The names the intro's inline scripts and the live page share. A plain
 * module ON PURPOSE: `live-intro.tsx` is a server component, and constants
 * imported from a "use client" module reach the server as client
 * references, not strings (the first build wrote an error message into the
 * scripts instead of the id; `live-intro.test.tsx` renders the server markup
 * to catch it).
 */
export const INTRO_STATE_ID = "hf-intro-state";
export const INTRO_ID = "hf-live-intro";
export const INTRO_DONE_EVENT = "heartfolio:intro-done";
export const LIVE_READY_EVENT = "heartfolio:live-ready";
