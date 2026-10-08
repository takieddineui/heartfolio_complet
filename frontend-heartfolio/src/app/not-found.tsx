import Link from "next/link";

/**
 * Root 404 — outside any locale.
 *
 * `[locale]/not-found.tsx` only catches routes that already matched a
 * locale segment. A request to something like `/pricing` or a stale link
 * with no locale never reaches it, and was getting Next's unstyled default
 * page: black Helvetica on white, no header, no way back.
 *
 * Deliberately self-contained. It cannot use `next-intl` — there is no
 * locale to translate into, which is the whole reason this file exists — and
 * it cannot use SiteHeader for the same reason. So it is English-only and
 * styled inline, and links into the default locale rather than guessing.
 */
export default function RootNotFound() {
  return (
    <html lang="en" dir="ltr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F7F1E6",
          color: "#141B2E",
          fontFamily: "Georgia, 'Times New Roman', serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "2rem", margin: "0 0 12px", fontWeight: 400 }}>
            This page doesn&rsquo;t exist.
          </h1>
          <p style={{ margin: "0 0 28px", lineHeight: 1.6, opacity: 0.75 }}>
            The link may be old, or slightly mistyped.
          </p>
          <Link
            href="/en"
            style={{
              display: "inline-block",
              background: "#141B2E",
              color: "#F7F1E6",
              padding: "12px 28px",
              borderRadius: "8px",
              textDecoration: "none",
            }}
          >
            Go to Heartfolio
          </Link>
        </div>
      </body>
    </html>
  );
}
