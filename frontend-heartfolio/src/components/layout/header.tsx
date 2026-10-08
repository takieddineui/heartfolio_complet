"use client";

import { useState } from "react";
import { Logo } from "@/components/brand/logo";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";

export function SiteHeader() {
  const t = useTranslations("Nav");
  const [open, setOpen] = useState(false);

  // "Shop by Product" now goes to the real collection route rather than
  // an anchor on the homepage — the collection is a page, not a section.
  const primaryLinks = [
    { label: t("product"), href: "/products" },
    { label: t("occasion"), href: "/#occasions" },
    { label: t("story"), href: "/#why" },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-subtle/70 bg-page/85 backdrop-blur-md">
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-5 sm:px-8">
        {/*
          The mark plus the word, rather than the word plus a ♥ glyph. The
          glyph was a placeholder: it took the heading font's heart, not the
          brand's, so the site's own header did not show the logo.

          MARK AND WORD ARE SEPARATE HERE, not the `full` lockup variant:
          the lockup stacks the word UNDER the mark, which is right for a
          splash or an OG image and wrong for a 72px-tall bar. Side by side
          keeps the header height.

          `title={null}` because the visible word "Heartfolio" follows it —
          without that, a screen reader announces the brand twice.
        */}
        <Link
          href="/"
          className="flex items-center gap-2.5 font-serif text-xl tracking-tight text-heading"
          aria-label="Heartfolio home"
        >
          <Logo variant="mark" title={null} className="h-7 w-7" />
          Heartfolio
        </Link>

        <nav className="hidden items-center gap-9 md:flex" aria-label="Primary">
          {primaryLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-[15px] text-body/85 transition-colors hover:text-heading"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <LocaleSwitcher className="hidden sm:flex" />
          <ThemeToggle />

          {/* The Search and Cart icons that used to sit here were removed:
              neither did anything, and a cart icon on a site with no
              checkout misleads both customers and Paddle's reviewers. */}

          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/create">{t("cta")}</Link>
          </Button>

          <button
            aria-label={t("menu")}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-heading md:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            aria-label="Secondary"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-subtle/70 bg-page md:hidden"
          >
            <ul className="flex flex-col gap-1 px-5 py-4">
              {[...primaryLinks, { label: t("secondary.faq"), href: "/#faq" }].map(
                (link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={() => setOpen(false)}
                      className="block rounded-md px-3 py-3 text-[15px] text-body hover:bg-subtle/40"
                    >
                      {link.label}
                    </Link>
                  </li>
                )
              )}
            </ul>
            <div className="flex items-center justify-between border-t border-subtle/70 px-5 py-4">
              <LocaleSwitcher />
              <span className="text-xs text-body/60">{t("menu")}</span>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

/** Mobile-only sticky bottom CTA — always visible, never buried in a menu. */
export function MobileStickyCta() {
  const t = useTranslations("Nav");
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-subtle bg-page/95 p-3 backdrop-blur-md md:hidden">
      <Button asChild className="w-full" size="lg">
        <Link href="/create">{t("cta")}</Link>
      </Button>
    </div>
  );
}
