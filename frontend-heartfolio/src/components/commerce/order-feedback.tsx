"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitOrderFeedback } from "@/lib/api/orders";
import { resolveShellText } from "@/lib/studio/i18n";

/**
 * ---------------------------------------------------------------------
 * FEEDBACK ON THE THANK-YOU PAGE (§10, §7c)
 * ---------------------------------------------------------------------
 * §10 places the review box here rather than in an email or a separate
 * page, and this is where it earns its response: the customer has just
 * opened the thing they bought. Asking a week later by email reaches
 * someone with no reason to care any more.
 *
 * ASKED ONCE, AND ONLY AFTER PAYMENT. Rendered only for a paid order, so
 * nobody is asked to rate something they have not received. After a
 * successful submission the form is replaced by a thank-you rather than
 * reset, because a form that comes back looks like the submission failed.
 *
 * A FAILURE HERE IS NOT WORTH ALARMING ANYONE ABOUT. If the request fails,
 * the message is quiet and the downloads above are untouched — the customer
 * has their keepsake, which is the thing that mattered. Shouting about a
 * failed rating on the page that confirms a successful purchase would be a
 * strange sense of priorities.
 *
 * The rating is required (a submission is a rating; words are optional),
 * which is why the button stays disabled until a star is chosen rather than
 * submitting a zero.
 */
export function OrderFeedback({
  orderId,
  accessToken,
}: {
  orderId: string;
  accessToken?: string;
}) {
  const locale = useLocale();
  const st = (key: string) => resolveShellText(key, locale);

  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  if (state === "sent") {
    return (
      <div className="rounded-[var(--radius-md)] border border-subtle bg-card p-6 text-start">
        <p className="text-[15px] text-body/80">{st("feedback.thanks")}</p>
      </div>
    );
  }

  async function send() {
    setState("sending");
    try {
      await submitOrderFeedback(orderId, rating, message.trim(), accessToken);
      setState("sent");
    } catch {
      setState("error");
    }
  }

  const shown = hovered || rating;

  return (
    <div className="rounded-[var(--radius-md)] border border-subtle bg-card p-6 text-start">
      <h3 className="font-serif text-xl text-heading">{st("feedback.title")}</h3>
      <p className="mt-2 text-sm text-body/65">{st("feedback.subtitle")}</p>

      <div className="mt-4 flex gap-1" onMouseLeave={() => setHovered(0)}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            aria-label={st("feedback.rateAria").replace("{n}", String(value))}
            aria-pressed={rating === value}
            onMouseEnter={() => setHovered(value)}
            onClick={() => setRating(value)}
            className="p-1"
          >
            <Star
              className={
                value <= shown ? "h-7 w-7 text-champagne-gold" : "h-7 w-7 text-body/25"
              }
              fill={value <= shown ? "currentColor" : "none"}
              strokeWidth={1.5}
            />
          </button>
        ))}
      </div>

      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        rows={3}
        maxLength={4000}
        placeholder={st("feedback.placeholder")}
        className="mt-4 w-full rounded-[var(--radius-sm)] border border-subtle bg-page p-3 text-sm text-body outline-none focus:border-champagne-gold"
      />

      {state === "error" && (
        <p className="mt-3 text-sm text-body/60">{st("feedback.error")}</p>
      )}

      <Button
        className="mt-4 w-full"
        disabled={rating === 0 || state === "sending"}
        onClick={send}
      >
        {state === "sending" ? st("feedback.sending") : st("feedback.submit")}
      </Button>
    </div>
  );
}
