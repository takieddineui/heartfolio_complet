"""Video and audio validation (§5).

WHAT THIS GUARANTEES, AND WHAT IT DOES NOT
-------------------------------------------
Images are re-encoded (§22c): a fresh file is written from decoded pixels
and nothing else survives. **Video is not.** It is probed and stored as the
customer sent it, which was a deliberate decision, and the residual risk is
real enough to be worth stating where someone will read it:

  * Anything in the container that is not the video stream survives —
    appended data after the last atom, extra streams, subtitle tracks,
    embedded cover art with its own payload.
  * The declared duration can lie. ffprobe reads the container header, and
    a file can claim 30 seconds while carrying ten minutes of frames. The
    cap here is therefore enforced against what the file CLAIMS, and a
    stream-level check would mean decoding, which is the expensive thing
    this approach exists to avoid.
  * ffprobe itself parses hostile input. It is far safer than decoding, and
    it is not nothing.

THE BLAST RADIUS IS DIFFERENT FROM IMAGES, which is the part that matters.
§22 reasoned that uploads are only ever consumed by Heartfolio's own Pillow
renderer. Video is played back in the RECIPIENT'S browser, so a malicious
file's target is a customer's device rather than this server. The
mitigations that follow from that live at the serving layer — forced content
type from the stored record, never from the filename — not here.

AUDIO IS RE-ENCODED, unlike video. Audio files are small and fast enough to
rewrite inline with no queue, so they keep the same guarantee images have.
There was no reason to accept a weaker one just because video needs to.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile

from django.conf import settings
from django.core.files.base import ContentFile

from apps.common.exceptions.api_errors import InvalidAssetType

#: ffprobe/ffmpeg are the same package. Probing is not possible without it.
FFPROBE = shutil.which("ffprobe")
FFMPEG = shutil.which("ffmpeg")

#: Kept deliberately short. Every additional container is another parser
#: reachable by an untrusted file, and these cover what phones actually
#: produce.
VIDEO_MIME_TYPES = ("video/mp4", "video/quicktime", "video/webm")
#: `audio/ogg` / `audio/opus` are what WhatsApp voice notes arrive as, and
#: `audio/x-m4a` / `audio/mp3` are what browsers declare for an iPhone .m4a
#: and a plain .mp3. Accepted because Graduation Keepsake messages are files
#: the organiser RECEIVED from other people, not just recordings made in the
#: Studio. All of them are re-encoded to AAC/MP4 by `reencode_audio` before
#: storage, so playback (including iOS Safari) never depends on the original.
AUDIO_MIME_TYPES = (
    "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/webm",
    "audio/ogg", "audio/opus",
)

#: Long enough for a voice note or a moment of footage; short enough that
#: storage per order stays predictable (§5's caps).
MAX_MEDIA_SECONDS = 30

#: Audio is allowed longer than video: a spoken message from a parent runs
#: past 30 seconds, and audio costs a fraction of video to store and serve.
#: Video keeps `MAX_MEDIA_SECONDS`. Graduation Keepsake voice messages are
#: specified at up to one minute.
MAX_AUDIO_SECONDS = 60
_PROBE_TIMEOUT_SECONDS = 20


def is_media(mime_type: str) -> bool:
    return mime_type in VIDEO_MIME_TYPES or mime_type in AUDIO_MIME_TYPES


def probe_media(path: str) -> dict:
    """Reads container metadata. Never decodes.

    Runs with an explicit timeout and no shell: a crafted file that makes
    ffprobe hang would otherwise hold a request worker open, which is a
    denial of service that needs no exploit at all.
    """
    if not FFPROBE:
        raise InvalidAssetType("Media uploads are not available on this server.")

    try:
        completed = subprocess.run(
            [
                FFPROBE, "-v", "error",
                "-show_entries", "format=duration,format_name",
                "-show_entries", "stream=codec_type,codec_name",
                "-of", "json", path,
            ],
            capture_output=True,
            timeout=_PROBE_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise InvalidAssetType("That file could not be read in a reasonable time.")

    if completed.returncode != 0:
        raise InvalidAssetType("That file is not a video or audio file we can read.")

    try:
        return json.loads(completed.stdout or b"{}")
    except json.JSONDecodeError:
        raise InvalidAssetType("That file is not a video or audio file we can read.")


def validate_media(uploaded_file, mime_type: str) -> float:
    """Checks the file really is what it claims, and is short enough.

    Returns the declared duration.

    The CLAIMED mime type is not trusted: the probe's own view of the
    streams decides whether this is video or audio, the same principle as
    §22a's image detection. A file named `.mp4` containing only an audio
    stream is audio, and a file claiming `audio/mpeg` that carries video is
    rejected rather than quietly stored as a song.
    """
    with tempfile.NamedTemporaryFile(suffix=".upload") as temp:
        uploaded_file.seek(0)
        for chunk in uploaded_file.chunks():
            temp.write(chunk)
        temp.flush()
        probe = probe_media(temp.name)

    streams = probe.get("streams") or []
    kinds = {stream.get("codec_type") for stream in streams}
    if not kinds & {"video", "audio"}:
        raise InvalidAssetType("That file contains no video or audio.")

    declared_video = mime_type in VIDEO_MIME_TYPES
    if declared_video and "video" not in kinds:
        raise InvalidAssetType("That file was sent as a video but contains none.")
    if not declared_video and "video" in kinds:
        # Otherwise a video could be uploaded through the audio path and
        # skip the video rules entirely.
        raise InvalidAssetType("That file was sent as audio but contains video.")

    try:
        duration = float((probe.get("format") or {}).get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0.0

    limit = MAX_MEDIA_SECONDS if declared_video else MAX_AUDIO_SECONDS
    if duration > limit:
        raise InvalidAssetType(
            f"Please keep clips under {limit} seconds — this one is "
            f"{int(duration)}."
        )

    uploaded_file.seek(0)
    return duration


def reencode_audio(uploaded_file) -> ContentFile:
    """Rewrites an audio file from its decoded samples (§22c parity).

    Audio is small and fast enough to do inline, so there is no reason for
    it to carry the weaker guarantee video does. Everything that is not
    audio data — cover art, arbitrary tags, appended payloads — is dropped
    because it is never copied, exactly as with images.

    Output is always AAC in an MP4 container: one format the browsers all
    play, and one decoder path rather than five.
    """
    if not FFMPEG:
        raise InvalidAssetType("Media uploads are not available on this server.")

    with tempfile.NamedTemporaryFile(suffix=".in") as source, tempfile.NamedTemporaryFile(suffix=".m4a") as target:
        uploaded_file.seek(0)
        for chunk in uploaded_file.chunks():
            source.write(chunk)
        source.flush()

        completed = subprocess.run(
            [
                FFMPEG, "-y", "-v", "error",
                "-i", source.name,
                # No video, no subtitles, no attachments, no metadata:
                # everything that is not audio is dropped by instruction as
                # well as by omission.
                "-vn", "-sn", "-dn", "-map_metadata", "-1",
                "-c:a", "aac", "-b:a", "128k",
                "-t", str(MAX_AUDIO_SECONDS),
                "-f", "mp4", target.name,
            ],
            capture_output=True,
            timeout=settings.MEDIA_REENCODE_TIMEOUT_SECONDS,
            check=False,
        )
        if completed.returncode != 0:
            raise InvalidAssetType("That audio file could not be processed.")

        target.seek(0)
        return ContentFile(target.read(), name="audio.m4a")
