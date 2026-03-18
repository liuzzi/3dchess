#!/usr/bin/env bash
set -euo pipefail

PIECES=(pawn knight bishop rook queen king)
SRC_DIR="models"
OUT_DIR="public/models"

# LOD tiers: ratio = fraction of vertices to keep, error = max allowed error
HIGH_RATIO=0.5
HIGH_ERROR=0.01

MED_RATIO=0.2
MED_ERROR=0.02

LOW_RATIO=0.08
LOW_ERROR=0.05

mkdir -p "$OUT_DIR"

for piece in "${PIECES[@]}"; do
  src="$SRC_DIR/${piece}_simple.glb"
  if [ ! -f "$src" ]; then
    echo "SKIP: $src not found"
    continue
  fi

  echo "=== $piece ==="

  # Per-piece overrides for pieces whose geometry doesn't survive aggressive simplification
  p_high_ratio=$HIGH_RATIO; p_high_error=$HIGH_ERROR
  p_med_ratio=$MED_RATIO;   p_med_error=$MED_ERROR
  p_low_ratio=$LOW_RATIO;   p_low_error=$LOW_ERROR

  case $piece in
    pawn)
      p_high_ratio=1.0; p_high_error=0
      p_med_ratio=0.5;  p_med_error=0.001
      p_low_ratio=0.2;  p_low_error=0.005
      ;;
  esac

  for tier in high med low; do
    case $tier in
      high) ratio=$p_high_ratio; error=$p_high_error ;;
      med)  ratio=$p_med_ratio;  error=$p_med_error  ;;
      low)  ratio=$p_low_ratio;  error=$p_low_error  ;;
    esac

    out="$OUT_DIR/${piece}_${tier}.glb"
    echo "  $tier (ratio=$ratio, error=$error)"

    npx --yes @gltf-transform/cli weld "$src" /tmp/_welded.glb

    if [ "$ratio" = "1.0" ]; then
      npx --yes @gltf-transform/cli draco /tmp/_welded.glb "$out"
    else
      npx --yes @gltf-transform/cli simplify /tmp/_welded.glb /tmp/_simplified.glb \
        --ratio "$ratio" --error "$error"
      npx --yes @gltf-transform/cli draco /tmp/_simplified.glb "$out"
      rm -f /tmp/_simplified.glb
    fi

    rm -f /tmp/_welded.glb
  done

  echo ""
done

echo "Done. LOD models written to $OUT_DIR/"
