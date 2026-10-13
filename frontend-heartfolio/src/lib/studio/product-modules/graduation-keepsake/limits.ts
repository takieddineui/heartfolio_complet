/**
 * Field limits, from docs/graduation/graduation-customer-inputs.md. The
 * backend (`graduation_keepsake/data.py`) is authoritative and re-checks
 * every one; these exist so the Studio says so while the customer is typing.
 * `limits.test.ts` reads the backend file and fails if any number differs.
 */
export const LIMITS = {
  name: 24,
  fullName: 40,
  degree: 60,
  school: 60,
  yearText: 12,
  storyText: 140,
  caption: 40,
  achievementTitle: 26,
  achievementDetail: 60,
  achievementPlace: 24,
  groupLabel: 24,
  message: 300,
  goal: 80,
  greeting: 60,
  paragraph: 500,
  signoff: 40,
  signature: 24,
  endingLine: 60,
  endingSub: 80,
  flightField: 30,
  flightNumber: 10,
  flightSeat: 4,
  flightPlace: 24,
  codeLength: 3,
  voiceSeconds: 60,
  stops: { min: 1, max: 12 },
  achievements: { min: 1, max: 10 },
  messageGroups: { min: 1, max: 3 },
  people: { min: 1, max: 12 },
  goals: { min: 1, max: 10 },
  letterBody: { min: 1, max: 6 },
  signatures: { min: 1, max: 12 },
} as const;
