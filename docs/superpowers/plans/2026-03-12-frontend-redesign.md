# Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign all content pages and the landing page with a cyber/grid aesthetic using the existing game color palette, maximizing Play Now conversion.

**Architecture:** Replace the content-page section of `public/style.css` (lines 2018–end) with new cyber-aesthetic CSS, then update `index.html` HTML markup to add a full-viewport hero section. All other content pages are CSS-only changes with no HTML modifications.

**Tech Stack:** Vite MPA, vanilla CSS, Google Fonts (Orbitron, Share Tech Mono, Rajdhani), TypeScript (unchanged)

---

## Chunk 1: CSS Redesign

### Task 1: Add Google Fonts import to top of style.css

**Files:**
- Modify: `public/style.css:1`

- [ ] **Step 1: Add `@import` as the very first line of `public/style.css`**

The file currently starts with `* { margin: 0; ... }`. Insert this as line 1 (before everything else):

```css
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Share+Tech+Mono&family=Rajdhani:wght@400;500;600;700&display=swap');
```

- [ ] **Step 2: Start dev server and verify fonts load**

```bash
npm run dev
```

Open `http://localhost:5173/chess-rules/` in a browser. Open DevTools → Network tab, filter by "fonts.googleapis" — verify the font request appears. The page will not visually change yet.

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "feat: add Google Fonts import for cyber redesign (Orbitron, Share Tech Mono, Rajdhani)"
```

---

### Task 2: Replace content page CSS section with full cyber redesign

**Files:**
- Modify: `public/style.css:2018–end`

Replace everything from line 2018 (the section comment before `#site-nav`) through the end of the file with the new CSS. The game CSS above line 2018 is untouched.

- [ ] **Step 1: Delete from line 2018 to end of file**

Line 2018 contains the comment `/* ─── Site navigation (shared) ─── */`. Remove from that line to the end of the file. The file should now end at line 2017 (last line of pure game CSS).

> Note: deleting from line 2018 (not 2019) ensures the orphaned section comment doesn't remain.

- [ ] **Step 2: Append the new content page CSS**

> This block includes new versions of all rules that were deleted (nav, footer, seo-content, .content-inner, etc.), with the cyber redesign applied. The bare `.seo-links` block is not re-added — it is replaced by the scoped `.content-inner .seo-links` rules below.

Add the following to the end of `public/style.css`:

```css

/* ══════════════════════════════════════════════════════
   CONTENT PAGE REDESIGN — cyber/grid aesthetic
   Requires: Google Fonts @import at top of file
   Do NOT modify game CSS above this line
   ══════════════════════════════════════════════════════ */

/* ─── CSS custom properties ─── */
:root {
  --cp-bg:          #0a0a1a;
  --cp-bg2:         #0d0d22;
  --cp-purple:      #7b8cff;
  --cp-violet:      #c084fc;
  --cp-pink:        #f472b6;
  --cp-blue:        #60a5fa;
  --cp-green:       #34d399;
  --cp-text:        #e9ebff;
  --cp-muted:       rgba(233, 235, 255, 0.45);
  --cp-edge:        rgba(123, 140, 255, 0.22);
  --cp-glow-purple: rgba(123, 140, 255, 0.4);
  --cp-glow-violet: rgba(192, 132, 252, 0.4);
  --cp-grid-color:  rgba(123, 140, 255, 0.07);
}

/* ─── Shared navigation ─── */
#site-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 250;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 48px;
  height: 64px;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  background: rgba(10, 10, 26, 0.8);
  border-bottom: 1px solid var(--cp-edge);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}

.site-nav-logo {
  font-family: 'Orbitron', monospace;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--cp-purple);
  text-decoration: none;
  text-transform: uppercase;
}

.site-nav-logo span {
  color: var(--cp-violet);
}

.site-nav-links {
  display: flex;
  gap: 4px;
  align-items: center;
}

.site-nav-links a {
  font-family: 'Share Tech Mono', monospace;
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--cp-muted);
  text-decoration: none;
  text-transform: uppercase;
  padding: 8px 14px;
  transition: color 0.2s, background 0.2s;
}

.site-nav-links a:hover,
.site-nav-links a.site-nav-active {
  color: var(--cp-purple);
  background: rgba(123, 140, 255, 0.08);
}

/* "Play Online" CTA link in nav */
.site-nav-links a[href="/play-chess-online/"] {
  font-family: 'Orbitron', monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--cp-bg);
  background: linear-gradient(90deg, var(--cp-purple), var(--cp-violet));
  clip-path: polygon(8px 0%, 100% 0%, calc(100% - 8px) 100%, 0% 100%);
  transition: filter 0.2s;
}

.site-nav-links a[href="/play-chess-online/"]:hover {
  filter: brightness(1.15);
  color: var(--cp-bg);
  background: linear-gradient(90deg, var(--cp-purple), var(--cp-violet));
}

#site-nav-toggle {
  display: none;
  background: rgba(123, 140, 255, 0.1);
  border: 1px solid var(--cp-edge);
  color: var(--cp-text);
  font-size: 18px;
  padding: 8px 12px;
  cursor: pointer;
}

/* Hide nav/footer/seo during gameplay */
body.game-active #site-nav,
body.game-active #seo-content,
body.game-active #site-footer {
  display: none;
}

/* ─── SEO content block (game page only) ─── */
#seo-content {
  padding: 64px 20px 48px;
  position: relative;
  z-index: 1;
}

#seo-content::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: radial-gradient(ellipse at top center, #141433 0%, #0a0a1a 72%);
  z-index: -1;
}

.seo-content-inner {
  max-width: 760px;
  margin: 0 auto;
  background: rgba(13, 13, 34, 0.75);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid var(--cp-edge);
  padding: 40px 48px;
}

#seo-content h2 {
  font-family: 'Rajdhani', sans-serif;
  font-size: 22px;
  font-weight: 700;
  margin-top: 40px;
  margin-bottom: 16px;
  color: var(--cp-text);
  letter-spacing: 1px;
  border-left: 3px solid var(--cp-purple);
  padding-left: 12px;
}

#seo-content h2:first-child {
  margin-top: 0;
}

#seo-content p {
  font-family: 'Rajdhani', sans-serif;
  font-size: 16px;
  line-height: 1.8;
  margin-bottom: 20px;
  color: var(--cp-muted);
}

/* Game page .seo-links — scoped separately, untouched aesthetic kept */
#seo-content .seo-links {
  margin-top: 48px;
  padding-top: 32px;
  border-top: 1px solid var(--cp-edge);
}

#seo-content .seo-links h3 {
  font-family: 'Share Tech Mono', monospace;
  font-size: 11px;
  letter-spacing: 4px;
  text-transform: uppercase;
  margin-bottom: 16px;
  color: var(--cp-purple);
}

#seo-content .seo-links ul {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

#seo-content .seo-links li {
  margin-bottom: 0;
}

#seo-content .seo-links a {
  display: block;
  padding: 12px 16px;
  background: rgba(123, 140, 255, 0.06);
  border: 1px solid var(--cp-edge);
  color: var(--cp-muted);
  text-decoration: none;
  font-family: 'Rajdhani', sans-serif;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.2s, border-color 0.2s, color 0.2s;
}

#seo-content .seo-links a:hover {
  background: rgba(123, 140, 255, 0.12);
  border-color: var(--cp-purple);
  color: var(--cp-text);
}

/* ─── Site footer (shared) ─── */
#site-footer {
  padding: 28px 48px;
  background: rgba(10, 10, 26, 0.7);
  border-top: 1px solid var(--cp-edge);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  position: relative;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}

.footer-inner {
  display: contents;
}

.footer-links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 4px;
  align-items: center;
}

.footer-links a {
  font-family: 'Share Tech Mono', monospace;
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--cp-muted);
  text-decoration: none;
  padding: 4px 8px;
  transition: color 0.2s;
}

.footer-links a:hover {
  color: var(--cp-purple);
}

.footer-copy {
  font-family: 'Share Tech Mono', monospace;
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: rgba(233, 235, 255, 0.2);
}

/* ─── CTA button (content pages) ─── */
.content-cta {
  margin: 48px 0;
  text-align: center;
}

.cta-btn {
  display: inline-block;
  font-family: 'Orbitron', monospace;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: var(--cp-bg);
  background: linear-gradient(90deg, var(--cp-purple), var(--cp-violet));
  padding: 14px 48px;
  text-decoration: none;
  clip-path: polygon(12px 0%, 100% 0%, calc(100% - 12px) 100%, 0% 100%);
  box-shadow: 0 0 30px var(--cp-glow-purple);
  transition: filter 0.2s, transform 0.2s, box-shadow 0.2s;
}

.cta-btn:hover {
  filter: brightness(1.15);
  transform: translateY(-2px);
  box-shadow: 0 0 50px var(--cp-glow-purple);
}

/* ─── Responsive nav collapse (≤768px) ─── */
@media (max-width: 768px) {
  #site-nav {
    padding: 0 20px;
  }

  #site-nav-toggle {
    display: block;
  }

  .site-nav-links {
    position: absolute;
    top: 64px;
    left: 0;
    right: 0;
    flex-direction: column;
    padding: 16px;
    background: rgba(10, 10, 26, 0.97);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--cp-edge);
    display: none;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    z-index: 300;
  }

  .site-nav-links a {
    width: 100%;
    text-align: center;
    padding: 14px;
  }

  /* Reset angled clip-path in mobile nav */
  .site-nav-links a[href="/play-chess-online/"] {
    clip-path: none;
    border-radius: 4px;
  }

  .site-nav-links.is-open {
    display: flex;
  }
}

/* ─── Content page layout ─── */
body.content-page-layout {
  /* IMPORTANT: overrides global `html, body { overflow: hidden }` required by game */
  overflow: auto;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--cp-bg);
  color: var(--cp-text);
}

/* Grid lines background */
body.content-page-layout::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image:
    linear-gradient(var(--cp-grid-color) 1px, transparent 1px),
    linear-gradient(90deg, var(--cp-grid-color) 1px, transparent 1px);
  background-size: 40px 40px;
}

/* Radial glow overlays */
body.content-page-layout::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 80% 60% at 50% 0%, rgba(123, 140, 255, 0.09) 0%, transparent 70%),
    radial-gradient(ellipse 60% 40% at 80% 100%, rgba(192, 132, 252, 0.07) 0%, transparent 70%);
}

body.content-page-layout #site-nav {
  position: sticky;
}

body.content-page-layout #site-footer {
  margin-top: auto;
}

body.content-page-layout main.content-page {
  flex: 1;
  padding: 80px 20px 64px;
  position: relative;
  z-index: 1;
}

/* Scanline animation on landing page only — decorative, graceful degradation on :has() unsupported */
body.content-page-layout:has(.landing-hero-inner) main.content-page::before {
  content: '';
  position: fixed;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--cp-purple), transparent);
  opacity: 0;
  animation: cpScanline 4s ease-in-out infinite;
  pointer-events: none;
  z-index: 2;
}

@keyframes cpScanline {
  0%   { top: 0%;   opacity: 0;   }
  5%   { opacity: 0.25; }
  95%  { opacity: 0.25; }
  100% { top: 100%; opacity: 0;   }
}

/* ─── Content inner (glassmorphic card) ─── */
.content-inner {
  max-width: 860px;
  margin: 0 auto;
  background: rgba(13, 13, 34, 0.75);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid var(--cp-edge);
  padding: 60px 56px;
}

/* Landing page: transparent, full-width — keeps div.content-inner in DOM for SEO rule compliance */
.landing-hero-inner {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border: none;
  padding: 0;
  max-width: 1100px;
}

/* ─── Typography (content pages) ─── */
.content-inner h1 {
  font-family: 'Orbitron', monospace;
  font-size: clamp(28px, 5vw, 48px);
  font-weight: 700;
  letter-spacing: 2px;
  margin-bottom: 24px;
  background: linear-gradient(270deg, var(--cp-purple), var(--cp-violet), var(--cp-pink), var(--cp-purple));
  background-size: 300% 300%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: titleGradient 6s ease infinite;
  filter: drop-shadow(0 2px 16px var(--cp-glow-purple));
}

.content-inner h2 {
  font-family: 'Rajdhani', sans-serif;
  font-size: 22px;
  font-weight: 700;
  margin-top: 40px;
  margin-bottom: 16px;
  color: var(--cp-text);
  letter-spacing: 1px;
  border-left: 3px solid var(--cp-purple);
  padding-left: 12px;
}

.content-inner h3 {
  font-family: 'Rajdhani', sans-serif;
  font-size: 17px;
  font-weight: 600;
  margin-top: 28px;
  margin-bottom: 10px;
  color: var(--cp-purple);
}

.content-inner p {
  font-family: 'Rajdhani', sans-serif;
  font-size: 16px;
  font-weight: 400;
  line-height: 1.8;
  margin-bottom: 20px;
  color: var(--cp-muted);
}

.content-inner strong {
  color: var(--cp-text);
  font-weight: 600;
}

/* ─── SEO links (content pages — scoped to .content-inner) ─── */
.content-inner .seo-links {
  margin-top: 48px;
  border-left: 2px solid var(--cp-edge);
  padding-left: 24px;
}

.content-inner .seo-links h3 {
  font-family: 'Share Tech Mono', monospace;
  font-size: 11px;
  letter-spacing: 4px;
  text-transform: uppercase;
  color: var(--cp-purple);
  margin-bottom: 16px;
}

.content-inner .seo-links h3::before {
  content: '// ';
  opacity: 0.6;
}

.content-inner .seo-links ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.content-inner .seo-links li {
  margin-bottom: 0;
}

.content-inner .seo-links a {
  font-family: 'Rajdhani', sans-serif;
  font-size: 15px;
  font-weight: 500;
  color: var(--cp-muted);
  text-decoration: none;
  transition: color 0.2s;
}

.content-inner .seo-links a:hover {
  color: var(--cp-purple);
  text-decoration: underline;
}

/* ─── Landing page hero ─── */
.landing-hero {
  min-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 60px 40px 40px;
  position: relative;
  overflow: hidden;
}

.landing-hero-glyph {
  position: absolute;
  font-size: clamp(300px, 50vw, 580px);
  opacity: 0.025;
  color: var(--cp-purple);
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  user-select: none;
  line-height: 1;
  z-index: 0;
}

.landing-eyebrow {
  position: relative;
  z-index: 1;
  font-family: 'Share Tech Mono', monospace;
  font-size: 11px;
  letter-spacing: 6px;
  color: var(--cp-purple);
  text-transform: uppercase;
  margin-bottom: 20px;
  opacity: 0.8;
  display: flex;
  align-items: center;
  gap: 12px;
}

.landing-eyebrow::before,
.landing-eyebrow::after {
  content: '';
  display: inline-block;
  width: 28px;
  height: 1px;
  background: var(--cp-purple);
  opacity: 0.5;
}

.landing-title {
  position: relative;
  z-index: 1;
  font-family: 'Orbitron', monospace;
  font-size: clamp(52px, 9vw, 110px);
  font-weight: 900;
  line-height: 0.88;
  letter-spacing: -2px;
  margin-bottom: 12px;
}

.landing-title .t-filled {
  display: block;
  background: linear-gradient(270deg, var(--cp-purple), var(--cp-violet), var(--cp-pink), var(--cp-purple));
  background-size: 300% 300%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: titleGradient 6s ease infinite;
  filter: drop-shadow(0 0 32px var(--cp-glow-purple));
}

.landing-title .t-outline {
  display: block;
  color: transparent;
  -webkit-text-stroke: 1.5px rgba(123, 140, 255, 0.45);
  font-size: clamp(44px, 7.5vw, 90px);
}

.landing-subtitle {
  position: relative;
  z-index: 1;
  font-family: 'Rajdhani', sans-serif;
  font-size: 16px;
  font-weight: 500;
  letter-spacing: 2px;
  color: var(--cp-muted);
  margin-top: 20px;
  margin-bottom: 44px;
  max-width: 480px;
}

.landing-cta-group {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  justify-content: center;
}

.landing-btn-primary {
  font-family: 'Orbitron', monospace;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: var(--cp-bg);
  background: linear-gradient(90deg, var(--cp-purple), var(--cp-violet));
  padding: 16px 52px;
  text-decoration: none;
  clip-path: polygon(12px 0%, 100% 0%, calc(100% - 12px) 100%, 0% 100%);
  box-shadow: 0 0 40px var(--cp-glow-purple), 0 0 80px rgba(123, 140, 255, 0.15);
  transition: filter 0.2s, transform 0.2s;
  display: inline-block;
}

.landing-btn-primary:hover {
  filter: brightness(1.15);
  transform: translateY(-2px);
}

.landing-btn-secondary {
  font-family: 'Share Tech Mono', monospace;
  font-size: 11px;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: var(--cp-purple);
  text-decoration: none;
  border: 1px solid var(--cp-edge);
  padding: 15px 32px;
  background: rgba(123, 140, 255, 0.04);
  clip-path: polygon(8px 0%, 100% 0%, calc(100% - 8px) 100%, 0% 100%);
  transition: background 0.2s, border-color 0.2s;
  display: inline-block;
}

.landing-btn-secondary:hover {
  background: rgba(123, 140, 255, 0.1);
  border-color: var(--cp-purple);
}

.landing-badges {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 24px;
  margin-top: 44px;
  flex-wrap: wrap;
  justify-content: center;
}

.landing-badge {
  font-family: 'Share Tech Mono', monospace;
  font-size: 10px;
  letter-spacing: 3px;
  color: var(--cp-muted);
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 6px;
}

.landing-badge::before {
  content: '';
  width: 4px;
  height: 4px;
  background: var(--cp-green);
  border-radius: 50%;
  box-shadow: 0 0 6px var(--cp-green);
  flex-shrink: 0;
}

/* ─── Mode grid (landing page) ─── */
.mode-section-label {
  font-family: 'Share Tech Mono', monospace;
  font-size: 10px;
  letter-spacing: 6px;
  color: var(--cp-purple);
  text-transform: uppercase;
  margin-bottom: 32px;
  opacity: 0.7;
  text-align: center;
}

.mode-section-label::before {
  content: '// ';
}

.mode-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--cp-edge);
  border: 1px solid var(--cp-edge);
  margin-bottom: 80px;
}

.mode-card {
  background: var(--cp-bg2);
  padding: 40px 32px;
  text-decoration: none;
  color: inherit;
  display: block;
  position: relative;
  overflow: hidden;
  transition: background 0.25s;
}

.mode-card:hover {
  background: rgba(123, 140, 255, 0.06);
}

.mode-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--cp-purple), var(--cp-violet));
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.3s ease;
}

.mode-card:hover::before {
  transform: scaleX(1);
}

.mode-card-glyph {
  font-size: 36px;
  margin-bottom: 20px;
  opacity: 0.5;
  display: block;
}

.mode-card-num {
  font-family: 'Share Tech Mono', monospace;
  font-size: 10px;
  letter-spacing: 4px;
  color: var(--cp-purple);
  opacity: 0.5;
  margin-bottom: 10px;
  display: block;
}

.mode-card-title {
  font-family: 'Orbitron', monospace;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--cp-text);
  margin-bottom: 12px;
}

.mode-card-desc {
  font-family: 'Rajdhani', sans-serif;
  font-size: 14px;
  font-weight: 400;
  color: var(--cp-muted);
  line-height: 1.6;
}

.mode-card-arrow {
  position: absolute;
  bottom: 28px;
  right: 28px;
  font-size: 18px;
  color: var(--cp-purple);
  opacity: 0;
  transition: opacity 0.25s, transform 0.25s;
}

.mode-card:hover .mode-card-arrow {
  opacity: 1;
  transform: translate(4px, -4px);
}

/* ─── SEO text block below mode grid (landing page) ─── */
.landing-seo-block {
  padding: 0 20px 60px;
}

.landing-seo-block h2 {
  font-family: 'Rajdhani', sans-serif;
  font-size: 22px;
  font-weight: 700;
  margin-top: 40px;
  margin-bottom: 14px;
  color: var(--cp-text);
  letter-spacing: 1px;
  border-left: 3px solid var(--cp-purple);
  padding-left: 12px;
}

.landing-seo-block p {
  font-family: 'Rajdhani', sans-serif;
  font-size: 16px;
  line-height: 1.8;
  margin-bottom: 20px;
  color: var(--cp-muted);
}

.landing-seo-block strong {
  color: var(--cp-text);
  font-weight: 600;
}

/* ─── Responsive (≤768px) ─── */
@media (max-width: 768px) {
  body.content-page-layout main.content-page {
    padding: 72px 16px 40px;
  }

  .content-inner {
    padding: 40px 28px;
  }

  .landing-hero {
    padding: 40px 24px 32px;
    min-height: calc(100vh - 64px);
  }

  .mode-grid {
    grid-template-columns: 1fr 1fr;
  }

  #site-footer {
    padding: 24px 20px;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
}

/* ─── Responsive (≤480px) ─── */
@media (max-width: 480px) {
  .content-inner {
    padding: 28px 20px;
  }

  .mode-grid {
    grid-template-columns: 1fr;
  }

  .landing-badges {
    gap: 14px;
  }

  .landing-cta-group {
    flex-direction: column;
    width: 100%;
  }

  .landing-btn-primary,
  .landing-btn-secondary {
    width: 100%;
    text-align: center;
    clip-path: none;
  }
}
```

- [ ] **Step 3: Start dev server and do a visual smoke test**

```bash
npm run dev
```

Check each of these URLs and verify:
- `http://localhost:5173/chess-rules/` — Orbitron H1 with gradient, Rajdhani body text, left-border H2, cyber nav
- `http://localhost:5173/chess-openings/` — same aesthetic, content intact
- `http://localhost:5173/chess-puzzles/` — same
- `http://localhost:5173/how-to-play-chess/` — same
- `http://localhost:5173/3d-chess/` — same
- `http://localhost:5173/about/` — same
- `http://localhost:5173/play-chess-vs-computer/` — same
- `http://localhost:5173/play-chess-online/` — game still loads, menu screen intact, nav/footer updated

Verify game page: click a mode (e.g., "vs Bot"), game should load normally. No visual regressions in 3D board or menu.

- [ ] **Step 4: Run build to confirm no errors**

```bash
npm run build
```

Expected: exits 0, `dist/` generated.

- [ ] **Step 5: Commit**

```bash
git add public/style.css
git commit -m "feat: redesign content page CSS with cyber/grid aesthetic

- New Orbitron/Rajdhani/ShareTechMono typography
- Grid background with purple glow overlays
- Cyber nav with angled Play Now CTA
- Glassmorphic content-inner, left-border H2
- Scoped .content-inner .seo-links, removed bare .seo-links
- Scanline animation on landing page via :has()
- Mode grid and landing hero CSS
- Responsive breakpoints at 768px and 480px"
```

---

## Chunk 2: Landing Page HTML

### Task 4: Update index.html with hero section markup

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Replace the `<main>` body content in `index.html`**

Find this entire block (inside `<main class="content-page">`):
```html
  <main class="content-page">
    <div class="content-inner">
      <h1>3D Chess Online</h1>
      <p>Welcome to <strong>3DChess.org</strong> &mdash; a free, browser-based chess game reimagined in three dimensions. No downloads, no sign-ups. Just pick a mode and start playing.</p>

      <div class="landing-cards">
        <a href="/play-chess-online/" class="landing-card">
          <h2>Play Chess Online</h2>
          <p>Jump straight into a game. Play locally, challenge the AI, or find an online opponent.</p>
        </a>
        <a href="/play-chess-vs-computer/" class="landing-card">
          <h2>Play vs Computer</h2>
          <p>Test your skills against our chess AI with Easy, Medium, and Hard difficulty levels.</p>
        </a>
        <a href="/3d-chess/" class="landing-card">
          <h2>3D Chess Experience</h2>
          <p>Discover chess on a fully interactive 3D board with stunning visuals and smooth animations.</p>
        </a>
      </div>

      <h2>Free Chess in Your Browser</h2>
      <p>3DChess.org brings chess to life with a beautiful 8&times;8&times;8 three-dimensional board. Rotate the board, zoom in on pieces, and experience every move in immersive 3D. Whether you want a quick game against the computer or an online match against a friend, everything runs right in your browser.</p>

      <h2>Multiple Ways to Play</h2>
      <p><strong>Play vs AI:</strong> Challenge our chess engine at three difficulty levels. Easy mode is great for beginners, while Hard mode provides a serious challenge for experienced players.</p>
      <p><strong>Online Multiplayer:</strong> Create a game and wait for challengers, or join an existing match. No account needed &mdash; anonymous play is fully supported.</p>
      <p><strong>Local Two-Player:</strong> Play chess with a friend on the same device. Perfect for casual games.</p>

      <div class="seo-links">
        <h3>Learn Chess</h3>
        <ul>
          <li><a href="/chess-rules/">Chess Rules &mdash; Complete Guide</a></li>
          <li><a href="/how-to-play-chess/">How to Play Chess &mdash; Beginner's Guide</a></li>
          <li><a href="/chess-openings/">Chess Openings &mdash; Best Openings for Beginners</a></li>
          <li><a href="/chess-puzzles/">Chess Puzzles &mdash; Test Your Skills</a></li>
        </ul>
      </div>
    </div>
  </main>
```

Replace with:
```html
  <main class="content-page">
    <div class="content-inner landing-hero-inner">

      <!-- Hero section -->
      <div class="landing-hero">
        <div class="landing-hero-glyph" aria-hidden="true">♛</div>
        <div class="landing-eyebrow">Free · No Download · No Signup</div>
        <h1 class="landing-title">
          <span class="t-filled">3D Chess</span>
          <span class="t-outline">Online</span>
        </h1>
        <p class="landing-subtitle">Chess reimagined in three dimensions. Rotate, zoom, dominate.</p>
        <div class="landing-cta-group">
          <a href="/play-chess-online/" class="landing-btn-primary">Play Now</a>
          <a href="/play-chess-vs-computer/" class="landing-btn-secondary">vs Computer</a>
        </div>
        <div class="landing-badges">
          <span class="landing-badge">Free forever</span>
          <span class="landing-badge">No signup required</span>
          <span class="landing-badge">Runs in browser</span>
          <span class="landing-badge">3D interactive board</span>
        </div>
      </div>

      <!-- Mode cards -->
      <div class="mode-section-label">Choose your game mode</div>
      <div class="mode-grid">
        <a href="/play-chess-online/" class="mode-card">
          <span class="mode-card-glyph" aria-hidden="true">⚔️</span>
          <span class="mode-card-num">01</span>
          <div class="mode-card-title">Play Online</div>
          <p class="mode-card-desc">Challenge real opponents worldwide. Anonymous play, no account needed.</p>
          <span class="mode-card-arrow" aria-hidden="true">↗</span>
        </a>
        <a href="/play-chess-vs-computer/" class="mode-card">
          <span class="mode-card-glyph" aria-hidden="true">🤖</span>
          <span class="mode-card-num">02</span>
          <div class="mode-card-title">vs Computer</div>
          <p class="mode-card-desc">Three AI difficulty levels. From beginner-friendly to genuinely hard.</p>
          <span class="mode-card-arrow" aria-hidden="true">↗</span>
        </a>
        <a href="/3d-chess/" class="mode-card">
          <span class="mode-card-glyph" aria-hidden="true">♟</span>
          <span class="mode-card-num">03</span>
          <div class="mode-card-title">3D Experience</div>
          <p class="mode-card-desc">The full 3D chess board. Rotate freely, zoom in, feel every move.</p>
          <span class="mode-card-arrow" aria-hidden="true">↗</span>
        </a>
      </div>

      <!-- SEO text content (kept for search rankings) -->
      <div class="landing-seo-block">
        <h2>Free Chess in Your Browser</h2>
        <p>3DChess.org brings chess to life with a beautiful 8&times;8&times;8 three-dimensional board. Rotate the board, zoom in on pieces, and experience every move in immersive 3D. Whether you want a quick game against the computer or an online match against a friend, everything runs right in your browser.</p>

        <h2>Multiple Ways to Play</h2>
        <p><strong>Play vs AI:</strong> Challenge our chess engine at three difficulty levels. Easy mode is great for beginners, while Hard mode provides a serious challenge for experienced players.</p>
        <p><strong>Online Multiplayer:</strong> Create a game and wait for challengers, or join an existing match. No account needed &mdash; anonymous play is fully supported.</p>
        <p><strong>Local Two-Player:</strong> Play chess with a friend on the same device. Perfect for casual games.</p>

        <div class="seo-links">
          <h3>Learn Chess</h3>
          <ul>
            <li><a href="/chess-rules/">Chess Rules &mdash; Complete Guide</a></li>
            <li><a href="/how-to-play-chess/">How to Play Chess &mdash; Beginner's Guide</a></li>
            <li><a href="/chess-openings/">Chess Openings &mdash; Best Openings for Beginners</a></li>
            <li><a href="/chess-puzzles/">Chess Puzzles &mdash; Test Your Skills</a></li>
          </ul>
        </div>
      </div>

    </div>
  </main>
```

- [ ] **Step 2: Verify dev server renders the landing page correctly**

```bash
npm run dev
```

Open `http://localhost:5173/` and check:
- Full-viewport hero with giant gradient "3D Chess" title visible above fold
- Scanline animation sweeping down the page (if browser supports `:has()`)
- Ghost queen glyph faintly visible behind title
- "Play Now" angled button prominent; "vs Computer" outline button beside it
- 4 green-dot badges below CTAs
- Mode grid (3 cards) visible below hero on scroll
- SEO text sections below mode grid
- Nav with Orbitron logo, mono links, purple gradient "Play Online" CTA
- Footer with mono text

- [ ] **Step 3: Run full build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: redesign landing page with full-viewport hero and mode grid

- Cyber hero: Orbitron title, gradient animation, scanline, ghost glyph
- Primary Play Now CTA + secondary vs Computer
- Mode grid replacing landing-cards
- SEO text preserved in landing-seo-block below fold"
```
