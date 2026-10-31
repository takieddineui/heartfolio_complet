"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, MapPin, Mic, Music, Plus, Trash2, Upload, Video, X } from "lucide-react";
import type { FieldSchema } from "@/types/studio";
import { cn } from "@/lib/utils";
import { maxSizeMbFor } from "@/lib/api/assets";
import {
  isMapboxConfigured,
  newMapboxSessionToken,
  retrieveMapboxPlace,
  suggestMapboxPlaces,
  type MapboxSuggestion,
} from "@/lib/api/mapbox";
import { useProductState } from "@/lib/studio/product-state-context";
import { resolveShellValidationText, resolveValidationMessage } from "@/lib/studio/i18n";
import { mediaDisplayName } from "@/lib/studio/media-names";
import { YouTubeFieldInput } from "./youtube-field-input";

const inputClass =
  "h-11 w-full rounded-[var(--radius-md)] border border-subtle bg-page px-3 text-sm text-body placeholder:text-body/40 focus:border-champagne-gold focus:outline-none";

export type Translator = (key: string, params?: Record<string, string | number>) => string;

interface FieldInputProps {
  field: FieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  t: Translator;
  /** The id the row's `<label htmlFor>` points at, set on the one control
   * of a single-control field (`labelledByHtmlFor` in generic-form.tsx). A
   * `useId` value, never the schema id, which repeats in every group item. */
  id?: string;
  /** The row label's id, for a control that cannot take `htmlFor` (the
   * media field's hidden file input). */
  labelledBy?: string;
}

export function FieldInput({ field, value, onChange, t, id, labelledBy }: FieldInputProps) {
  const { locale } = useProductState();
  switch (field.type) {
    case "text":
      return (
        <input
          id={id}
          type="text"
          className={inputClass}
          value={(value as string) ?? ""}
          maxLength={field.maxLength}
          placeholder={t(field.placeholder ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "textarea":
      return (
        <textarea
          id={id}
          className={cn(inputClass, "h-auto min-h-20 resize-none py-2")}
          value={(value as string) ?? ""}
          maxLength={field.maxLength}
          placeholder={t(field.placeholder ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "date":
      return (
        <input
          id={id}
          type="date"
          className={inputClass}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "boolean":
      return (
        <label className="flex items-center gap-2 text-sm text-body">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-subtle accent-[var(--color-champagne-gold)]"
          />
          {t(field.helpText ?? "")}
        </label>
      );

    case "select":
      return (
        <select id={id} className={inputClass} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.label)}
            </option>
          ))}
        </select>
      );

    case "multiSelect": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-2">
          {field.options.map((opt) => {
            const active = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() =>
                  onChange(active ? selected.filter((v) => v !== opt.value) : [...selected, opt.value])
                }
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-champagne-gold bg-champagne-gold/15 text-heading"
                    : "border-subtle text-body/70 hover:text-heading"
                )}
              >
                {t(opt.label)}
              </button>
            );
          })}
        </div>
      );
    }

    case "range":
      return (
        <div className="flex items-center gap-3">
          <input
            id={id}
            type="range"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={typeof value === "number" ? value : field.min}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full accent-[var(--color-champagne-gold)]"
          />
          <span // §15: aligns to the inline end, which follows the slider under RTL.
            className="w-12 shrink-0 text-end text-xs text-body/60">
            {typeof value === "number" ? value : field.min}
            {field.unit ?? ""}
          </span>
        </div>
      );

    case "image":
    case "gallery":
    case "audio":
    case "video":
    case "file":
      return <MediaFieldInput field={field} value={value} onChange={onChange} labelledBy={labelledBy} />;

    case "swatch": {
      // A radio group of colours. The first choice, "automatic", stores an
      // empty value: the product picks (Graduation Keepsake: by position).
      const selected = typeof value === "string" ? value : "";
      const choices = [{ value: "", label: "", color: "" }, ...field.options];
      return (
        <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
          {choices.map((option) => {
            const active = option.value === selected;
            const name = option.value ? t(option.label) : resolveShellValidationText("swatch.auto", locale);
            return (
              <button
                key={option.value || "auto"}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={name}
                title={name}
                onClick={() => onChange(option.value)}
                className={cn(
                  "h-8 w-8 rounded-full border-2 transition-shadow",
                  active ? "border-heading shadow-[0_0_0_2px_var(--color-champagne-gold)]" : "border-subtle"
                )}
                style={
                  option.color
                    ? { background: option.color }
                    : { background: "conic-gradient(#ff6b4a, #ffb547, #2fae86, #2f7fd8, #7a5cd6, #ff6b4a)" }
                }
              />
            );
          })}
        </div>
      );
    }

    case "coordinates":
      return <CoordinatesFieldInput value={value} onChange={onChange} />;

    case "location":
      return <LocationFieldInput id={id} value={value} onChange={onChange} t={t} />;

    case "youtube":
      // Reads and writes its two keys (the link and its confirmed id)
      // through the product state itself; see `youtube-field-input.tsx`.
      return <YouTubeFieldInput id={id} field={field} t={t} inputClass={inputClass} />;

    default:
      return (
        <p className="rounded-[var(--radius-md)] border border-dashed border-subtle bg-page/60 p-3 text-xs text-body/50">
          &ldquo;{t(field.label)}&rdquo; ({field.type}) isn&apos;t supported by the Content panel yet.
        </p>
      );
  }
}

const MEDIA_ACCEPT: Record<string, string> = {
  image: "image/*",
  gallery: "image/*",
  audio: "audio/*",
  video: "video/*",
  file: "*",
};

const MEDIA_ICON: Record<string, typeof Music> = {
  audio: Music,
  video: Video,
  file: FileText,
};

/**
 * Best-effort length of an audio file from its metadata, without playing it.
 * `null` when the browser cannot tell (a codec it cannot decode, a file with
 * no duration): the file is let through and the backend, which probes with
 * ffprobe, decides. A file that never answers does not hold the form up.
 */
function readAudioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let settled = false;
    const finish = (seconds: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => finish(null);
    window.setTimeout(() => finish(null), 4000);
    audio.src = url;
  });
}

interface UploadedMedia {
  url: string;
  mimeType: string;
  /** Absent once saved: the server keeps no filename (`mediaDisplayName`). */
  filename?: string;
  /** Set once the file has been uploaded to Django at checkout. Absent
   * while the photo is only a local preview. */
  assetId?: string;
}

function MediaFieldInput({
  field,
  value,
  onChange,
  labelledBy,
}: {
  field: Extract<FieldSchema, { type: "image" | "gallery" | "audio" | "video" | "file" }>;
  value: unknown;
  onChange: (value: unknown) => void;
  labelledBy?: string;
}) {
  const { t, locale, session } = useProductState();
  const [error, setError] = useState<string | null>(null);
  const isMulti = field.type === "gallery";
  const items: UploadedMedia[] = isMulti
    ? Array.isArray(value)
      ? (value as UploadedMedia[])
      : []
    : value
      ? [value as UploadedMedia]
      : [];

  /**
   * Picking a photo does NOT upload it. `POST /assets/` requires a guest
   * identity that only exists after the email step at checkout, so the file
   * is previewed locally and registered as pending; `uploadPendingMedia()`
   * sends it to Django at checkout and stamps the `assetId` in.
   *
   * Files are checked against the backend's real limits here so a rejection
   * appears the moment the customer picks the file, rather than minutes
   * later at checkout.
   */
  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const { checkFileAccepted, withInferredAudioType } = await import("@/lib/api/assets");
    const { registerPendingFile } = await import("@/lib/studio/media-values");
    const { prepareImageForUpload } = await import("@/lib/studio/photo-resize");

    const accepted: UploadedMedia[] = [];
    let rejection: string | null = null;

    for (const picked of Array.from(files)) {
      // A received voice file the browser could not type (some report an empty
      // type for a WhatsApp `.opus`) gets one from its extension.
      // A photo above what prints need (a 48-50 MP phone photo is over the
      // upload limit) is shrunk here first, upright and in sRGB; anything
      // else comes back as picked (`photo-resize.ts`).
      const file = field.type === "audio" ? withInferredAudioType(picked) : await prepareImageForUpload(picked);
      if (field.type === "audio" && field.maxSeconds) {
        const seconds = await readAudioDuration(file);
        // Half a second of grace: a recording stopped by its own timer can
        // report a few milliseconds over.
        if (seconds !== null && seconds > field.maxSeconds + 0.5) {
          rejection = resolveValidationMessage(
            { code: "media.tooLong", params: { maxSeconds: String(field.maxSeconds), filename: file.name } },
            locale,
            session.module.messages
          );
          continue;
        }
      }
      const reason = checkFileAccepted(file);
      if (reason) {
        /**
         * `media.tooLarge` / `media.unsupportedType` are SHELL validation
         * codes (`SHELL_VALIDATION_MESSAGES`), not module copy, so the
         * context's `t` — which reads the module's own messages — fell
         * through to the raw key and showed the customer "media.tooLarge"
         * in red. `resolveValidationMessage` is the resolver that knows
         * both sources: it checks the module's `validation.<code>` first
         * (so a product can still override the wording) and falls back to
         * the Shell's own translated string.
         */
        rejection = resolveValidationMessage(
          {
            code: reason === "too-large" ? "media.tooLarge" : "media.unsupportedType",
            // §5 — audio/video get a much larger ceiling than a photo
            // (`maxSizeMbFor` mirrors the backend's own kind-dependent
            // limit); reporting the flat image limit here would tell a
            // customer whose 12MB voice note was rejected for some other
            // reason that the cutoff is 10MB, when it is actually 50MB.
            params: { maxSizeMb: String(maxSizeMbFor(file.type)), filename: file.name },
          },
          locale,
          session.module.messages
        );
        continue;
      }
      const url = URL.createObjectURL(file);
      registerPendingFile(url, file);
      accepted.push({ url, mimeType: file.type, filename: file.name });
    }

    setError(rejection);
    if (accepted.length === 0) return;

    if (isMulti) {
      const max = field.maxItems ?? Infinity;
      onChange([...items, ...accepted].slice(0, max));
    } else {
      onChange(accepted[0]);
    }
  }

  /**
   * §5 — record a voice note in the browser.
   *
   * WHY THIS EXISTS. The field was a plain file input, which on a phone is
   * survivable (iOS and Android offer the recorder beside the picker) and
   * on a desktop is simply wrong: "a message you would like them to hear"
   * opened a file browser, so the only way to comply was to have already
   * recorded one somewhere else.
   *
   * The result is handed to `handleFiles` as a `File`, so it takes exactly
   * the same path as a picked file — same size and type checks, same
   * pending-upload registration, same upload at checkout. Nothing about
   * the storage or delivery side needed to change.
   *
   * FORMAT IS THE BROWSER'S CHOICE, not ours. Chrome records webm/opus and
   * Safari mp4/aac; both are already in the backend's accepted list, so
   * the first supported type is used rather than forcing one and failing
   * on whichever browser disagrees.
   */
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordTimer = useRef<number | null>(null);
  // Leaving the field mid-recording stops the timer and the recorder (whose
  // own stop releases the microphone).
  useEffect(
    () => () => {
      if (recordTimer.current !== null) window.clearTimeout(recordTimer.current);
      recorderRef.current?.stop();
    },
    []
  );

  const canRecord =
    field.type === "audio" &&
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm", "audio/mp4"].find((type) =>
        MediaRecorder.isTypeSupported(type)
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        // The microphone is released the moment recording ends. Leaving the
        // track open keeps the browser's "recording" indicator lit, which
        // is alarming and deserved.
        stream.getTracks().forEach((track) => track.stop());
        /**
         * THE CODEC SUFFIX MUST BE STRIPPED. MediaRecorder reports
         * `audio/webm;codecs=opus`, and the backend checks
         * `content_type not in ALLOWED_ASSET_MIME_TYPES` — an exact string
         * comparison against a list holding plain `audio/webm`. Sending
         * the full string got every recording rejected as "not a supported
         * file type", which is the error this produced.
         */
        const reported = recorder.mimeType || mimeType || "audio/webm";
        const type = reported.split(";")[0]!.trim();
        const extension = type.includes("mp4") ? "m4a" : "webm";
        const file = new File([new Blob(chunksRef.current, { type })], `voice-note.${extension}`, {
          type,
        });
        const list = new DataTransfer();
        list.items.add(file);
        void handleFiles(list.files);
        setRecording(false);
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      // A recording stops itself at the field's limit rather than producing
      // a file that would be refused (Love Story Timeline's voice note: 30s;
      // Graduation Keepsake's voice messages: 60s).
      if (field.maxSeconds) {
        recordTimer.current = window.setTimeout(stopRecording, field.maxSeconds * 1000);
      }
    } catch {
      // Denied permission, or no microphone. `media.*` are SHELL
      // VALIDATION strings (`SHELL_VALIDATION_MESSAGES`), not checkout
      // copy, so they resolve through `resolveShellValidationText` — the
      // module translator (and `resolveShellText`, which only reads
      // `SHELL_CHECKOUT_MESSAGES`) would fall through to the raw key and
      // print "media.recordUnavailable" at the customer. Same trap as
      // `media.tooLarge` further up this file.
      setError(resolveShellValidationText("media.recordUnavailable", locale));
      setRecording(false);
    }
  }

  function stopRecording() {
    if (recordTimer.current !== null) {
      window.clearTimeout(recordTimer.current);
      recordTimer.current = null;
    }
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  /** Takes one file back out. Without this a voice note, a drawing or an
   * optional video could only ever be REPLACED, never removed, which also
   * left a customer over a product's per-keepsake limit no way back under. */
  function removeItem(index: number) {
    setError(null);
    if (isMulti) onChange(items.filter((_, i) => i !== index));
    else onChange(null);
  }

  const Icon = MEDIA_ICON[field.type];
  // §5's voice note is recording-only: a customer records the message they
  // want heard, and a file picker beside it would let them attach any
  // audio file lying around, which is not what "a message you would like
  // them to hear" asks for. Every other media type keeps the picker, and so
  // does an audio field that opts in with `allowUpload` (voice messages the
  // customer received from other people).
  const isAudio = field.type === "audio";
  const removeLabel = resolveShellValidationText("media.remove", locale);

  return (
    <div className="space-y-1.5">
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item, i) => (
        <div key={i} className="relative">
          {field.type === "image" || field.type === "gallery" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.url} alt="" className="h-14 w-14 rounded-[var(--radius-sm)] object-cover" />
          ) : (
            <div className="flex h-14 max-w-[10rem] items-center gap-2 rounded-[var(--radius-sm)] border border-subtle bg-page px-2 pe-6 text-xs text-body/70">
              {Icon && <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />}
              <span className="truncate">{mediaDisplayName(item, i, locale)}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => removeItem(i)}
            aria-label={`${removeLabel}: ${mediaDisplayName(item, i, locale)}`}
            title={removeLabel}
            className="absolute -end-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-subtle bg-card text-body/60 hover:text-error-warm"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        </div>
      ))}
      {(!isAudio || field.allowUpload) && (
        <label className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border border-dashed border-subtle text-body/50 hover:border-champagne-gold hover:text-champagne-gold">
          <Upload className="h-4 w-4" strokeWidth={1.75} />
          <input
            type="file"
            aria-labelledby={labelledBy}
            accept={field.accept ?? MEDIA_ACCEPT[field.type]}
            multiple={isMulti}
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
      )}

      {canRecord && (
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          aria-pressed={recording}
          className={
            recording
              ? "flex h-14 items-center gap-2 rounded-[var(--radius-sm)] border border-error-warm px-3 text-xs text-error-warm"
              : "flex h-14 items-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-subtle px-3 text-xs text-body/50 hover:border-champagne-gold hover:text-champagne-gold"
          }
        >
          <Mic className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {resolveShellValidationText(recording ? "media.stopRecording" : "media.record", locale)}
        </button>
      )}
      {/* `canRecord` is false when the browser has no MediaRecorder/
          getUserMedia at all (including an insecure context, where
          `navigator.mediaDevices` itself is undefined) — a static,
          page-load-time condition, distinct from `error` below, which is
          a runtime rejection (permission denied, no microphone) on a
          browser that DOES support recording. With the file-picker
          fallback removed above, this browser genuinely has no way to
          supply one, so it says so rather than showing an empty field. */}
      {isAudio && !canRecord && !field.allowUpload && (
        <p className="flex h-14 max-w-[14rem] items-center rounded-[var(--radius-sm)] border border-dashed border-subtle px-3 text-xs text-body/50">
          {resolveShellValidationText("media.recordingNotSupported", locale)}
        </p>
      )}
    </div>
      {/* Same error treatment the generic form already uses for field
          validation (`text-xs text-error-warm`) — no new visual language. */}
      {error && <p className="text-xs text-error-warm">{error}</p>}
    </div>
  );
}

export interface CoordinatesValue {
  lat: number | null;
  lng: number | null;
}

/** The stored shape for a §6 location field — a place, not a string.
 *  Mirrors the backend's `_location_field` exactly: `name`/`lat`/`lng`
 *  required together, `mapboxId` optional.
 * */
export interface LocationValue {
  name: string;
  lat: number;
  lng: number;
  mapboxId?: string;
}

/**
 * §6 — searches Mapbox Search Box and stores a real place, not free text.
 *
 * UNTESTED AGAINST A LIVE TOKEN — see `lib/api/mapbox.ts`'s header.
 * Written against the documented response shape; verify with a real key
 * before this ships.
 *
 * BACKWARD COMPATIBLE WITH A PLAIN STRING, because every milestone
 * location saved before this field existed IS one (see the backend's
 * `_location_field`, which accepts both). A legacy string renders as
 * plain, non-clickable text in the box — visible, editable by searching
 * again and picking a real result, but not silently coerced into fake
 * coordinates.
 */
function LocationFieldInput({
  id,
  value,
  onChange,
  t,
}: {
  id?: string;
  value: unknown;
  onChange: (value: unknown) => void;
  t: Translator;
}) {
  const selected: LocationValue | null =
    value && typeof value === "object" && "lat" in (value as object) ? (value as LocationValue) : null;
  const legacyString = typeof value === "string" && value ? value : null;

  const { locale } = useProductState();
  const [query, setQuery] = useState(selected?.name ?? legacyString ?? "");
  /**
   * Whether the customer has actually typed in this field.
   *
   * The starting milestones ship with sample location NAMES but no
   * coordinates, so the debounced effect used to fire on mount for every
   * one of them and drop an open dropdown under all three steps before
   * anybody touched anything — it read as though places had been
   * pre-selected. Suggestions are still fetched (the hint asks them to
   * search again), but the list only opens once they type.
   */
  const typedRef = useRef(false);
  const [results, setResults] = useState<MapboxSuggestion[]>([]);
  // One Search Box session covers all the typing plus the final
  // retrieve, so the whole exchange bills once. Regenerated after each
  // completed pick: a new search is a new session.
  const sessionRef = useRef<string>(newMapboxSessionToken());
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Debounced search. A ref for the abort controller rather than state:
  // aborting the PREVIOUS request when a new keystroke arrives is
  // deliberate — without it, a slow response for "Lis" could resolve
  // after a faster one for "Lisbon" and overwrite the more specific
  // result with the less specific one.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isMapboxConfigured()) return;
    // Don't re-search immediately after picking a result — the query was
    // just set to the selected name, and searching it again would only
    // reopen the dropdown the selection just closed.
    if (selected && query === selected.name) return;

    const handle = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (query.trim().length < 2) {
        setResults([]);
        return;
      }

      setLoading(true);
      suggestMapboxPlaces(query, sessionRef.current, controller.signal, locale)
        .then((suggestions) => {
          setResults(suggestions);
          if (typedRef.current) setOpen(true);
        })
        .catch(() => {
          // A failed search is not a form error — the customer can keep
          // typing or try again; there is nothing to validate yet.
        })
        .finally(() => setLoading(false));
    }, 300);

    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  /**
   * A suggestion carries no coordinates — Search Box only returns those
   * from `/retrieve` — so picking is asynchronous. The value is only
   * committed once coordinates actually arrive.
   *
   * THE STORED NAME IS WHAT THE CUSTOMER TYPED, NOT MAPBOX'S NAME.
   * Mapbox is used for the coordinates only. Its `language` parameter
   * controls the language names are RETURNED in, and there is no way to
   * ask it to answer in "whatever language the query was written in" —
   * Arabic is detectable by script, but French and English are not
   * distinguishable from a one-word place name. Deriving it from the UI
   * locale is a guess about the person rather than a fact about the
   * query.
   *
   * Keeping their own words removes the guess entirely: type "Alger" and
   * the keepsake says Alger; type "الجزائر العاصمة" and it says that.
   * For a keepsake it is also the better answer on its own terms — the
   * name someone gives a place is part of the memory, and Mapbox's
   * canonical form is not always the one they would write.
   *
   * The field stays editable afterwards BECAUSE OF THE OBVIOUS RISK: type
   * "caf", pick "Café Tantonville", and the stored name is "caf". The
   * input keeps their text and is the name that gets printed, so it can
   * be corrected in place.
   */
  async function pick(suggestion: MapboxSuggestion) {
    // What they typed, tidied of stray whitespace only.
    const typed = query.trim();
    setOpen(false);
    setResults([]);
    setLoading(true);
    try {
      // No locale passed: the only thing used from this response is the
      // coordinate pair, so the language it answers in is irrelevant.
      const place = await retrieveMapboxPlace(suggestion.id, sessionRef.current);
      if (!place) {
        // Resolved to nothing. Leaving the field unset is a state the
        // form already handles; inventing coordinates would put a wrong
        // pin on a printed keepsake.
        onChange(null);
        return;
      }
      onChange({
        // `place.name` is deliberately discarded — see above. Only the
        // point and the id come from Mapbox.
        name: typed || place.name,
        lat: place.lat,
        lng: place.lng,
        mapboxId: place.id,
      } satisfies LocationValue);
    } catch {
      // Same reasoning as the failed search above: not a form error, and
      // the customer can simply pick again.
      onChange(null);
    } finally {
      setLoading(false);
      // The session ends with the retrieve it paid for.
      sessionRef.current = newMapboxSessionToken();
    }
  }

  if (!isMapboxConfigured()) {
    // Degrades honestly rather than firing requests that would 401 — the
    // field is visible but inert until a token exists.
    return (
      <p className="rounded-[var(--radius-md)] border border-dashed border-subtle bg-page/60 p-3 text-xs text-body/50">
        {t("fields.eventLocation.unconfigured")}
      </p>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="pointer-events-none absolute inset-inline-start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-body/40" strokeWidth={1.75} />
        <input
          id={id}
          type="text"
          value={query}
          onChange={(e) => {
            typedRef.current = true;
            setQuery(e.target.value);
            // Typing invalidates whatever was selected — the field must
            // not keep stale coordinates for a name the customer is
            // actively changing.
            if (selected) onChange(null);
          }}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={t("fields.eventLocation.placeholder")}
          className={cn(inputClass, "ps-9")}
        />
      </div>

      {legacyString && !selected && (
        <p className="mt-1 text-xs text-body/50">{t("fields.eventLocation.legacyHint")}</p>
      )}

      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-[var(--radius-md)] border border-subtle bg-page shadow-[var(--shadow-lift)]">
          {results.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                // onMouseDown, not onClick: the input's onBlur fires first
                // on a click and would close this list before a click had
                // a chance to register.
                onMouseDown={() => void pick(place)}
                className="flex w-full items-start gap-2 px-3 py-2 text-start text-sm text-body hover:bg-champagne-gold/10"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 flex-none text-body/40" strokeWidth={1.75} />
                <span className="flex flex-col text-start">
                  <span>{place.name}</span>
                  {place.context && <span className="text-xs text-body/50">{place.context}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {loading && <p className="mt-1 text-xs text-body/40">{t("fields.eventLocation.searching")}</p>}
    </div>
  );
}

/** The first field type to fill in one of the SDK's "reserved" slots —
 * `CoordinatesFieldSchema` existed since the architecture-review pass
 * with no renderer. Value shape is `{ lat, lng }`, not two separate
 * fields, so a module's `validate()` can check both together (see the
 * "generic required doesn't understand object values" limitation noted
 * where this was added). */
function CoordinatesFieldInput({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const coords = (value as CoordinatesValue | undefined) ?? { lat: null, lng: null };

  function update(key: "lat" | "lng", raw: string) {
    const num = raw === "" ? null : Number(raw);
    onChange({ ...coords, [key]: Number.isNaN(num) ? null : num });
  }

  return (
    <div className="flex gap-2">
      <input
        type="number"
        step="any"
        min={-90}
        max={90}
        placeholder="Latitude"
        value={coords.lat ?? ""}
        onChange={(e) => update("lat", e.target.value)}
        className={inputClass}
      />
      <input
        type="number"
        step="any"
        min={-180}
        max={180}
        placeholder="Longitude"
        value={coords.lng ?? ""}
        onChange={(e) => update("lng", e.target.value)}
        className={inputClass}
      />
    </div>
  );
}

export function AddGroupItemButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs font-medium text-champagne-gold hover:text-champagne-gold-bright"
    >
      <Plus className="h-3.5 w-3.5" strokeWidth={2} />
      {label}
    </button>
  );
}

export function RemoveGroupItemButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Remove" className="text-body/40 hover:text-error-warm">
      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
    </button>
  );
}
