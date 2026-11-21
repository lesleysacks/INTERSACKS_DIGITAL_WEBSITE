# 04 — Performance Audit (Phase 5)

## 4.1 Test conditions (read before quoting numbers)

| Condition | Value |
|---|---|
| Tool | Lighthouse 12.2.1 (npm, installed in a scratch folder outside the repo), headless Chromium 1243 |
| Server | `python3 -m http.server` on `127.0.0.1:4315`. **No CDN, no gzip/brotli, no HTTP/2, local network.** |
| Throttling | Lighthouse defaults: mobile = simulated slow 4G + 4× CPU; desktop preset |
| Google Analytics | **Not loaded.** `analytics.js` only loads `gtag.js` on production hosts, so real pages are about 150 KB heavier and do slightly more JS work. |
| Google Fonts | Loaded through the sandbox proxy |
| Live site | **Not measured.** The domain is blocked in this container. Field data (CrUX/Core Web Vitals) needs Search Console or PageSpeed Insights, which the owner can check. |

## 4.2 Results (actual measurements)

| Page | Form factor | Perf | A11y | Best Pr. | SEO | FCP | LCP | TBT | CLS | Speed Index | Transfer |
|---|---|---|---|---|---|---|---|---|---|---|---|
| index.html | mobile | 99 | 91 | 100 | 100 | 1.6 s | 1.7 s | 0 ms | 0 | 2.5 s | 175 KiB |
| index.html | desktop | 100 | 95 | 100 | 100 | 0.5 s | 0.5 s | 0 ms | 0.004 | 1.0 s | 198 KiB |
| contact.html | mobile | 100 | 91 | 100 | 100 | 1.5 s | 1.5 s | 0 ms | 0 | 1.5 s | 129 KiB |
| contact.html | desktop | 100 | 96 | 100 | 100 | 0.5 s | 0.5 s | 0 ms | 0.004 | 0.5 s | 129 KiB |
| work.html | mobile | 99 | 91 | 100 | 100 | 1.6 s | 1.9 s | 0 ms | 0 | 1.6 s | 268 KiB |
| work.html | desktop | 99 | 95 | 100 | 100 | 0.5 s | 0.9 s | 0 ms | 0.002 | 0.5 s | 368 KiB |

The homepage Speed Index (2.5 s vs 1.5 s on Contact) reflects the **deliberate 1 s branded loader**.

## 4.3 Assessment by area

| Area | Finding | Verdict |
|---|---|---|
| Images | 17 WebP, 17–57 KB each, explicit `width`/`height`, `loading="lazy"`, `decoding="async"`. Project images are 1440×900 shown in about 400–700 px cards. | Good. Optional: add `srcset` with 720 px variants to save about 40% on mobile. |
| OG image | `business_card.jpeg` 74 KB, 1080×716 | Fine for performance. Not the ideal 1200×630 ratio (see SEO). |
| Fonts | Google Fonts CSS with `display=swap` and preconnect. 2 families, 7 weights requested (Manrope 400–800, Playfair 500/600). | OK. Trim unused weights. Self-hosting would remove a third-party round trip and a privacy concern. |
| JS | About 23 KB first-party, all `defer`. TBT 0 ms. | Excellent |
| CSS | One 34 KB stylesheet, render-blocking but small. Lighthouse flagged no render-blocking opportunity of note. | Good |
| Loader and overlay | `.js::before` covers the page until DOMContentLoaded. On the homepage there is an extra 1,000 ms minimum (2,500 ms safety cap) on the first visit per session. | **Main avoidable delay.** First-time visitors arriving from ads or search are exactly the ones who see it. |
| Caching | GitHub Pages sets `Cache-Control: max-age=600` (platform default, not configurable). No fingerprinted filenames. `?v=` is used only on `contact.html`. | Acceptable. Add consistent `?v=` cache busting to all CSS/JS references. |
| Tool pages | jsPDF (about 360 KB) loaded synchronously from cdnjs in `<body>` | Load it lazily when the user clicks "Download PDF" |
| Third parties | GA4 gtag (about 150 KB) on production only | Normal |

## 4.4 Recommendations

1. Remove or shorten the homepage loader (P2). Show it only when the page has not painted within about 300 ms, or drop it.
2. Add `srcset`/`sizes` for project images (P2).
3. Lazy-load jsPDF on demand in the tools (P2).
4. Reduce font weights or self-host fonts (P3).
5. Owner: check **Search Console → Core Web Vitals** and **PageSpeed Insights** for real field data, since none could be measured here.
