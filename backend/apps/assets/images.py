"""What a customer's photo becomes on upload (owner, 31 Oct 2026).

THE MASTER is the one stored original every print renders from:

  * UPRIGHT. Phones store a portrait photo as landscape pixels plus an EXIF
    orientation tag, and the browser obeys the tag. The re-encode used to drop
    the tag without applying it, so an Android portrait photo looked right in
    the Studio and printed lying on its side. `exif_transpose` first.
  * IN sRGB. Every recent iPhone writes Display P3 with an embedded profile.
    Dropping the profile without converting the pixels made those photos
    print and display duller. The pixels are converted, then the profile is
    dropped; prints, browsers and the live page all read sRGB.
  * WITHOUT METADATA. Nothing but pixels is written back (no `exif=`, no
    `icc_profile=`, no `pnginfo=`): GPS, camera, timestamps, all gone. This was
    already true; it is now pinned by tests that upload a file carrying GPS.
  * NO LARGER THAN PRINTS NEED. The most any print takes from a photo is
    3,060 px across its short side (Song Poster's Player on the 12x18
    frameless poster, measured 31 Oct 2026), so the short edge is capped at
    `MASTER_SHORT_EDGE`; panoramas also at `MASTER_LONG_EDGE`. A 12 MP phone
    photo (4032x3024) is under the cap and keeps every pixel. Never upscaled.
  * JPEG at quality 92 as before; PNG and WebP keep their format, so a
    cut-out keeps its transparency.

The Studio shrinks large photos in the browser to the same cap before
uploading (`lib/studio/photo-resize.ts`, whose constants
`photo-resize.test.ts` pins to these); this module is the safety net for
everything that arrives unprocessed.

THE WEB COPIES are what the live pages download: WebP at `WEB_COPY_WIDTHS`,
made once from the master at upload and stored beside it
(`web_copy_key`). A 12 MP photo is about 3-4 MB as a master and about 90 KB
as the 960 copy a phone picks.
"""

from __future__ import annotations

import io
import logging
import posixpath
from dataclasses import dataclass

from PIL import Image, ImageCms, ImageOps

logger = logging.getLogger("heartfolio")

#: Player's photo on the 12x18 frameless poster takes 3,060 px across a
#: portrait photo's short side, the most of any print; a little room above.
MASTER_SHORT_EDGE = 3072
#: For panoramas, whose short edge alone would let the long one run on.
MASTER_LONG_EDGE = 6144
MASTER_JPEG_QUALITY = 92

#: Phones pick 960 (a ~300 CSS px photo at 3x), laptops and lightboxes 1600,
#: small previews 480.
WEB_COPY_WIDTHS = (480, 960, 1600)
WEB_COPY_QUALITY = 80

_SRGB = ImageCms.createProfile("sRGB")

#: Pillow's format name for each MIME type we store.
_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}


@dataclass(frozen=True)
class Master:
    """The stored bytes and the pixels they hold (for the web copies)."""

    content: bytes
    image: Image.Image

    @property
    def width(self) -> int:
        return self.image.width

    @property
    def height(self) -> int:
        return self.image.height


def master_size(width: int, height: int) -> tuple[int, int]:
    """The size a `width` x `height` photo is stored at: unchanged when it is
    within both caps, else scaled down to fit them, keeping its shape."""
    scale = min(1.0, MASTER_SHORT_EDGE / min(width, height), MASTER_LONG_EDGE / max(width, height))
    if scale >= 1.0:
        return width, height
    return max(1, round(width * scale)), max(1, round(height * scale))


def _to_srgb(image: Image.Image, icc: bytes | None) -> Image.Image:
    """The pixels converted from their embedded profile to sRGB. A missing,
    unreadable or unsupported profile leaves them as they are (as before)."""
    if not icc:
        return image
    try:
        profile = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        if image.mode in ("RGB", "CMYK"):
            return ImageCms.profileToProfile(
                image, profile, _SRGB, renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC, outputMode="RGB"
            )
        if image.mode == "RGBA":
            alpha = image.getchannel("A")
            converted = ImageCms.profileToProfile(
                image.convert("RGB"), profile, _SRGB, renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC, outputMode="RGB"
            )
            converted.putalpha(alpha)
            return converted
    except (ImageCms.PyCMSError, OSError, ValueError):
        logger.warning("upload_colour_profile_unreadable")
    return image


def _has_alpha(image: Image.Image) -> bool:
    return image.mode in ("RGBA", "LA", "PA") or (image.mode == "P" and "transparency" in image.info)


def prepare_master(uploaded_file, mime_type: str) -> Master:
    """Decodes the upload and returns the master (see the module docstring).
    `mime_type` is the DETECTED type, and the master keeps that format."""
    target_format = _FORMATS[mime_type]
    uploaded_file.seek(0)
    with Image.open(uploaded_file) as opened:
        # `load()` forces a full decode: `Image.open` is lazy, and a file that
        # fails partway through must fail here, not save a truncated image.
        opened.load()
        icc = opened.info.get("icc_profile")
        image = ImageOps.exif_transpose(opened)

    # Transparency survives only where the format can hold it.
    if target_format != "JPEG" and _has_alpha(image):
        image = image.convert("RGBA")
    elif image.mode not in ("RGB", "CMYK"):
        image = image.convert("RGB")
    image = _to_srgb(image, icc)
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGB")

    size = master_size(*image.size)
    if size != image.size:
        image = image.resize(size, Image.LANCZOS)

    buffer = io.BytesIO()
    # No `exif=`, `icc_profile=` or `pnginfo=`: only pixels are written back.
    if target_format == "JPEG":
        image.save(buffer, format="JPEG", quality=MASTER_JPEG_QUALITY, optimize=True, progressive=True)
    elif target_format == "WEBP":
        image.save(buffer, format="WEBP", quality=MASTER_JPEG_QUALITY, method=4)
    else:
        image.save(buffer, format="PNG")
    return Master(content=buffer.getvalue(), image=image)


def web_copy_widths(master_width: int) -> list[int]:
    """The copies a master of this width gets: every width it can fill
    (never an upscale). A master narrower than 480 gets none; pages then
    use the master itself."""
    return [width for width in WEB_COPY_WIDTHS if width <= master_width]


def make_web_copies(image: Image.Image) -> list[tuple[int, bytes]]:
    """`(width, WebP bytes)` for each of `web_copy_widths`, smallest first.
    Each copy is resized from the next larger one (never by 2x or more), a
    quarter faster than resizing every one from the master, measured on a
    12 MP photo with the same bytes out."""
    copies = []
    source = image
    for width in sorted(web_copy_widths(image.width), reverse=True):
        height = max(1, round(image.height * width / image.width))
        source = source if width == source.width else source.resize((width, height), Image.LANCZOS)
        buffer = io.BytesIO()
        source.save(buffer, format="WEBP", quality=WEB_COPY_QUALITY, method=4)
        copies.append((width, buffer.getvalue()))
    return sorted(copies)


def web_copy_key(storage_key: str, width: int) -> str:
    """`uploads/<product>/<id>.jpg` -> `uploads/<product>/<id>.w960.webp`:
    beside the master, named from its key, so no customer filename can ever
    appear in it either."""
    root, _extension = posixpath.splitext(storage_key)
    return f"{root}.w{width}.webp"
