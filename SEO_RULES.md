# chess<sup>3d</sup> SEO & Content Rules

This document outlines the strict SEO, routing, and design rules for `chess<sup>3d</sup>` (hosted at `chess3d.co`). Any AI or developer working on this codebase **must** adhere to these guidelines to maintain search engine rankings, routing integrity, and design consistency.

## 1. Multi-Page App (MPA) Routing Rules

The project uses Vite configured as a Multi-Page Application (MPA). 

*   **Directory Structure:** Every new page must be created as its own directory containing an `index.html` file (e.g., `new-page/index.html`).
*   **Vite Config:** Any new page **must** be explicitly added to `vite.config.ts` under `build.rollupOptions.input`. If it is not added here, it will not be built for production.
*   **Trailing Slashes:** All internal links **must** end with a trailing slash (e.g., `href="/chess-rules/"`). This is critical for Vite's dev server to correctly serve the `index.html` inside the directory without requiring a full page reload or causing 404s.

## 2. SEO & Metadata Requirements

Every single `index.html` file must contain a complete, fully populated `<head>` section. Do not omit any of these tags:

*   **Title:** Must follow the format: `Primary Keyword Phrase | chess<sup>3d</sup>` (e.g., `<title>Chess Puzzles – Test Your Chess Skills | chess³ᵈ</title>`).
*   **Meta Description:** Must be 120-155 characters, compelling, and include primary keywords.
*   **Canonical URL:** Must point to the absolute production URL (e.g., `<link rel="canonical" href="https://chess3d.co/chess-rules/" />`).
*   **Open Graph (OG) Tags:**
    *   `og:type` (usually "website")
    *   `og:title` (matches the page title, without the brand suffix if it gets too long)
    *   `og:description` (matches meta description)
    *   `og:url` (matches canonical)
    *   `og:image` (always `https://chess3d.co/images/og-chess-3d.png`)
    *   `og:site_name` ("chess³ᵈ")
*   **Twitter Cards:** Include `twitter:card`, `twitter:title`, `twitter:description`, and `twitter:image` (matching OG tags).
*   **JSON-LD:** The main game page (`/play-chess-online/`) uses `VideoGame` schema. Other pages should use appropriate schema if applicable, or inherit the site-wide `WebSite` schema.

## 3. Content Page Structure

All non-game content pages (rules, about, etc.) must follow a strict HTML structure to inherit the correct CSS:

```html
<body class="content-page-layout">
  <!-- 1. Shared Navigation -->
  <nav id="site-nav">...</nav>

  <!-- 2. Main Content Wrapper -->
  <main class="content-page">
    <div class="content-inner">
      <h1>Page Title</h1>
      <p>Intro text...</p>
      
      <h2>Section Title</h2>
      <p>Content...</p>

      <!-- 3. Primary Call to Action -->
      <div class="content-cta">
        <a class="cta-btn" href="/play-chess-online/">Play Chess Now</a>
      </div>

      <!-- 4. Internal "Learn Chess" Links (Required for SEO siloing) -->
      <div class="seo-links">
        <h3>Learn Chess</h3>
        <ul>...</ul>
      </div>
    </div>
  </main>

  <!-- 5. Shared Footer -->
  <footer id="site-footer">...</footer>
</body>
```

## 4. Design & Aesthetic Guidelines

The website must match the premium, modern, "glassmorphic" 3D aesthetic of the game itself. 

*   **Backgrounds:** Use the dark radial gradients and animated dot-matrix patterns defined in `style.css`. Do not use flat solid backgrounds for main containers.
*   **Glassmorphism:** Content containers (`.content-inner`), navbars, and footers should use semi-transparent dark backgrounds (e.g., `rgba(14, 14, 38, 0.6)`) with `backdrop-filter: blur(18px)` and subtle inner borders/shadows to create depth.
*   **Typography:** 
    *   `H1` tags should use the animated, multi-color gradient text effect (`titleGradient` animation in CSS).
    *   Text colors should be cool-toned (e.g., `#e0e4ff` for headings, `rgba(235, 239, 255, 0.85)` for body text). Do not use pure `#ffffff` for body text.
*   **Buttons & Cards:** Interactive elements must have a tactile, slightly skeuomorphic feel. Use gradient backgrounds, inner highlights (`inset 0 2px 4px rgba(255,255,255,0.2)`), and smooth transform/shadow transitions on hover.

## 5. Sitemaps and Robots

*   Whenever a new page is added, it **must** be added to `public/sitemap.xml` with an appropriate `<changefreq>` and `<priority>`.
*   `public/robots.txt` must always point to the absolute URL of the sitemap (`https://chess3d.co/sitemap.xml`).