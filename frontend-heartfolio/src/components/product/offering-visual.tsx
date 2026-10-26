"use client";

import { useTranslations } from "next-intl";
import { CaptureStill, PhoneFrame } from "@/components/captures/capture-media";
import type { ProductCaptures } from "@/lib/captures/manifest";
import type { OfferingType } from "@/lib/products/types";

/**
 * The picture beside each format on a product page, made of the product's
 * REAL captures (`lib/captures`, 26 Oct 2026), not drawn stand-ins:
 *
 * - Digital: the live page on a phone (its last frame).
 * - Printable: the real print (Classic 8x10, with edges) in a frame.
 * - Printable + Digital: the two together.
 *
 * The wallpaper and Complete pictures are gone with the formats themselves:
 * neither is sold (every wallpaper pack and `complete` are disabled), so a
 * product page never lists them.
 */
export function OfferingVisual({
  type,
  captures,
  name,
}: {
  type: OfferingType;
  captures: ProductCaptures | null;
  /** The product's name, for the pictures' descriptions. */
  name: string;
}) {
  const t = useTranslations("Captures");
  if (!captures?.poster) return <div className="h-full w-full bg-subtle/25" />;

  const phone = (width: string) => (
    <PhoneFrame className={width}>
      <CaptureStill still={captures.poster!} alt={t("phoneAlt", { name })} />
    </PhoneFrame>
  );
  const print = (width: string) =>
    captures.print ? (
      <div className={`border-[6px] border-heading/15 bg-card p-1.5 shadow-[var(--shadow-lift)] ${width}`}>
        <CaptureStill still={captures.print} alt={t("printAlt", { name })} />
      </div>
    ) : null;

  if (type === "printable") {
    return <div className="flex h-full w-full items-center justify-center bg-subtle/25 p-8">{print("w-[46%] max-w-[230px]")}</div>;
  }

  if (type === "printable_plus_digital") {
    return (
      <div className="flex h-full w-full items-center justify-center gap-5 bg-subtle/25 p-8">
        {print("w-[40%] max-w-[200px]")}
        {phone("w-[26%] max-w-[130px]")}
      </div>
    );
  }

  // Digital (and AR/VR, should they return): the live page on a phone.
  return <div className="flex h-full w-full items-center justify-center bg-subtle/25 p-8">{phone("w-[30%] max-w-[150px]")}</div>;
}
