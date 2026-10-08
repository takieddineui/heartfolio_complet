"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { fetchEntitlementBlob } from "@/lib/api/delivery";
import { resolveShellText } from "@/lib/studio/i18n";

/**
 * ---------------------------------------------------------------------
 * COMPILING THE AR TRACKING TARGET, IN THE BUYER'S BROWSER (§21i)
 * ---------------------------------------------------------------------
 * MindAR's compiler is JavaScript. Running it server-side would mean Node,
 * node-canvas and TensorFlow.js inside a Python image — roughly half a
 * gigabyte and a second runtime — for a job that happens once per order.
 *
 * WHY HERE AND NOT AT FIRST SCAN. Compilation is 10–60 seconds on a phone.
 * At first scan the person waiting is the gift RECIPIENT, whose first
 * thirty seconds are the entire product. Here it is the buyer, who is
 * already engaged, already waiting for a purchase to settle, and doing this
 * deliberately. If it fails, it fails at a desk rather than at a party, and
 * before the card has been printed.
 *
 * First-scan compilation still exists as the fallback (`needsTarget` in the
 * AR payload) for a buyer whose tab closed or whose device could not manage
 * it. This is the path that makes that fallback rare.
 *
 * DELIBERATELY UNDRAMATIC. It runs quietly below the downloads, states what
 * it is doing, and never blocks anything: the customer's files are already
 * available, and a failure here costs them a slower first scan rather than
 * their purchase. There is no error state that demands action, because
 * there is no action they could usefully take.
 */

const MINDAR_COMPILER_URL =
  "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js";

type Phase = "idle" | "working" | "done" | "failed";

interface CompilerLike {
  compileImageTargets: (
    images: HTMLImageElement[],
    onProgress: (percent: number) => void
  ) => Promise<unknown>;
  exportData: () => Promise<ArrayBuffer | Uint8Array | Blob>;
}

export function ARTargetCompiler({
  entitlementId,
  accessToken,
}: {
  entitlementId: string;
  accessToken?: string;
}) {
  const locale = useLocale();
  const t = (key: string) => resolveShellText(key, locale);
  const [phase, setPhase] = useState<Phase>("idle");
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function compile() {
      setPhase("working");
      try {
        await loadScript(MINDAR_COMPILER_URL);
        if (cancelled) return;

        const globalWindow = window as unknown as {
          MINDAR?: { IMAGE?: { Compiler?: new () => CompilerLike } };
        };
        const Compiler = globalWindow.MINDAR?.IMAGE?.Compiler;
        if (!Compiler) throw new Error("compiler unavailable");

        /**
         * Fetched through the ordinary authorised download, then handed to
         * the compiler as a BLOB URL.
         *
         * That matters for more than tidiness. The card is served from
         * R2's own domain, and a cross-origin image taints the canvas the
         * compiler draws into — a tainted canvas cannot be read back, which
         * is the entire operation. A blob URL is same-origin, so the
         * question does not arise.
         *
         * It also means no second access path to a customer's files: the
         * same endpoint, the same ownership check, as clicking download.
         */
        const blob = await fetchEntitlementBlob(entitlementId, accessToken);
        if (cancelled) return;

        const objectUrl = URL.createObjectURL(blob);
        let image: HTMLImageElement;
        try {
          image = await loadImage(objectUrl);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
        if (cancelled) return;

        const compiler = new Compiler();
        await compiler.compileImageTargets([image], (value) => {
          if (!cancelled) setPercent(Math.round(value));
        });
        if (cancelled) return;

        const exported = await compiler.exportData();
        const targetBlob =
          exported instanceof Blob ? exported : new Blob([exported as ArrayBuffer]);

        const body = new FormData();
        body.append("target", targetBlob, "target.mind");

        const response = await fetch(`/api/v1/ar-targets/${entitlementId}/`, {
          method: "POST",
          body,
          credentials: "include",
          headers: { "X-CSRFToken": readCsrfToken() },
        });
        if (!response.ok) throw new Error(`upload failed: ${response.status}`);

        if (!cancelled) setPhase("done");
      } catch {
        // Swallowed on purpose — see the file header. The fallback covers
        // it, and there is nothing the customer could do about it.
        if (!cancelled) setPhase("failed");
      }
    }

    compile();
    return () => {
      cancelled = true;
    };
  }, [entitlementId, accessToken]);

  if (phase === "idle") return null;

  return (
    <p className="text-sm text-body/60" aria-live="polite">
      {phase === "working" && `${t("arTarget.working")} ${percent}%`}
      {phase === "done" && t("arTarget.done")}
      {/* Not framed as an error: nothing is broken, and the first scan will
          simply take a little longer. */}
      {phase === "failed" && t("arTarget.deferred")}
    </p>
  );
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // No `crossOrigin` needed: the caller passes a blob URL, which is
    // same-origin by construction.
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("card image failed to load"));
    image.src = url;
  });
}

function readCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]!) : "";
}
