# 02 — UI/UX and Brand Audit (Phases 2 & 3)

**Method:** local render in headless Chromium at 375×812, 768×1024 and 1440×900, on all 14 pages. Screenshots were taken of Home, Services, Work and Contact. The live site was not reachable from this container (see 00 §1).

## 2.1 Live vs repository

| Check | Result |
|---|---|
| Audited commit vs `origin/main` | Identical |
| Live site fetch | **Not possible.** Proxy 403 and DNS failure in this environment. |
| Known historic difference | `docs/enquiry-system.md` (11 Nov) says the *published* contact page was still using `mailto:` at that time, while the branch had the Apps Script URL. PR #16–#20 have since merged to `main`. Whether Pages rebuilt from that commit is **unverified**. |

**Owner action:** open `https://www.intersacks.co.za/contact.html`, view the source, and confirm that the form has `data-enquiry-endpoint="https://script.google.com/macros/s/…/exec"` and that the stylesheet link ends `?v=lead-progress`. If so, live = repo.

## 2.2 Responsive and technical rendering results (verified locally)

| Check | Result |
|---|---|
| Horizontal overflow | **0 px** on every page at all three widths |
| Console errors on site pages | **0** (tool pages only error because the jsPDF CDN is blocked in this sandbox) |
| H1 count | Exactly 1 on every page |
| Images without `alt` | 0 |
| Broken internal links | 0 |
| Mobile menu | Opens; `aria-expanded` updates; links close it. **Escape does not close it**, and focus is not managed. |
| Small tap targets (<24 px) | 5–14 per page on mobile. Lighthouse `target-size` fails on Home and Contact. |

## 2.3 Visual identity and consistency (7/10)

**Strengths**
- Tight token set: `--navy #081423`, `--gold #c8a15a`, `--cream #f8f8f6`, `--ink`, `--muted`. Manrope for UI and Playfair Display italic for emphasis words. This reads as premium and is consistent on all pages.
- Eyebrow + H2 + italic-gold-word pattern is used consistently across sections.
- Footer is identical on every page, with email, phone, location and privacy.

**Specific defects**
1. **Desktop hero overlap (verified in screenshot).** On `index.html` at 1440 px, `.art-detail` ("Designed with intention. Built for momentum.") sits on top of the `.art-main` caption "Smart websites. Intelligent automation.", leaving fragments such as "…EBSITES." and "…ELLIGENT AUTOMATION." visible. It looks like a bug to a design-literate buyer. Fix the positioning or hide the caption in `.art-main`.
2. **WhatsApp floating button shows a letter "W"** instead of the WhatsApp glyph. Recognition is weaker and it looks unfinished. On mobile it overlaps body headings (seen on the Contact page at 375 px).
3. **404 buttons:** gold-lite text on a gold background, **1.5:1 contrast** (axe). Effectively unreadable.
4. **Breadcrumb links** are almost the same colour as the surrounding text (1.14–1.73:1 vs the 3:1 needed to tell link from text).
5. The **"Est. 2024" stamp** draws attention to how new the business is, with no proof to balance it. Remove it or pair it with a proof point.

## 2.4 Typography and readability

- Body is 15 px / 1.7. That is comfortable on desktop but small for older SME owners on mobile. Consider 16 px on mobile.
- Many uppercase, letter-spaced labels at about 9–11 px (eyebrows, kickers, tags). On Resources, 9 px gold-on-white kickers fail contrast (2.41:1).

## 2.5 Navigation hierarchy

- Six top-level items: About, Services, Work, Resources, Process, Contact, plus "Start a project". **Process** and **About** could merge, or Process could become a section of Services. That would free space for a **Pricing/Packages** item, which buyers look for.
- "Resources" in the primary nav sends commercial visitors into a free-tools hub before they have converted. Consider moving it to the footer, or label it "Free tools".

## 2.6 Five-second test (Home, above the fold, 1440×900)

| Question | Can a visitor answer it in 5 s? | Evidence |
|---|---|---|
| What does InterSacks do? | **Partly** | H1 "We build. We automate. You grow." doesn't say *websites*. The eyebrow "Digital solutions studio" is generic. "Smart websites" is only in the art card, which is partly hidden. |
| Who does it serve? | **No** | No audience such as "small businesses", "trades" or "salons" above the fold |
| What problems does it solve? | **No** | "refined digital systems that earn attention" is abstract |
| Why trust it? | **No** | No reviews, client count, logos or guarantee. "Est. 2024" |
| How to get started? | **Yes** | "Let's work together" CTA, "Start a project" in the nav, WhatsApp button |

**Suggested direction (not yet implemented):**
H1: "Websites and WhatsApp-ready business tools for South African small businesses." Sub: "Designed and built in Paarl. Fixed quotes, fast turnaround, local support." Then add a proof strip, such as "x sites launched · 4 free business tools · Reply within 1 business day".

## 2.7 Section-level assessment

| Section | Assessment | Recommendation |
|---|---|---|
| Hero | Beautiful but abstract (above) | Rewrite copy. Keep the design. |
| Intro "Digital should feel effortless" | Repeats the hero's abstraction | Replace with "Who it's for" (3 audience tiles) |
| Services grid (4 equal cards) | Each card links only to `contact.html`, not to the service detail | Link each card to `services.html#…`. Show a lead service first. |
| Selected work | 3 items: one live site, one concept, one Django capstone. The capstone is an educational project, not a client deliverable. | Show real or paid work first. Move the capstone to About or Skills. |
| Process (duplicated on Home and process.html) | Fine but generic | Add timeframes (for example "Week 1: plan…") |
| "Why InterSacks" | Claims ("a team that genuinely cares") with no evidence. "Team" may overstate a solo studio. | Replace with testimonials and concrete guarantees |
| Capabilities | Repeats Services | Merge |
| Contact CTA | Good | Add the WhatsApp CTA here too |

## 2.8 Services page

Clear structure (01–04 with anchors and quote CTAs). Missing: deliverables, timeframes, starting prices, FAQs, examples per service. "AI & Software" says "It is not a ready-made product". The honesty is good, but the wording is defensive.

## 2.9 Portfolio / Work page

- **Credibility gap:** of 13 items, 6 are "Independent Portfolio Concept" for real-named local businesses, 1 is a capstone, 1 is "In Development", 4 are prototypes and 2 are templates. Only "Generative A.I — Industrial Automation" is presented as live, and its client status is not stated.
- The disclaimer is legally sensible. It also tells prospects that these businesses did not hire InterSacks. Using **real business names** for unsolicited concepts carries reputational and trademark risk. Consider fictional names, or get written permission.

## 2.10 Mobile UX

- Hero takes about the full first screen. The CTA is visible above the fold at 375 px.
- The Contact page puts the form below the hero and the contact list, so the form starts around the second or third screen. Add an "Enquire now" anchor or WhatsApp CTA in the hero.
- The floating WhatsApp button overlaps headings while scrolling. Add bottom padding or reduce its size on mobile.
