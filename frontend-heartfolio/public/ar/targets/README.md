# AR tracking targets

`heartfolio-card.mind` belongs here — the compiled target for the SHARED AR
card, whose artwork is identical for every customer.

It is **not committed yet**. Generate it with `tools/compile-shared-target`;
that directory's README has the steps.

Per-order cards do not use this file. Their targets are compiled in the
buyer's browser at checkout and stored in R2 against the experience.
