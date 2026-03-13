# Frontend Redesign: All Content Pages + Landing Page

**Date:** 2026-03-12
**Branch:** seo_overhaul
**Goal:** Redesign all non-game content pages and the landing page with a cutting-edge cyber/grid aesthetic using the existing game color palette. Primary conversion goal: get visitors to click "Play Now" instantly.

---

## Aesthetic Direction

**Cyber/Grid** — dark background with animated grid lines, neon glow accents, futuristic angular typography, scanline effects. Coheres with the existing in-game menu screen aesthetic.

### Typography
Loaded via `@import` in `style.css` (CSS-only, no per-page `<link>` or preconnect needed):
```css
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Share+Tech+Mono&family=Rajdhani:wght@400;500;600;700&display=swap');
```
- **Display/Logo/CTAs:** `Orbitron` (700/900) — angular, futuristic
- **Labels/Badges/Mono text:** `Share Tech Mono` — hacker terminal feel
- **Body/Descriptions:** `Rajdhani` (400/500/600) — readable geometric sans

### CSS Custom Properties
Add a `:root` block at the top of the new CSS section (after existing game styles, before any redesigned rules):

```css
:root {
  --cp-bg:           #0a0a1a;
  --cp-bg2:          #0d0d22;
  --cp-purple:       #7b8cff;
  --cp-violet:       #c084fc;
  --cp-pink:         #f472b6;
  --cp-blue:         #60a5fa;
  --cp-green:        #34d399;
  --cp-text:         #e9ebff;
  --cp-muted:        rgba(233, 235, 255, 0.45);
  --cp-edge:         rgba(123, 140, 255, 0.22);
  --cp-glow-purple:  rgba(123, 140, 255, 0.4);
  --cp-glow-violet:  rgba(192, 132, 252, 0.4);
  --cp-grid-color:   rgba(123, 140, 255, 0.07);
}
```

All prefixed `--cp-` to avoid collisions with existing game variables.

### Background
CSS grid pattern via `background-image` on `body.content-page-layout::before` (fixed pseudo-element, `z-index: 0`, `pointer-events: none`):
```css
background-image:
  linear-gradient(var(--cp-grid-color) 1px, transparent 1px),
  linear-gradient(90deg, var(--cp-grid-color) 1px, transparent 1px);
background-size: 40px 40px;
```
Plus radial gradient overlays for depth (purple from top-center, violet from bottom-right).

---

## Critical CSS Compatibility Notes

### `overflow: hidden` on `html, body`
The global `html, body { overflow: hidden }` rule at the top of `style.css` is required by the 3D game. The existing `body.content-page-layout { overflow: auto }` rule (already present in `style.css`) overrides this for content pages. **This override must remain intact and appear after the global rule.** Do not reorganise the CSS in a way that places the new content-page rules before the global overflow rule.

### Game page nav/footer (`play-chess-online/index.html`)
`play-chess-online/index.html` has `<body>` with **no class**. All new nav and footer redesign rules must use bare selectors (`#site-nav`, `#site-footer`) since the game page uses those too. The new cyber aesthetic **intentionally applies** to the game page's nav and footer as well — this is desired for visual consistency. Existing game-page-only overrides (menu screen, lobby, panels, canvas) are scoped to their own IDs/classes and will not be affected.

### `.seo-links` scoping
New `.seo-links` redesign rules must be scoped to `.content-inner .seo-links` only. The game page has `#seo-content .seo-links` which must retain its own styles. Do not write unscoped `.seo-links` rules.

---

## Components

### Navigation (`#site-nav`)
- Fixed, full-width, `backdrop-filter: blur(14px)`, `background: rgba(10,10,26,0.8)`, `border-bottom: 1px solid var(--cp-edge)`
- Logo (`.site-nav-logo`): Orbitron 700, `color: var(--cp-purple)`, `.org` span in `var(--cp-violet)`
- Links: Share Tech Mono, 10px, 3px letter-spacing, `var(--cp-muted)` → hover `var(--cp-purple)`, `text-transform: uppercase`
- CTA "Play Now" (`.site-nav-links a[href*="play-chess-online"]`): angled clip-path (`polygon(8px 0%, 100% 0%, calc(100% - 8px) 100%, 0% 100%)`), `background: linear-gradient(90deg, var(--cp-purple), var(--cp-violet))`, `color: var(--cp-bg)`, Orbitron 700
- Mobile hamburger: existing `#site-nav-toggle` JS preserved; at `≤768px` `.site-nav-links` collapses

### Landing Page Hero (`index.html` specific)
The landing page `index.html` keeps `body.content-page-layout` and `main.content-page > div.content-inner` per SEO rules. Inside `.content-inner`, the existing `<h1>` and `.landing-cards` are replaced with a full hero layout:

```html
<div class="content-inner landing-hero-inner">
  <div class="landing-hero">
    <!-- eyebrow, h1, subtitle, cta group, badges -->
  </div>
  <div class="mode-grid">
    <!-- 3 mode cards -->
  </div>
</div>
```

`.landing-hero-inner` removes the glassmorphic card styling (transparent background, no border, full-width) so the hero feels full-bleed while still satisfying `main > .content-inner` structural requirement.

Hero contents:
- Eyebrow: Share Tech Mono, 11px, 6px letter-spacing, `var(--cp-purple)`, "Free · No Download · No Signup"
- H1: Orbitron 900, `clamp(52px, 9vw, 110px)`, two `<span>` lines — line 1 gradient-filled (`titleGradient` animation reused), line 2 outline stroke only
- Subtitle: Rajdhani 500, `var(--cp-muted)`
- Primary CTA: angled clip-path button, `background: linear-gradient(90deg, var(--cp-purple), var(--cp-violet))`, `box-shadow: 0 0 40px var(--cp-glow-purple)`, hover `translateY(-2px)` + `brightness(1.15)`
- Secondary CTA: outline variant
- Badge row: green dot + Share Tech Mono labels
- Scanline: `main.content-page::before` pseudo-element sweeping `top: 0→100%` over 4s. Scoped via `body.content-page-layout:has(.landing-hero-inner) main.content-page::before`. CSS `:has()` is supported in all modern browsers (Chrome 105+, Firefox 121+, Safari 15.4+); this is a decorative effect only and graceful degradation (no scanline on unsupported browsers) is acceptable — no fallback required.
- Ghost glyph: `♛` at `opacity: 0.025`, `font-size: clamp(300px,50vw,600px)`, absolutely centered

### Mode Cards (`.mode-grid`) — replaces `.landing-cards`
- CSS Grid 3 columns, `gap: 1px`, `background: var(--cp-edge)` (creates hairline grid borders)
- `border: 1px solid var(--cp-edge)` wrapping the entire grid
- Each `.mode-card`: `background: var(--cp-bg2)`, `text-decoration: none`, hover `background: rgba(123,140,255,0.06)`
- `::before` top accent bar: `scaleX(0→1)` on hover, `background: linear-gradient(90deg, var(--cp-purple), var(--cp-violet))`
- Mode number: Share Tech Mono 10px, opacity 0.5
- Title: Orbitron 700, 16px
- Description: Rajdhani body
- Arrow `↗`: appears on hover, `translate(4px, -4px)`

### Content Pages (`.content-inner`)
All non-landing content pages via existing `main.content-page > .content-inner`:
- `background: rgba(13,13,34,0.75)`, `backdrop-filter: blur(18px)`, `border: 1px solid var(--cp-edge)`
- `max-width: 860px`, `margin: 0 auto`, `padding: 60px 56px`
- `main.content-page`: `padding-top: 80px` (accounts for fixed nav height), `min-height: 100vh`

**Typography within `.content-inner`:**
- `h1`: Orbitron 700, `background: linear-gradient(...)`, `-webkit-background-clip: text`, `titleGradient` animation (reuse existing keyframe), `filter: drop-shadow(0 0 24px var(--cp-glow-purple))`
- `h2`: Rajdhani 700, `color: var(--cp-text)`, `border-left: 3px solid var(--cp-purple)`, `padding-left: 12px`. **Remove** `border-bottom` (replace existing rule entirely to avoid both borders coexisting)
- `h3`: Rajdhani 600, `color: var(--cp-purple)`
- `p`: Rajdhani 400-500, `color: var(--cp-muted)`, `line-height: 1.8`, `font-size: 16px`
- `strong`: `color: var(--cp-text)`

### CTA Button (`.cta-btn`, inside `.content-cta`)
- Orbitron 700, 12px, 3px letter-spacing, `text-transform: uppercase`
- Angled clip-path, `background: linear-gradient(90deg, var(--cp-purple), var(--cp-violet))`
- `color: var(--cp-bg)`, `padding: 14px 40px`
- Hover: `filter: brightness(1.15)` + `translateY(-2px)` + `box-shadow: 0 0 30px var(--cp-glow-purple)`
- `.content-cta`: `text-align: center`, `margin: 40px 0`

### SEO Links (`.content-inner .seo-links`)  ← scoped, NOT bare `.seo-links`
- `border-left: 2px solid var(--cp-edge)`, `padding-left: 24px`
- `h3`: Share Tech Mono, 11px, `var(--cp-purple)`, `content: "// "` via `::before`
- Links: Rajdhani 500, `var(--cp-muted)` → hover `var(--cp-purple)`, `text-decoration: underline`
- `list-style: none`, `display: flex`, `flex-direction: column`, `gap: 8px`

### Footer (`#site-footer`)
- `border-top: 1px solid var(--cp-edge)`, `backdrop-filter: blur(12px)`
- `background: rgba(10,10,26,0.7)`
- `padding: 28px 48px`, flex row, `justify-content: space-between`, `flex-wrap: wrap`, `gap: 16px`
- Links: Share Tech Mono 10px, 2px letter-spacing, uppercase, `var(--cp-muted)` → `var(--cp-purple)`
- `.footer-copy`: mono, `rgba(233,235,255,0.2)`

---

## Files Changed

### `public/style.css`
Two-step edit process:

**Step 1 — Move `@import` to line 1:**
Add the Google Fonts `@import` as the very first line of `style.css`. CSS `@import` rules must precede all other rules. This is a targeted in-place edit at the top of the file.

**Step 2 — In-place edits to existing rules (find and edit, do not append):**
- **Existing bare `.seo-links` block** (currently around lines 2391–2427): find and **delete it entirely**. The new scoped `.content-inner .seo-links` rules (appended in Step 3) replace it. Leaving both would conflict.
- **Existing `.content-inner h2` rule**: find it and **edit in-place** — remove `border-bottom`, add `border-left: 3px solid var(--cp-purple); padding-left: 12px`. Do not append a second rule; the existing rule must be replaced.

**Step 3 — Append after all existing game styles:**
1. `:root` block with `--cp-*` variables
2. New content-page rules (nav, content-inner, landing hero, mode-grid, cta, `.content-inner .seo-links`, footer)
3. Responsive breakpoints

### `index.html`
- Replace `.landing-cards` block with `.landing-hero` + `.mode-grid` markup
- Add `landing-hero-inner` class to the `div.content-inner` wrapper
- Keep all SEO meta tags, JSON-LD, canonical URL, GA placeholder, `<link rel="stylesheet" href="/style.css">`
- Keep `body class="content-page-layout"`, `nav#site-nav`, `main.content-page`, `footer#site-footer`, `content-page.ts` script
- **No `<link>` preconnect tags needed** — fonts loaded via `@import` in CSS

### Content pages — HTML structure unchanged
CSS handles all visual changes. No HTML modifications:
- `chess-rules/index.html`
- `chess-openings/index.html`
- `chess-puzzles/index.html`
- `how-to-play-chess/index.html`
- `3d-chess/index.html`
- `about/index.html`
- `play-chess-vs-computer/index.html`

### `play-chess-online/index.html`
HTML unchanged. Nav, footer, and `#seo-content` pick up new styles via CSS selectors.

---

## SEO Compliance

All changes comply with `SEO_RULES.md`:
- HTML structure preserved: `body.content-page-layout`, `nav#site-nav`, `main.content-page`, `footer#site-footer`
- `main.content-page > div.content-inner` wrapper kept on all pages including `index.html`
- All meta tags, canonical URLs, JSON-LD untouched
- All trailing slashes on internal links preserved
- No new pages added (no sitemap/robots changes needed)
- H1 retains animated gradient (`titleGradient` keyframe) per rule §4 — now in Orbitron font
- Glassmorphism on `.content-inner` satisfies §4 glassmorphism requirement
- `.content-inner` is retained as wrapper even on the landing page (`landing-hero-inner` is an additional class)
- No vite.config.ts changes needed

---

## Responsive Breakpoints

Two canonical breakpoints (replace/supersede existing `600px` breakpoint):
- **`≤768px`:** Nav hamburger collapse; mode grid 2 columns; content padding `40px 32px`
- **`≤480px`:** Mode grid 1 column; hero title fully clamp-driven; footer stacks vertically; content padding `24px 20px`

Existing `@media (max-width: 600px)` rules in `style.css` for content pages are **replaced** (not kept). Game-specific media queries are untouched.
