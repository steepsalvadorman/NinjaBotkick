#!/usr/bin/env bash
# Genera comandos.png desde comandos.html con chromium headless a 2x resolución
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTML="file://$ROOT/comandos.html"
OUT="$ROOT/comandos.png"

chromium \
  --headless=new \
  --disable-gpu \
  --no-sandbox \
  --screenshot="$OUT" \
  --window-size=1920,1080 \
  --force-device-scale-factor=2 \
  --default-background-color=0e0e10 \
  "$HTML" 2>/dev/null

echo "✓ Imagen generada: $OUT"
echo "  Resolución real: ~3840×2160 px (2x scale)"
