"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import type { YouTubeFieldSchema } from "@/types/studio";
import { checkYouTubeLink, type YouTubeCheck } from "@/lib/api/youtube";
import { extractVideoId } from "@/lib/studio/product-modules/song-poster/youtube";
import { useProductState } from "@/lib/studio/product-state-context";
import { resolveShellValidationText } from "@/lib/studio/i18n";

/** How long the link must sit still before it is checked. */
export const YOUTUBE_CHECK_DELAY_MS = 500;

type Status = "idle" | "checking" | "confirmed" | "unavailable" | "checkFailed";

interface Found {
  videoId: string;
  title: string;
  authorName: string;
  thumbnailUrl: string;
}

/**
 * A YouTube link, checked as soon as it is recognised (`YouTubeValidateView`,
 * through `checkYouTubeLink`). The link is stored exactly as typed in the
 * field's own key; the confirmed video id in `field.confirmedIdField`.
 *
 * THE CONFIRMATION NEVER OUTLIVES ITS LINK. Editing the link to anything that
 * is not the same video clears the confirmed id in the same update, and an
 * answer is only applied if the link still names the video it was asked
 * about, checked inside the state updater itself, so a slow answer for an
 * earlier link can never confirm a later one. The backend refuses a
 * mismatched id at checkout as well (`song_poster/data.py`).
 *
 * ONE CHECK PER LINK, NEVER PER KEYSTROKE. The check waits for the recognised
 * video id to change and then for typing to pause; an answer is remembered
 * per video id, so pasting the same link again asks nothing. Only "could not
 * check" is forgotten, through the retry button. The endpoint is throttled at
 * 30 a minute (`youtube_validate`).
 */
export function YouTubeFieldInput({
  id,
  field,
  t,
  inputClass,
}: {
  id?: string;
  field: YouTubeFieldSchema;
  t: (key: string) => string;
  inputClass: string;
}) {
  const { values, setValues, locale } = useProductState();
  const text = typeof values[field.id] === "string" ? (values[field.id] as string) : "";
  const storedId = typeof values[field.confirmedIdField] === "string" ? (values[field.confirmedIdField] as string) : "";
  const videoId = extractVideoId(text);

  /** YouTube's answer per video id, for this field's lifetime. */
  const [answers, setAnswers] = useState<Readonly<Record<string, YouTubeCheck>>>({});

  const confirmed = Boolean(videoId) && videoId === storedId;

  /** Stores the confirmed id, but only if the link STILL names that video:
   * checked inside the updater, against the latest link, not this render's. */
  const confirm = (confirmedId: string) =>
    setValues((prev) => {
      const current = typeof prev[field.id] === "string" ? extractVideoId(prev[field.id] as string) : null;
      return current === confirmedId ? { ...prev, [field.confirmedIdField]: confirmedId } : prev;
    });

  useEffect(() => {
    const known = videoId ? answers[videoId] : undefined;
    if (!videoId || confirmed || known) {
      // Back to a link already confirmed in this session (A, then B, then A
      // again): its answer is remembered, so confirm it again without asking.
      if (videoId && !confirmed && known?.valid) confirm(known.videoId);
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(() => {
      checkYouTubeLink(text, controller.signal)
        .catch((): YouTubeCheck => ({ valid: false, code: "checkFailed" }))
        .then((answer) => {
          if (controller.signal.aborted) return;
          // An answer about another video than the one asked about is not
          // an answer to this question.
          const settled: YouTubeCheck = answer.valid && answer.videoId !== videoId ? { valid: false, code: "checkFailed" } : answer;
          setAnswers((prev) => ({ ...prev, [videoId]: settled }));
          if (settled.valid) confirm(settled.videoId);
        });
    }, YOUTUBE_CHECK_DELAY_MS);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
    // `text` is read for the request but is not a trigger: only a change of
    // the recognised video is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, confirmed, answers]);

  const onEdit = (next: string) => {
    setValues((prev) => {
      const out: Record<string, unknown> = { ...prev, [field.id]: next };
      const nextId = extractVideoId(next);
      if (prev[field.confirmedIdField] !== undefined && prev[field.confirmedIdField] !== nextId) {
        delete out[field.confirmedIdField];
      }
      return out;
    });
  };

  const answer = videoId ? answers[videoId] : undefined;
  let status: Status = "idle";
  if (confirmed) status = "confirmed";
  // A recognised link with no answer yet is waiting for the pause or for YouTube.
  else if (videoId && !answer) status = "checking";
  else if (answer && !answer.valid) status = answer.code === "unavailable" ? "unavailable" : "checkFailed";
  const found: Found | null = confirmed && answer?.valid ? answer : null;
  const say = (key: string) => resolveShellValidationText(key, locale);

  return (
    <div className="space-y-2">
      <input
        id={id}
        type="text"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        dir="ltr"
        className={inputClass}
        value={text}
        maxLength={field.maxLength}
        placeholder={t(field.placeholder ?? "")}
        onChange={(e) => onEdit(e.target.value)}
      />
      <div role="status" aria-live="polite" data-youtube-status={status}>
        {status === "checking" && (
          <p className="flex items-center gap-2 text-xs text-body/70">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {say("youtube.checking")}
          </p>
        )}
        {status === "confirmed" &&
          (found ? (
            <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-subtle bg-page/60 p-2">
              {found.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- a remote YouTube thumbnail, not a site asset
                <img src={found.thumbnailUrl} alt="" className="h-10 w-16 shrink-0 rounded object-cover" />
              )}
              <div className="min-w-0 text-xs">
                <p className="flex items-center gap-1 text-body/70">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                  {say("youtube.found")}
                </p>
                <p className="truncate font-medium text-heading" dir="auto">
                  {found.title}
                </p>
                {found.authorName && (
                  <p className="truncate text-body/60" dir="auto">
                    {found.authorName}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="flex items-center gap-1 text-xs text-body/70">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              {say("youtube.confirmed")}
            </p>
          ))}
        {status === "unavailable" && <p className="text-xs text-red-400">{say("youtube.unavailable")}</p>}
        {status === "checkFailed" && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-red-400">
            {say("youtube.checkFailed")}
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-subtle px-2 py-0.5 text-body hover:text-heading"
              onClick={() =>
                setAnswers((prev) => {
                  // Forgetting the failed answer is what asks again.
                  const rest = { ...prev };
                  if (videoId) delete rest[videoId];
                  return rest;
                })
              }
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              {say("youtube.retry")}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
