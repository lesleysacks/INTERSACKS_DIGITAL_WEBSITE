# 05 — SEO Audit (Phase 6)

**Verified:** source inspection, `node scripts/check-seo.mjs` (passes: "12 indexable pages and 12 sitemap URLs"), Lighthouse SEO = 100 on Home, Contact and Work.
**Not verified:** live indexing, Search Console coverage, rankings, search volumes, backlinks. These need Google access, and no keyword tool was available. No volumes or rankings are stated.

## 5.1 The existing 11/12-URL SEO implementation (preserve it)

The implementation from `5dc7fa0` ("Add search metadata, sitemap…") is solid, and it is protected by `check-seo.mjs`:

| Element | State |
|---|---|
| `sitemap.xml` | 12 URLs: 8 pages + 4 tools, absolute `https://www.` URLs. All `lastmod` = 2026-11-02, which is now stale for contact, privacy and others changed since. |
| `robots.txt` | `Allow: /`, sitemap reference |
| Canonicals | Present on all indexable pages, `www` host |
| `noindex` | `payments.html`, `404.html`, greeting-card templates. Correct. |
| Google verification | `googleb593ecdff7e3d7d8.html` present and correctly formatted |
| Titles | All unique, 28–53 characters |
| Descriptions | All unique. Pages 120–158 characters. **Tools 74–96 characters (short).** |
| OG/Twitter | Present everywhere. `og:image:width/height` only on Home. The image is a business card at 1080×716, not 1200×630, so it is cropped on Facebook, WhatsApp and LinkedIn. |
| JSON-LD | `ProfessionalService` (×7 copies), `WebSite`, `WebPage`, `BreadcrumbList` (×7), `ItemList` of 4 `Service`, `ContactPage`, `CollectionPage`, `Person`. All parse (checked by the script). |
| Image alts | 100% present |
| `lang` / `og:locale` | `en-ZA` / `en_ZA` |

## 5.2 Issues found

| # | Issue | Evidence | Priority |
|---|---|---|---|
| 1 | **H1s contain no search terms** on any marketing page | "We build. We automate. You grow.", "Everything you need to show up stronger.", "Ideas made real." | P1. Keep the brand line, and add a keyword-bearing H1 or visible subtitle such as "Website design for small businesses in Paarl & the Winelands". |
| 2 | **One services page for four services** | No `/web-design-paarl.html`, `/business-automation.html`, `/whatsapp-ordering.html` etc. | P1. Competing local pages already exist (`docs/seo-report.md` names Nifty Studio, WebBuild, Paarl Web Design, NextWave Sites). |
| 3 | **No Google Business Profile link or `sameAs`** in schema; no `areaServed`, `geo`, `openingHours`, `priceRange` | `ProfessionalService` block | P1. Local pack visibility depends mostly on GBP. |
| 4 | **No reviews** (on-site or schema) | none | P1 (also conversion) |
| 5 | Thin copy | Services about 120 words per service. Process copy is generic. | P2 |
| 6 | `/index.html` and `/` both resolve | Canonical mitigates it. Internal links use `index.html` everywhere (logo, breadcrumbs). | P2. Point internal links to `/`. |
| 7 | Sitemap `lastmod` identical for all | sitemap.xml | P3. Generate it at build. |
| 8 | Tools are indexable with short descriptions and no `SoftwareApplication` schema | assets/*.html | P2. These could rank for "free invoice generator South Africa", "quote template ZAR". |
| 9 | OG image ratio and branding | 1080×716 business-card photo | P2. Make a 1200×630 branded card per page type. |
| 10 | Contact details in the H1-less footer are fine, but there is **no street-level NAP**, so local consistency relies on GBP | – | P3 (owner choice, since this may be a home business) |
| 11 | No content hub (blog / guides) targeting SA SME questions | Resources has 2 Markdown guides, not HTML pages | P3 |

## 5.3 South African search intent: recommended page targets

These are not invented volumes. Intent is inferred from the services actually offered and the Paarl location.

| Intent cluster | Suggested page | Why |
|---|---|---|
| "website design Paarl", "web designer Paarl / Wellington / Stellenbosch / Cape Winelands" | `web-design-paarl.html` (lead page) | Transactional, local. This is the core revenue service. |
| "small business website cost South Africa", "website price ZAR" | `pricing.html` with packages | Very common SA buyer query. It also converts. |
| "WhatsApp ordering for small business", "WhatsApp order form" | `whatsapp-ordering.html` | A clear differentiator. The tool already exists. |
| "free invoice generator South Africa", "quote template ZAR", "job card template" | Existing tool pages, improved descriptions and copy, `SoftwareApplication` schema | Top-of-funnel traffic with an upsell path ("get this branded for your business") |
| "website maintenance South Africa" | `website-care-plan.html` | Recurring revenue. Not currently offered. |
| "business automation / Google Sheets CRM small business" | `business-automation.html` | Secondary service |

## 5.4 Keep, don't change

- Canonical, robots and sitemap structure, the noindex choices, the JSON-LD `@id` graph pattern, and the `check-seo.mjs` guard rails. Note one exception: §08 recommends relaxing the rule that **forbids** lawful-basis or consent wording in `privacy.html`.
