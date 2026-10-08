"use client";

import { useTranslations } from "next-intl";
import { Star } from "lucide-react";
import type { ApiRatingSummary, ApiReview } from "@/lib/api/products";

/**
 * ---------------------------------------------------------------------
 * PUBLISHED REVIEWS (§7c)
 * ---------------------------------------------------------------------
 * RENDERS NOTHING WHEN THERE ARE NONE, which today is always — nothing has
 * been sold, so nothing has been reviewed. That is the same rule as §10's
 * other-products strip and §11's occasion cards: a heading above an empty
 * space is worse than no section, and it is the state a new storefront is
 * in for its entire first weeks.
 *
 * NO PLACEHOLDERS, NO SAMPLE REVIEWS. There is no "be the first to review"
 * prompt either — on a page whose job is to sell, an empty review section
 * advertises that nobody has bought this.
 *
 * Everything shown here was published by a person in Django admin. Nothing
 * on the submission path can reach this component.
 */
export function ProductReviews({
  reviews,
  summary,
}: {
  reviews?: ApiReview[];
  summary?: ApiRatingSummary | null;
}) {
  const t = useTranslations("Reviews");

  if (!reviews || reviews.length === 0) return null;

  return (
    <section className="bg-card py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-5 sm:px-8">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="font-serif text-3xl leading-tight text-heading sm:text-4xl">
            {t("title")}
          </h2>
          {summary && (
            <p className="text-sm text-body/70">
              {t("summary", { average: summary.average, count: summary.count })}
            </p>
          )}
        </div>

        <ul className="mt-10 space-y-8">
          {reviews.map((review) => (
            <li key={review.id} className="border-t border-subtle pt-8 first:border-0 first:pt-0">
              {review.rating !== null && (
                <div className="flex gap-0.5" aria-label={t("ratingAria", { n: review.rating })}>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <Star
                      key={value}
                      aria-hidden="true"
                      className={
                        value <= review.rating!
                          ? "h-4 w-4 text-champagne-gold"
                          : "h-4 w-4 text-body/20"
                      }
                      fill={value <= review.rating! ? "currentColor" : "none"}
                      strokeWidth={1.5}
                    />
                  ))}
                </div>
              )}
              <p className="mt-3 text-[15px] leading-relaxed text-body/80">{review.message}</p>
              <p className="mt-3 text-sm text-body/55">
                {review.displayName} · {review.createdAt}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
