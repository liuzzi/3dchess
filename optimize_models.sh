#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$ROOT_DIR/models"
OUTPUT_DIR="$ROOT_DIR/public/models"
TMP_DIR="$OUTPUT_DIR/.tmp_lod"

mkdir -p "$OUTPUT_DIR"
mkdir -p "$TMP_DIR"

pieces=(pawn knight bishop rook queen king)

echo "Generating LOD models from: $SOURCE_DIR"
echo "Writing optimized models to: $OUTPUT_DIR"

for piece in "${pieces[@]}"; do
  simple_src="$SOURCE_DIR/${piece}_simple.glb"
  base_src="$SOURCE_DIR/${piece}.glb"

  if [[ -f "$simple_src" ]]; then
    src="$simple_src"
  elif [[ -f "$base_src" ]]; then
    src="$base_src"
  else
    echo "Skipping $piece (no source model found)"
    continue
  fi

  echo ""
  echo "==> $piece"
  echo "Source: $src"

  high_out="$OUTPUT_DIR/${piece}_high.glb"
  med_tmp="$TMP_DIR/${piece}_med_tmp.glb"
  low_tmp="$TMP_DIR/${piece}_low_tmp.glb"
  med_out="$OUTPUT_DIR/${piece}_med.glb"
  low_out="$OUTPUT_DIR/${piece}_low.glb"

  # High: preserve detail, optimize/compress.
  npx @gltf-transform/cli optimize \
    "$src" "$high_out" \
    --compress draco

  # Medium: reduce geometry moderately, then optimize.
  npx @gltf-transform/cli simplify \
    "$src" "$med_tmp" \
    --ratio 0.55 \
    --error 0.0008
  npx @gltf-transform/cli optimize \
    "$med_tmp" "$med_out" \
    --compress draco

  # Low: aggressive simplification, then optimize.
  npx @gltf-transform/cli simplify \
    "$src" "$low_tmp" \
    --ratio 0.28 \
    --error 0.0025
  npx @gltf-transform/cli optimize \
    "$low_tmp" "$low_out" \
    --compress draco
done

rm -rf "$TMP_DIR"
echo ""
echo "LOD generation complete."
