# Digital Graduation Keepsake: Customer Inputs

**Concept: one graduation story, told as a journey.** The creator enters the story once: then, the years, now, what's next, achievements, messages, goals and a letter. Then they choose **which journey** tells it. Each journey has its own opening, look, words, interactions, finale and sound effects. There is no background music; every journey uses sound effects only.

| Journey | Opening | Path through the years | Achievements | Messages | Finale |
|---|---|---|---|---|---|
| **Next Chapter Airways** ✈️ | Tear the stub of a boarding pass | Flight path; a plane flies down it as you scroll | Passport stamps (thud) | Postcards you turn over | Plane rolls down the runway and takes off |
| **Mission: Graduation** 🚀 | 3-2-1 countdown | Trajectory with a satellite | Mission patches that spin in and dock | Radio transmissions you decode, typed out letter by letter | Press and hold to launch the rocket |
| **Level Complete** 👾 | PRESS START arcade screen | World map: World 1, stages 2-1, 3-1… | Locked trophies that unlock with an "Achievement unlocked" banner and jingle | Party characters who talk in a retro dialogue box | Score tally, then "LEVEL COMPLETE!" and "NEW GAME +" |
| **The Retrospective** 🖼️ | Cut a red ribbon at a gallery opening | Gilded frames with museum wall labels | Plinths lit by a spotlight | Numbered audio-guide stops; voice notes play automatically | Red curtains open on the final message |
| **The Summit** ⛰️ | Trailhead sign at dawn | Trail with altitude markers and a live altimeter as you scroll | Flags planted on ridges | Notes left under cairn stones | The sun rises and a flag appears on the peak |

The example values are from the "Maya Chen" prototype. Each field maps to a key in the `GRAD` data object, so this document is also the form spec for the editor and the database schema. Chapter titles and labels come from the chosen journey, so the creator doesn't type them.

**How to read it**

- `[x]` / `[ ]` next to a chapter title means it can be switched **on or off**.
- **Req** means required when the chapter is on. **Opt** means optional.
- Fields are entered in **one language**.
- **(proposed)** means not in the prototype yet.
- **Maximum 10 achievements.**

---

## 0. Setup (always on)

| Field | Key | Type | Req | Example / notes |
|---|---|---|---|---|
| Keepsake name (internal) | `meta.id` | text | Req | `grad-maya-2027`. Also used in the link. |
| Language | `meta.lang` | choice | Req | English |
| Date format region | `meta.locale` | choice | Opt | `en-GB` |
| **Journey** | `journey` | choice | Req | airline / space / arcade / museum / summit |

**Chapter switches** (drag to reorder; maps to `sections`)

- [x] Path through the years (`path`)
- [x] Achievements (`achievements`)
- [x] Messages (`messages`)
- [x] Future goals (`goals`)
- [x] Personal letter (`letter`)

---

## 1. The graduate (always on)

| Field | Key | Type | Req | Example / notes |
|---|---|---|---|---|
| First name | `grad.name` | text | Req | Maya |
| Full name | `grad.fullName` | text | Req | Maya Chen |
| Graduation year | `grad.year` | number | Req | 2027 |
| Degree or qualification | `grad.degree` | text | Req | BA (Hons) Architecture |
| School / university | `grad.school` | text | Req | University of Edinburgh |
| Graduation date | `grad.date` | date | Req | 2 July 2027 |
| Main photo | `grad.photo.src` | image upload | Req | Shown in the cabin window, helmet visor, character frame, gilded portrait or pinned photo, depending on the journey. Also used for "Now". |

---

## 2. [x] Path through the years

| Field | Key | Type | Req | Example / notes |
|---|---|---|---|---|
| **Then**: year, text, photo | `path.then.*` | text, text, image | Req | 2005 · "A five-year-old who drew houses on every wall in the flat." |
| **Stops** (add 1 to 12) | `path.stops[]` | repeatable group | Req | Opens full screen when tapped |
| → Year | `stops[].year` | text | Req | 2010 |
| → Caption | `stops[].caption` | text | Req | "First day of school" |
| → Photo | `stops[].photo.src` | image upload | Req | |
| → Airport code | `stops[].code` | 3 letters | Opt | SCH. Used by the airline journey only. |
| **Now**: year, text | `path.now.*` | text, text | Req | 2027 · "An architect, with a first-class degree to prove it." Uses the main photo. |
| **What's next**: text, photo | `path.next.*` | text, image | Req | "A junior designer role at a studio in Copenhagen." |

---

## 3. [x] Achievements (1 to 10)

| Field | Key | Type | Req | Example / notes |
|---|---|---|---|---|
| Achievements (add 1 to **10**) | `achievements[]` | repeatable group | Req | Revealed one tap at a time |
| → Title | `[].title` | text | Req | "First-class honours" (up to 26 characters) |
| → Detail | `[].detail` | text | Opt | "Top of the year in design studio" |
| → Place | `[].place` | text | Opt | EDINBURGH. Printed on the airline passport stamp. |

---

## 4. [x] Messages

| Field | Key | Type | Req | Example / notes |
|---|---|---|---|---|
| Groups (add 1 to 3) | `messages[]` | repeatable group | Req | Usually "From home" and "From friends" |
| → Group label | `[].label` | text | Req | "From home" |
| → People (add 1 to 12 per group) | `[].people[]` | repeatable group | Req | |
| → → Name | `people[].name` | text | Req | Mum |
| → → Colour | `people[].color` | colour picker | Opt | Postcard, character or note colour |
| → → Emoji | `people[].emoji` | emoji | Opt | 🏡. Used as the postcard stamp, the character's face or the cairn stone's icon. |
| → → Message | `people[].message` | long text | Req | Up to 300 characters |
| → → [ ] Voice message | `people[].voice.src` | audio upload or record | Opt | Up to 1 minute, with optional timed captions |
| → → [ ] Drawing | `people[].drawing.src` | image upload | Opt | |

All messages must be gathered **before** the keepsake is created. **(proposed)** A collection link lets each person send theirs to the organiser.

---

## 5. [x] Future goals

| Field | Key | Type | Req | Example / notes |
|---|---|---|---|---|
| Goals (add 1 to 10) | `goals[]` | repeatable group | Req | Shown as itinerary, mission objectives, quests, future exhibitions or peaks ahead |
| → Goal | `[].text` | text | Req | "Become a fully qualified architect" |
| → Code | `[].code` | 3 letters | Opt | CPH. Used by the airline journey only. |

---

## 6. [x] Personal letter

| Field | Key | Type | Req | Example / notes |
|---|---|---|---|---|
| Greeting | `letter.greeting` | text | Req | "Dear Maya," |
| Paragraphs (add 1 to 6) | `letter.body[]` | repeatable long text | Req | |
| Sign-off | `letter.signoff` | text | Opt | "With all our love," |
| Signatures (add 1 to 12) | `letter.signatures[]` | repeatable text | Req | Mum, Dad, Kai |

---

## 7. Ending, reply and sharing (always on)

| Field | Key | Type | Req | Example / notes |
|---|---|---|---|---|
| Final line | `ending.line` | text | Req | "Congratulations, Maya!" |
| Final subline | `ending.sub` | text | Opt | "Your next chapter starts now." |
| [x] Graduate can reply | `reply.enabled` | checkbox | Opt | The button wording comes from the journey ("Send a postcard back", "Transmit a reply", "Sign the visitors' book"…) |
| → Quick reactions (add 0 to 6) | `reply.reactions[]` | emoji + text | Opt | 🎓 "We did it!" |
| [x] Sound effects | `sound.enabled` | checkbox | Opt | Each journey has its own; the graduate can mute them |
| Show share button | `share.enabled` | checkbox | Opt | On by default |
| Show "Made with Heartfolio" | `branding.show` | checkbox | Opt | On by default |
| Send date and time | n/a | date-time | Opt | **(proposed)** Deliver on graduation day |

---

## 8. Airline journey only: boarding pass

Shown only when the journey is **airline**.

| Field | Key | Type | Req | Example / notes |
|---|---|---|---|---|
| Airline name | `flight.airline` | text | Opt | "Next Chapter Airways" |
| Flight number | `flight.number` | text | Opt | "NC 2027" |
| Seat | `flight.seat` | text | Opt | 1A |
| Class | `flight.cabin` | text | Opt | "First Class Honours" |
| From: code + place | `flight.from.*` | 3 letters + text | Opt | KID · Childhood |
| To: code + place | `flight.to.*` | 3 letters + text | Opt | NXT · What's next |

---

## 9. What the creator receives back

- Started: yes or no, with date, time and journey.
- Whether the graduate reached the finale.
- The graduate's reaction and reply.

---

## After it is created

**Current rule: a product is final once it is created.** Nothing is deleted or lost by this rule. Every field stays exactly as entered.

**What the page keeps doing on its own:**

- Nothing depends on future dates, so it looks the same on graduation day and years later.
- "What's next" and the goals are written as hopes, so they stay true even as plans change.
- The graduate's replies keep being collected.

### Fields that may need to change later (for you to decide)

| Field | Key | Must / Could | Why |
|---|---|---|---|
| Name spelling, degree or school | `grad.*` | Could | Very visible on the opening screen |
| Messages | `messages[].people[]` | Could | Messages often arrive late |
| Graduation-day photos | `grad.photo`, `path.stops[]` | Could | The best photos are taken on the day itself |
| Journey | `journey` | Could | The creator might want to try a different one |
| Typos in any text | all text fields | Could | |
