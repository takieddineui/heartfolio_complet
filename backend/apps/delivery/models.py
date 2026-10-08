"""Public experience access records (§21d, §10).

ONE TABLE FOR BOTH HOSTED EXPERIENCES — and this reverses an earlier note in
this file, deliberately.

It originally said AR was "deliberately not shared with `__live__`", because
`__live__` was then a self-contained HTML file the customer downloaded: a
different kind of thing entirely, with no public identifier and no access
rules.

§10 changed that. The Digital keepsake is now a hosted page, and it needs
precisely what AR needs — a permanent unguessable identifier, one-to-one
with an entitlement, revocable, reachable with no session. The §21f security
requirements apply to it word for word.

Duplicating that surface into a second model would mean two implementations
of the same generic-404 rule, the same revocation check, the same "never
list, never expose in bulk" discipline — and the one that drifted would be
whichever nobody was looking at. `kind` distinguishes them; everything else
is shared because everything else genuinely is the same.

NO RENDERED CONTENT IS STORED (§21e). Visiting the URL renders fresh from
`Project.data` every time, the same "render on demand, nothing persisted"
principle as every other deliverable. What is new is not stored output — it
is that the identifier pointing at that render no longer expires.

THE ID IS A BEARER CREDENTIAL (§21f). The person scanning the QR is the gift
recipient, who has no Heartfolio session and never will. Possession of the
URL is the access mechanism, which is a deliberate, scoped departure from
session+ownership gating everywhere else — and it makes the primary key a
security boundary rather than a database detail. `uuid4` is
cryptographically random and non-sequential; nothing about it is derived
from the order, the customer or the entitlement.
"""

import uuid

from django.db import models

from apps.commerce.models import Entitlement


class PublicExperience(models.Model):
    #: §21 — camera-driven, anchored to a printed card or shown on screen.
    KIND_AR = "ar"
    #: §10 — the Digital keepsake, a hosted page.
    KIND_LIVE = "live"
    KIND_CHOICES = ((KIND_AR, "AR"), (KIND_LIVE, "Live keepsake"))

    STATUS_ACTIVE = "active"
    STATUS_REVOKED = "revoked"
    STATUS_CHOICES = ((STATUS_ACTIVE, "Active"), (STATUS_REVOKED, "Revoked"))

    #: Doubles as the public identifier in the access URL. See the note
    #: above — this is a bearer credential, not just a key.
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    #: One-to-one, reusing the existing ownership chain
    #: (Entitlement → Order → Customer) rather than inventing another.
    #: One experience per entitlement, and an entitlement is already
    #: specific to a target — so a customer who bought both AR and the live
    #: page gets two rows with two independent links, which is correct:
    #: revoking one must not revoke the other.
    entitlement = models.OneToOneField(
        Entitlement, on_delete=models.CASCADE, related_name="public_experience"
    )
    kind = models.CharField(max_length=10, choices=KIND_CHOICES, default=KIND_AR)

    #: Not wired to any flow yet — no refund system exists anywhere in this
    #: project today. Included now so revocation does not need a later
    #: migration on a table holding live customer links (§21d).
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_ACTIVE)

    #: §21i — the compiled image-tracking target for a PER-ORDER card.
    #:
    #: Null for a shared-target card, which uses a `.mind` shipped with the
    #: app and needs nothing stored per customer.
    #:
    #: Compiled in the BUYER'S browser at checkout, because MindAR's
    #: compiler is JavaScript and running it server-side would mean Node,
    #: node-canvas and TensorFlow.js in a Python image — roughly half a
    #: gigabyte and a second runtime, for a job that runs once per order.
    #:
    #: Doing it at checkout rather than at first scan puts the wait on
    #: someone already engaged in a purchase, instead of on the gift
    #: recipient whose first thirty seconds are the point of the product.
    #: First-scan compilation remains the FALLBACK for when the buyer's tab
    #: closed or their device could not manage it.
    target_key = models.CharField(max_length=255, blank=True, default="")
    target_compiled_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "public_experiences"
        indexes = [
            models.Index(fields=["-created_at"], name="idx_experience_created"),
            models.Index(fields=["kind", "-created_at"], name="idx_experience_kind"),
        ]

    def __str__(self) -> str:
        return f"{self.kind} {self.id} ({self.status})"

    @property
    def needs_target(self) -> bool:
        """True when this experience still has no compiled target.

        Read by the AR page to decide whether to fall back to compiling on
        the spot. A shared-target card never needs one, so this is only ever
        True for a per-order card whose checkout-time compilation did not
        complete.
        """
        return not self.target_key

    @property
    def is_accessible(self) -> bool:
        """Revoked means genuinely inaccessible, not merely unlisted (§21f)."""
        return self.status == self.STATUS_ACTIVE
