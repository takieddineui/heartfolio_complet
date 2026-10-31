/**
 * The crawlers that get each page's metadata in its `<head>` (`next.config.ts`,
 * `htmlLimitedBots`). Next streams the metadata of a page that renders
 * dynamically (a product page, behind its loading skeleton) into the body for
 * everyone else, and only these "HTML-limited" bots wait for it in the head.
 *
 * NEXT'S OWN LIST, plus Pinterest (owner, 31 Oct 2026): Pinterest's crawler
 * reads `<meta name="p:domain_verify">` and Rich Pin tags from the head, and
 * Next's default list does not name it, so on a product page it found them
 * in the body (measured on the production build). Setting this option
 * REPLACES Next's list, so the default is copied here whole and
 * `site-verification.test.ts` fails if Next's own list changes.
 */
export const NEXT_DEFAULT_HTML_LIMITED_BOTS =
  String.raw`[\w-]+-Google|Google-[\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight`;

export const HTML_LIMITED_BOTS = new RegExp(`${NEXT_DEFAULT_HTML_LIMITED_BOTS}|Pinterest`, "i");
