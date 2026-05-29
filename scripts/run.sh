#!/usr/bin/env bash
# NinjaBotkick — Script de arranque (Linux/macOS)
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║          NinjaBotkick — Launcher             ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Verificar .env ────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo "⚠  No se encontró .env — copiando .env.example..."
  cp .env.example .env
  echo "✏  Edita .env con tus datos antes de continuar."
  exit 1
fi

if ! grep -q "COOKIES=" .env || grep -q "COOKIES=$" .env; then
  echo "⚠  COOKIES no configuradas. Ejecuta primero:"
  echo "    cd login && npm install && node login.js"
  exit 1
fi

# ── Python TTS server ─────────────────────────────────────────────────────────
if command -v python3 &>/dev/null; then
  echo "🎤  Iniciando servidor TTS (Python)..."
  cd tts-server
  if [ ! -d ".venv" ]; then
    python3 -m venv .venv
  fi
  source .venv/bin/activate
  pip install -q -r requirements.txt
  python3 tts_server.py &
  TTS_PID=$!
  cd "$ROOT"
  echo "    PID=$TTS_PID — esperando 3s..."
  sleep 3
else
  echo "⚠  Python3 no encontrado — TTS de alta calidad deshabilitado"
fi

# ── Rust backend ──────────────────────────────────────────────────────────────
echo "🦀  Compilando y ejecutando backend Rust..."
cd backend

if ! command -v cargo &>/dev/null; then
  echo "❌ Cargo (Rust) no encontrado. Instala desde https://rustup.rs"
  exit 1
fi

cargo run --release

# Limpiar TTS server al salir
if [ -n "$TTS_PID" ]; then
  kill "$TTS_PID" 2>/dev/null || true
fi
