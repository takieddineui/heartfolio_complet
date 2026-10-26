"""
HTML rendering for the `digital` delivery type (the `__live__` target).

Per the phase brief: the Digital Product is a viewable experience, not
a PDF. This produces a single, fully self-contained HTML document —
CSS inlined, any referenced photos embedded as base64 `data:` URIs
(never an external URL, since there is no persistent public URL for an
input asset and this file is never uploaded anywhere itself) — with
real CSS transitions/animations for a staggered timeline reveal.

The CSS custom property names used here (`--p-bg`, `--p-text`,
`--p-accent`, `--p-line`, `--poster-heading-font`, `--poster-body-
font`) are copied directly from the real frontend's theme token names
(themes.ts) — not invented — so a value like `"#f7f1e6"` flows through
exactly the same variable name the actual Studio CSS uses, even though
this HTML's layout/markup itself is this renderer's own, not a copy of
renderer.tsx's JSX.

No permanent hosting, no public URL, no `gift_pages` table — this is
explicitly out of scope for Phase 3.9 (see the README). The generated
HTML is returned as `TemporaryFileResult` bytes, exactly like the PNG
outputs; nothing here writes it anywhere.
"""

from __future__ import annotations

import base64
import html
from string import Template

from apps.assets.services import get_asset_bytes_for_customer
from apps.common.exceptions.api_errors import LoveStoryTimelineRenderFailed

from apps.delivery.attribution import SITE_DOMAIN, WEB_MARK

from .data import duration_phrase, join_names, PALETTES, NormalizedTimeline
from .layout import days_together, format_event_date, ordered_events

TYPOGRAPHY_CSS_FONTS = {
    "serif-classic": ("Georgia, 'Times New Roman', serif", "Georgia, serif"),
    "modern": ("'Helvetica Neue', Arial, sans-serif", "'Helvetica Neue', Arial, sans-serif"),
    "script": ("Georgia, serif", "'Helvetica Neue', Arial, sans-serif"),
    "typewriter": ("'Courier New', monospace", "'Courier New', monospace"),
}

_PAGE_TEMPLATE = Template(
    """<!DOCTYPE html>
<html lang="$lang" dir="$direction">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$title</title>
<style>
  :root {
    --p-bg: $bg; --p-text: $text; --p-muted: $muted; --p-accent: $accent; --p-line: $line;
    --poster-heading-font: $heading_font; --poster-body-font: $body_font; --text-scale: $text_scale;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--p-bg); color: var(--p-text);
    font-family: var(--poster-body-font); font-size: calc(16px * var(--text-scale));
    display: flex; justify-content: center; padding: 4vh 5vw;
  }
  .gift { max-width: 720px; width: 100%; }
  .names { font-family: var(--poster-heading-font); font-size: 2.2em; margin: 0 0 .2em; text-align: center;
    opacity: 0; animation: fadeUp .8s ease-out forwards; }
  .title { text-align: center; color: var(--p-accent); font-family: var(--poster-heading-font); font-size: 1.3em;
    opacity: 0; animation: fadeUp .8s ease-out .15s forwards; }
  .quote { text-align: center; color: var(--p-muted); font-style: italic; margin: .8em 0;
    opacity: 0; animation: fadeUp .8s ease-out .3s forwards; }
  .duration { text-align: center; color: var(--p-accent); font-size: .9em; margin-bottom: 1.5em;
    opacity: 0; animation: fadeUp .8s ease-out .45s forwards; }
  /* Logical sides (§15): the spine, the milestone indent and the dots all
     follow the reading direction, so an Arabic keepsake renders its
     timeline down the right rather than the left. No-op while the document
     is LTR, correct the moment `dir` is set — see the `lang` note below. */
  .timeline { list-style: none; padding: 0; margin: 0; border-inline-start: 2px solid var(--p-line); }
  .event { padding: 0 0 1.6em; padding-inline-start: 1.4em; position: relative;
    opacity: 0; animation: fadeUp .7s ease-out forwards; }
  .event::before { content: ""; position: absolute; inset-inline-start: -6px; top: 4px; width: 10px; height: 10px;
    border-radius: 50%; background: var(--p-accent); }
  .event-date { color: var(--p-accent); font-size: .85em; margin: 0 0 .2em; }
  .event-title { font-family: var(--poster-heading-font); font-size: 1.1em; margin: 0 0 .2em; }
  .event-desc { color: var(--p-muted); margin: 0 0 .5em; }
  .event-photo { max-width: 100%; border-radius: 6px; display: block; margin-top: .5em; }
  .footer { text-align: center; color: var(--p-muted); margin-top: 1em; font-style: italic; }
  /* Attribution. Fuller wording than the print mark: this is a page
     Heartfolio serves, not a file the customer bought and framed. Still
     quiet — below the customer's own closing line and visibly lighter. */
  .colophon { text-align: center; margin-top: 2.5em; font-size: .72em; opacity: .55; }
  .colophon a { color: inherit; text-decoration: none; }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
</style>
</head>
<body>
  <main class="gift">
    <h1 class="names">$names</h1>
    $title_html
    $quote_html
    $duration_html
    <ol class="timeline">
      $events_html
    </ol>
    $footer_html
    <p class="colophon"><a href="https://$domain">$web_mark</a></p>
  </main>
</body>
</html>
"""
)

_EVENT_TEMPLATE = Template(
    """<li class="event" style="animation-delay: ${delay}s">
      <p class="event-date">$date</p>
      <p class="event-title">$title</p>
      $description_html
      $photo_html
    </li>"""
)


def _escape(value: str) -> str:
    return html.escape(value, quote=True)


def _embed_photo_data_uri(*, customer, asset_id: str) -> str | None:
    """Embeds the photo directly in the HTML as a base64 `data:` URI —
    the only way to make the document genuinely self-contained without
    either uploading it somewhere (out of scope) or linking to a
    presigned URL that will expire long before the customer opens this
    file again. Ownership-checked, same as the PNG renderer.
    """
    try:
        raw_bytes, mime_type = get_asset_bytes_for_customer(customer, asset_id)
    except Exception as exc:  # noqa: BLE001
        raise LoveStoryTimelineRenderFailed("Could not embed one of the referenced photos.") from exc

    encoded = base64.b64encode(raw_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


RTL_LOCALES = {"ar", "he", "fa", "ur"}


def render_html(timeline: NormalizedTimeline, *, customer, locale: str = "en") -> bytes:
    palette = PALETTES[timeline.palette]
    heading_font, body_font = TYPOGRAPHY_CSS_FONTS[timeline.typography]

    # §15 / locale: the keepsake declares the language it was bought in.
    #
    # Previously hardcoded `lang="en"` with no `dir`, so a French or Arabic
    # customer received a document that announced the wrong language to
    # screen readers and laid its timeline out left-to-right regardless of
    # the script. The CSS above is already direction-agnostic, so setting
    # these two attributes is the whole fix.
    #
    # `locale` comes from `Order.locale`, captured at checkout — not from
    # whatever language the person happens to be browsing in when they
    # re-download.
    lang = locale
    direction = "rtl" if locale.split("-")[0].lower() in RTL_LOCALES else "ltr"

    events = ordered_events(timeline)
    duration = days_together(events, show_duration=timeline.show_duration)

    events_html_parts = []
    for index, event in enumerate(events):
        photo_html = ""
        if event.photo_asset_id and customer is not None:
            data_uri = _embed_photo_data_uri(customer=customer, asset_id=event.photo_asset_id)
            photo_html = f'<img class="event-photo" src="{data_uri}" alt="">'

        events_html_parts.append(
            _EVENT_TEMPLATE.substitute(
                delay=round(0.6 + index * 0.15, 2),
                date=_escape(format_event_date(event.date, locale)),
                title=_escape(event.title),
                description_html=f'<p class="event-desc">{_escape(event.description)}</p>' if event.description else "",
                photo_html=photo_html,
            )
        )


    # §16 — per-story-type, per-locale. Computed here rather than inline
    # so the None case is obvious: some story types have no duration
    # line at all.
    _duration_phrase = (
        duration_phrase(timeline.story_type, duration, locale) if duration is not None else None
    )

    page = _PAGE_TEMPLATE.substitute(
        lang=_escape(lang),
        direction=direction,
        title=_escape(timeline.poster_title or join_names(timeline.people, locale)),
        bg=palette["bg"], text=palette["text"], muted=palette["muted"], accent=palette["accent"], line=palette["line"],
        heading_font=heading_font, body_font=body_font, text_scale=round(timeline.scale / 100, 2),
        names=_escape(join_names(timeline.people, locale)),
        title_html=f'<p class="title">{_escape(timeline.poster_title)}</p>' if timeline.poster_title else "",
        quote_html=f'<p class="quote">&ldquo;{_escape(timeline.dedication)}&rdquo;</p>' if timeline.dedication else "",
        # §16 — same per-story-type, per-locale phrasing as the poster. This
        # carried the same hardcoded English.
        duration_html=(
            f'<p class="duration">{_escape(_duration_phrase)}</p>'
            if _duration_phrase
            else ""
        ),
        events_html="\n".join(events_html_parts),
        footer_html=f'<p class="footer">{_escape(timeline.ending_text)}</p>' if timeline.ending_text else "",
        # Escaped like everything else (§22): the mark is a constant
        # today, but the escaping pattern is the one this file is
        # required to follow rather than reinvent.
        domain=_escape(SITE_DOMAIN),
        web_mark=_escape(WEB_MARK),
    )
    return page.encode("utf-8")
