import { COLOPHON_DOMAIN } from "@/lib/site-config";
import { liveFrameCopy } from "./live-frame-copy";

/**
 * The closing line of every live page (owner, 27 Oct 2026): "Made with
 * Heartfolio · theheartfolio.com" in the ORDER's language, the address
 * linked and never translated. Each product places it after its own ending;
 * it replaced four hand-written English lines.
 */
export function LiveColophon({ locale, className, tabIndex }: { locale: string | undefined; className?: string; tabIndex?: number }) {
  const copy = liveFrameCopy(locale);
  return (
    <p className={className} data-live-colophon="">
      <a href="https://theheartfolio.com" tabIndex={tabIndex}>
        {copy.madeWith} · <bdi>{COLOPHON_DOMAIN}</bdi>
      </a>
    </p>
  );
}
