# §19 — AR / VR future direction: scoping

**Written:** 2 September 2026
**Status:** scoping only. §19 is explicitly "not being built now", and nothing
here proposes changing that.
**Companion to:** `heartfolio-discussion-draft.md` §19 and §21,
`IMPLEMENTATION-STATUS.md`.

---

## 1. Most of §19's AR half has already been built

§19 was written as a "think about this for later" topic. §21 then confirmed
and specified an AR Pack system, and that has now been built. So the first
useful thing this document can do is say what is left, rather than re-scope
work that exists.

§19 described AR as: *a printed poster becomes an AR trigger — scanning it
plays a video, animation, or opens the `__live__` keepsake.* Comparing that
against what §21 delivered:

| §19's description | Where it stands |
|---|---|
| Works in a phone browser, no app download | **Built.** MindAR + Three.js, `/ar/<id>` |
| A viewer page | **Built.** Access endpoint + scene, §21f security |
| "Doesn't require a new product system" | **Confirmed.** AR is a `DeliveryPack`; one new table |
| A way to turn a printed image into an AR marker | **Not built.** This is the real remainder |
| Tooling and pricing need real research | **Answered below** — and the answer changed |

The gap is narrower than §19 implies, and it is specific: **turning each
customer's own printed poster into a recognizable tracking target.** That is
`ar-print`, which §21j reserves architecturally and explicitly does not
build.

---

## 2. The tooling and pricing question has a different answer than it did

§19 says tooling and pricing "need real research whenever this is seriously
considered", noting that some capable platforms are free at small scale and
paid beyond it. That framing was correct when written and is now largely
obsolete.

**8th Wall — the platform that framing was about — no longer has a paid
tier.** Niantic retired the hosted platform on 28 February 2026 and released
8th Wall as free and open source. Their own FAQ is unambiguous: all paid
subscriptions ended on that date, there is no paid tier, and no account is
required. Commercial use is permitted. It ships an **Image Target
Processor** as an open-source utility, which is precisely the "turn an image
into a marker" tool `ar-print` needs.

For context on how much the ground moved: commercial licences were $3,000
per project per month until September 2024, dropped to $700, and are now
zero. Wikitude, another name that would have appeared in this research,
reached end-of-life in September 2024 after its Qualcomm acquisition.

**What this means for Heartfolio.** The pricing risk §19 was hedging against
has substantially evaporated. Both realistic options — MindAR (MIT, already
used in §21) and 8th Wall's open-source tools — are free at any scale, with
no per-view licensing and no vendor able to reprice a feature already
printed on a customer's card.

**What it does not mean.** "Free" is not "no cost". A per-order tracking
target is CPU, storage and a failure mode; see below. And an open-source
project that was recently a commercial product carries its own risk —
whether Niantic Spatial keeps investing after retiring the revenue is not
knowable from here. MindAR's independence is worth something precisely
because it was never a commercial platform.

---

## 3. The real obstacle is not tooling, and it is specific to your aesthetic

This is the finding I would most want on the table before `ar-print` is
costed, because it is not in §19 or §21 and it is not a tooling problem.

Image-target tracking works by extracting **feature points** — small,
high-contrast, non-repeating patches the tracker can recognize from an
angle, in poor light, partly obscured by a hand. Photographs and dense
illustrations are rich in them. What is poor in them:

- large areas of flat colour
- thin type on a plain ground
- symmetric or repeating layouts
- restrained, high-negative-space composition

That last list is a fair description of Heartfolio's art direction. A Love
Story Timeline is deliberately a quiet vertical line of small text on a
mostly empty field. **It is close to the worst case for image tracking**, and
this is the same property that makes the posters beautiful.

The consequence is not "AR won't work". It is that tracking quality will
vary per customer in a way nobody controls: a timeline with five photos will
track well, and the same product with dates and words alone may barely track
at all. Two customers buy the same thing and one of them has a keepsake that
does not respond.

**This is testable cheaply and should be tested before anything is costed.**
Compile targets from three or four real rendered posters — one photo-heavy,
one text-only, one dark palette, one light — with MindAR's compiler or 8th
Wall's Image Target Processor, and see what feature counts come back and how
they behave on a phone at arm's length. That is an afternoon, and it decides
whether `ar-print` is a product or a support burden.

**It also bears directly on §21's open question.** §21i leaves undecided
whether each AR Card needs its own tracking target or one shared target
serves all. The §21 implementation assumes shared. If per-order targets turn
out to be necessary for the *card*, the same feature-density problem applies
there too — and the shared-target assumption is exactly what protects §21
from it today, because a single well-designed target can be made
feature-rich on purpose.

---

## 4. What `ar-print` would actually cost to build

Assuming the tracking test above is favourable, the work divides cleanly:

**Per-order target generation.** Each purchase compiles a `.mind` (or 8th
Wall equivalent) target from that customer's rendered artwork, stored
alongside the deliverables in R2. Compilation is CPU-heavy and slow enough
that it does not belong in the webhook path — the same reasoning that keeps
the §12 email outside the transaction. It wants a job queue, which this
project does not currently have. **That is the largest single new piece of
infrastructure `ar-print` implies**, and it is worth naming plainly: the
first background worker.

**Quality gating.** If feature density varies by customer, a compile that
produces a weak target should be detectable and the customer should not be
sold an experience that will not track. This is the same shape as §7d's
sellability guard — the pattern already exists.

**The scene itself.** Already built for §21 and largely reusable. The
difference is what it anchors to.

**What does not need building:** the pack, the entitlement, the access URL,
the security model, the QR code, the revocation field. All of that is §21 and
is done. `ar-print` is a target-generation pipeline attached to an
architecture that already exists — which is what §19 predicted, and it was
right.

---

## 5. VR: agree with the plan, with one thing worth watching

§19's recommendation — distant "maybe someday", AR first, revisit only after
AR proves out — still holds, and nothing found here changes it. Headset
ownership remains a small fraction of any general gift-buying audience, and
a keepsake most recipients cannot open is not a keepsake.

The one thing that would move it: WebXR reaching parity on phones, so that
"VR" means a browser tab rather than hardware. That is not a headset-adoption
question and would not be signalled by headset sales — which is why it is
worth watching separately from the thing §19 says to watch.

Even then, §19's substantive objection stands independently: VR needs real
3D scene design rather than flat image composition, and every Heartfolio
product today is a 2D composition. That is a design capability, not a
technical dependency, and no amount of browser support removes it.

---

## 6. Recommendation

1. **Do nothing further on VR.** The plan's position is correct and this
   research supports it.
2. **Run the feature-density test before costing `ar-print`.** It is an
   afternoon and it is the only thing that determines whether the feature
   is viable for this specific art direction.
3. **Treat the tooling question as answered.** Both realistic options are
   free with no per-view licensing. This is no longer a reason to defer.
4. **Finish §21 before extending it.** The AR Card scene has never run on a
   device and its `.mind` target does not exist, because the card artwork
   has not been designed. Proving one AR product end-to-end will teach more
   about `ar-print` than any further scoping — including whether the
   shared-target assumption survives.

---

*Sources for §2: 8th Wall's own site and FAQ (8thwall.org), retired
28 February 2026; prior commercial pricing from their September 2024
announcement. Verified 2 September 2026 — this is a fast-moving area and
worth re-checking before acting.*
