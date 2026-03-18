#!/usr/bin/env bash
set -euo pipefail

# Build a self-contained zip of chess3d for game portal submission.
# The zip contains a single index.html with relative asset paths,
# all JS/CSS bundles, and 3D model files — ready to embed in an iframe.
#
# Usage:
#   ./scripts/build-portal.sh
#   VITE_PARTYKIT_HOST=your-app.username.partykit.dev ./scripts/build-portal.sh
#
# Output: chess3d-portal.zip in the project root

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST="$PROJECT_ROOT/dist-portal"
ZIP_NAME="chess3d-portal.zip"

cd "$PROJECT_ROOT"

export VITE_PARTYKIT_HOST="${VITE_PARTYKIT_HOST:-3dchess.liuzzi.partykit.dev}"

# ── 1. TypeScript check ──────────────────────────────────────────────
echo "▸ Running TypeScript check..."
npx tsc --noEmit

# ── 2. Vite build with portal config ─────────────────────────────────
echo "▸ Building portal bundle..."
npx vite build --config vite.config.portal.ts

# ── 3. Flatten directory structure ────────────────────────────────────
# Vite outputs to dist-portal/play-chess-online/index.html
# Portal sites expect index.html at the zip root.
echo "▸ Restructuring output..."

if [ -f "$DIST/play-chess-online/index.html" ]; then
  mv "$DIST/play-chess-online/index.html" "$DIST/index.html"
  rmdir "$DIST/play-chess-online" 2>/dev/null || true
else
  echo "ERROR: Expected $DIST/play-chess-online/index.html not found"
  exit 1
fi

# Fix asset paths: the HTML was built expecting to be one directory deep,
# so paths like ../assets/ and ../style.css need to become ./assets/ and ./style.css
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' 's|\.\./|./|g' "$DIST/index.html"
else
  sed -i 's|\.\./|./|g' "$DIST/index.html"
fi

# ── 4. Strip site nav and footer (broken links in portal context) ─────
echo "▸ Cleaning HTML for portal embed..."

python3 - "$DIST/index.html" << 'PYEOF'
import sys, re

with open(sys.argv[1], 'r') as f:
    html = f.read()

# Remove <nav id="site-nav">...</nav>
html = re.sub(r'<nav id="site-nav">.*?</nav>\s*', '', html, flags=re.DOTALL)

# Remove <section id="seo-content">...</section>
html = re.sub(r'<section id="seo-content">.*?</section>\s*', '', html, flags=re.DOTALL)

# Remove <footer id="site-footer">...</footer>
html = re.sub(r'<footer id="site-footer">.*?</footer>\s*', '', html, flags=re.DOTALL)

# Remove manifest link (webmanifest is stripped from the zip)
html = re.sub(r'\s*<link rel="manifest"[^>]*/>\s*', '\n', html)

with open(sys.argv[1], 'w') as f:
    f.write(html)
PYEOF

# ── 5. Remove files unnecessary for portal embed ─────────────────────
rm -f "$DIST/robots.txt" "$DIST/sitemap.xml" "$DIST/site.webmanifest"

# ── 6. Create zip ────────────────────────────────────────────────────
echo "▸ Creating $ZIP_NAME..."
rm -f "$PROJECT_ROOT/$ZIP_NAME"
(cd "$DIST" && zip -r "$PROJECT_ROOT/$ZIP_NAME" .)

# ── 7. Summary ───────────────────────────────────────────────────────
ZIP_SIZE=$(du -h "$PROJECT_ROOT/$ZIP_NAME" | cut -f1)
echo ""
echo "✓ Portal build complete!"
echo "  Output: $ZIP_NAME ($ZIP_SIZE)"
echo "  Contents:"
(cd "$DIST" && find . -type f | sort | head -30)
FILE_COUNT=$(cd "$DIST" && find . -type f | wc -l)
if [ "$FILE_COUNT" -gt 30 ]; then
  echo "  ... and $((FILE_COUNT - 30)) more files"
fi
echo ""
  echo "  Multiplayer status:"
echo "    ✓ PartyKit lobby: $VITE_PARTYKIT_HOST"
echo "    ✓ PeerJS P2P: uses default cloud server (works from any origin)"
