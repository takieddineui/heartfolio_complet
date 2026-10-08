"""Wallpaper devices and their safe zones (§4).

Mirrors `src/lib/studio/wallpaper-devices.ts`. The frontend catalog decides
what is offered; this is what turns a target id into pixels and margins at
render time, and the two must agree — both sides assert the same numbers so
a change to one without the other fails a test rather than shipping a
wallpaper whose dimensions contradict what the storefront promised.

WHY A WALLPAPER IS NOT A RESIZED PRINT
--------------------------------------
§4 requires dedicated renders per device rather than scaled copies, and the
safe zones are the reason. A print has no furniture on it. A phone screen is
mostly occupied by things the OS draws on top: the lock-screen clock and
date high up, the home indicator and the first row of icons at the bottom.
A wallpaper that puts a couple's names behind the clock has failed at the
one job it had.

So each device declares the fraction of the canvas that must stay clear of
anything meaningful, and the renderer lays the timeline out inside what is
left. That is a genuinely different composition, which is what §4 asked for.

THESE NUMBERS WANT A REAL DEVICE. §4 defers the pixel spec on purpose
("not something to spec pixel-by-pixel now"), so these are defensible
starting values based on where OS furniture actually sits, not measurements
taken from a screenshot. They live in one place so correcting them after
looking at a real phone is a single edit on each side.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class WallpaperDevice:
    id: str
    width: int
    height: int
    #: Fractions of the canvas kept clear of meaningful content.
    safe_top: float
    safe_bottom: float
    #: Leading edge — the desktop icon column. Logical, not "left": an
    #: Arabic desktop puts that column on the right (§15).
    safe_leading: float


WALLPAPER_DEVICES = {
    # 19.5:9 — the shape most modern phones actually are. The most generous
    # safe zones, because this is the device people actually use.
    "phone": WallpaperDevice("phone", 1290, 2796, 0.18, 0.12, 0.0),
    # 3:4, a large tablet held upright. Bigger screen, so the same furniture
    # occupies proportionally less of it.
    "tablet": WallpaperDevice("tablet", 2048, 2732, 0.12, 0.08, 0.0),
    # 16:9 at 4K. Downscales cleanly to every common desktop resolution;
    # upscaling from 1080p would not.
    "desktop": WallpaperDevice("desktop", 3840, 2160, 0.06, 0.10, 0.10),
}


#: §13 — two kinds of wallpaper, both delivered.
#:
#: `story`  — the whole timeline, adapted to the device.
#: `moment` — ONE milestone, its photograph filling the screen with just
#:            that date and title. Different in kind, not just in crop: a
#:            timeline shrunk to a phone is legible at arm's length and
#:            unreadable on a lock screen, whereas a single memory is the
#:            thing people actually keep as a wallpaper.
#:
#: A customer receives both, and one `moment` per milestone — which is why
#: this multiplies: eight milestones on three devices is 24 files plus the
#: three story wallpapers. That is deliberate and it is why they are named
#: per milestone rather than numbered arbitrarily.
WALLPAPER_KIND_STORY = "story"
WALLPAPER_KIND_MOMENT = "moment"


def wallpaper_target_id(device_id: str) -> str:
    """Keeps the `wallpaper-` prefix, which `infer_delivery_type` already
    classifies — see `_WALLPAPER_TARGET_PREFIXES` in delivery_types.py."""
    return f"wallpaper-{device_id}"


def parse_wallpaper_target(target_id: str) -> WallpaperDevice | None:
    """Returns the device for a current wallpaper target, or None.

    None for the legacy `story-png` / `landscape-png` shapes that the
    wallpaper pack used before §4, so those keep rendering exactly as they
    did for orders already placed.
    """
    for device in WALLPAPER_DEVICES.values():
        if target_id == wallpaper_target_id(device.id):
            return device
    return None


def wallpaper_target_dimensions() -> dict[str, tuple[int, int]]:
    return {
        wallpaper_target_id(device.id): (device.width, device.height)
        for device in WALLPAPER_DEVICES.values()
    }


def moment_target_id(device_id: str, index: int) -> str:
    """§13 — a single-memory wallpaper, one per milestone.

    The index is part of the id because the customer receives one per
    milestone and needs to tell them apart in a folder. One-based: this
    appears in a filename a person reads, and "moment-0" reads as a bug.
    """
    return f"wallpaper-{device_id}-moment-{index + 1}"


def parse_moment_target(target_id: str) -> tuple[WallpaperDevice, int] | None:
    """Returns the device and zero-based milestone index, or None."""
    if "-moment-" not in target_id:
        return None
    head, _, tail = target_id.rpartition("-moment-")
    device = WALLPAPER_DEVICES.get(head.replace("wallpaper-", ""))
    if device is None or not tail.isdigit():
        return None
    return device, int(tail) - 1


def all_wallpaper_target_ids(milestone_count: int = 0) -> list[str]:
    """Story wallpapers always; one moment wallpaper per milestone.

    `milestone_count` defaults to 0 so the CATALOG can ask for the pack's
    fixed targets without knowing anything about a particular story — a
    pack is defined before any customer exists. The moment targets are
    added at delivery time, when the story is known.
    """
    targets = [wallpaper_target_id(device.id) for device in WALLPAPER_DEVICES.values()]
    for device in WALLPAPER_DEVICES.values():
        targets.extend(moment_target_id(device.id, i) for i in range(milestone_count))
    return targets
