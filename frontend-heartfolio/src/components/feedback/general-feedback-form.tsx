"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitGeneralFeedback } from "@/lib/api/orders";

/**
 * ---------------------------------------------------------------------
 * GENERAL SITE FEEDBACK (§7c)
 * ---------------------------------------------------------------------
 * The mode tied to no order. Anyone can submit, including someone who has
 * never bought anything — a person reporting a broken link should not have
 * to make a purchase first. That openness is also why the endpoint is
 * throttled server-side rather than trusting this form.
 *
 * THE RATING IS OPTIONAL HERE, unlike the order-tied box. Someone
 * suggesting a product or reporting a bug has nothing to award stars to,
 * and forcing a number would either lose the submission or produce a
 * meaningless one that pollutes any future average.
 *
 * At least one of rating or message is required, which is what the submit
 * button reflects. The server enforces the same rule — this is convenience,
 * not the guard.
 *
 * THE EMAIL IS OPTIONAL AND SAYS SO. Demanding an address is the fastest
 * way to stop someone submitting at all, and the label explains what it is
 * for rather than leaving people to guess whether they are signing up for
 * something.
 */
export function GeneralFeedbackForm() {
  const t = useTranslations("FeedbackPage");

  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  if (state === "sent") {
    return (
      <div className="rounded-[var(--radius-md)] border border-subtle bg-card p-8 text-center">
        <p className="font-serif text-xl text-heading">{t("thanksTitle")}</p>
        <p className="mt-3 text-[15px] text-body/70">{t("thanksBody")}</p>
      </div>
    );
  }

  const hasSomething = rating > 0 || message.trim().length > 0;
  const shown = hovered || rating;

  async function send() {
    setState("sending");
    try {
      await submitGeneralFeedback(
        rating > 0 ? rating : null,
        message.trim(),
        email.trim(),
        displayName.trim()
      );
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-subtle bg-card p-6 sm:p-8">
      <label className="block text-sm font-medium text-heading">{t("ratingLabel")}</label>
      <div className="mt-3 flex gap-1" onMouseLeave={() => setHovered(0)}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            aria-label={t("rateAria", { n: value })}
            aria-pressed={rating === value}
            onMouseEnter={() => setHovered(value)}
            onClick={() => setRating(value === rating ? 0 : value)}
            className="p-1"
          >
            <Star
              className={value <= shown ? "h-7 w-7 text-champagne-gold" : "h-7 w-7 text-body/25"}
              fill={value <= shown ? "currentColor" : "none"}
              strokeWidth={1.5}
            />
          </button>
        ))}
      </div>

      <label className="mt-6 block text-sm font-medium text-heading" htmlFor="feedback-message">
        {t("messageLabel")}
      </label>
      <textarea
        id="feedback-message"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        rows={5}
        maxLength={4000}
        placeholder={t("messagePlaceholder")}
        className="mt-2 w-full rounded-[var(--radius-sm)] border border-subtle bg-page p-3 text-sm text-body outline-none focus:border-champagne-gold"
      />

      {/*
        §7c — how they would be credited IF we ever publish this. The
        placeholder says exactly that: giving a name is not agreeing to be
        published, and the label should not imply it is.

        Collected now rather than when publishing starts, because a name
        cannot be retrofitted onto reviews already written without going
        back and asking each person.
      */}
      <label className="mt-6 block text-sm font-medium text-heading" htmlFor="feedback-name">
        {t("nameLabel")}
      </label>
      <input
        id="feedback-name"
        type="text"
        maxLength={80}
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        placeholder={t("namePlaceholder")}
        className="mt-2 w-full rounded-[var(--radius-sm)] border border-subtle bg-page p-3 text-sm text-body outline-none focus:border-champagne-gold"
      />

      <label className="mt-6 block text-sm font-medium text-heading" htmlFor="feedback-email">
        {t("emailLabel")}
      </label>
      <input
        id="feedback-email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder={t("emailPlaceholder")}
        className="mt-2 w-full rounded-[var(--radius-sm)] border border-subtle bg-page p-3 text-sm text-body outline-none focus:border-champagne-gold"
      />

      {state === "error" && <p className="mt-4 text-sm text-body/60">{t("error")}</p>}

      <Button
        className="mt-6 w-full"
        disabled={!hasSomething || state === "sending"}
        onClick={send}
      >
        {state === "sending" ? t("sending") : t("submit")}
      </Button>
    </div>
  );
}
