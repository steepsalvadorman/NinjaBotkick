#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DaiBot — autorun.sh
# Uso: ./autorun.sh
# Instala dependencias faltantes, autentica con OAuth y arranca el bot.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colores ───────────────────────────────────────────────────────────────────
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[1;34m'; N='\033[0m'
ok()   { echo -e "${G}✓${N}  $*"; }
warn() { echo -e "${Y}⚠${N}  $*"; }
err()  { echo -e "${R}✗${N}  $*"; exit 1; }
info() { echo -e "${B}→${N}  $*"; }

# ── Cargar .env sin interpretar valores como bash ────────────────────────────
load_env() {
    local line key val
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
        [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || continue
        key="${line%%=*}"
        val="${line#*=}"
        # Quitar comillas envolventes si existen
        if [[ "$val" =~ ^\".*\"$ ]]; then val="${val:1:${#val}-2}"
        elif [[ "$val" =~ ^\'.*\'$ ]]; then val="${val:1:${#val}-2}"
        fi
        export "${key}=${val}"
    done < .env
}

# ── Función: refresh automático de token OAuth ────────────────────────────────
refresh_token_auto() {
    [ -z "${KICK_REFRESH_TOKEN:-}" ] && return 1
    [ -z "${KICK_CLIENT_ID:-}" ]     && return 1
    [ -z "${KICK_CLIENT_SECRET:-}" ] && return 1

    RESPONSE=$(curl -sS -X POST "https://id.kick.com/oauth/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        --data-urlencode "grant_type=refresh_token" \
        --data-urlencode "refresh_token=${KICK_REFRESH_TOKEN}" \
        --data-urlencode "client_id=${KICK_CLIENT_ID}" \
        --data-urlencode "client_secret=${KICK_CLIENT_SECRET}" \
        2>/dev/null) || return 1

    ACCESS=$(echo "$RESPONSE"    | grep -o '"access_token":"[^"]*"'  | cut -d'"' -f4)
    REFRESH=$(echo "$RESPONSE"   | grep -o '"refresh_token":"[^"]*"' | cut -d'"' -f4)
    EXPIRES_IN=$(echo "$RESPONSE"| grep -o '"expires_in":[0-9]*'     | cut -d':' -f2)
    [ -z "$ACCESS" ] && return 1

    NEW_EXPIRES=$(( $(date +%s) + ${EXPIRES_IN:-7200} ))
    sed -i "s|^KICK_ACCESS_TOKEN=.*|KICK_ACCESS_TOKEN=\"${ACCESS}\"|"    .env
    sed -i "s|^KICK_REFRESH_TOKEN=.*|KICK_REFRESH_TOKEN=\"${REFRESH}\"|" .env
    sed -i "s|^KICK_TOKEN_EXPIRES=.*|KICK_TOKEN_EXPIRES=\"${NEW_EXPIRES}\"|" .env
    KICK_ACCESS_TOKEN="$ACCESS"; KICK_REFRESH_TOKEN="$REFRESH"
    KICK_TOKEN_EXPIRES="$NEW_EXPIRES"
    return 0
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ── Evitar múltiples instancias ───────────────────────────────────────────────
LOCKFILE="/tmp/daibot.lock"
if [ -f "$LOCKFILE" ]; then
    OLDPID=$(cat "$LOCKFILE")
    if kill -0 "$OLDPID" 2>/dev/null; then
        err "DaiBot ya está corriendo (PID $OLDPID). Usa 'kill $OLDPID' para detenerlo."
    else
        warn "Lock obsoleto encontrado — limpiando..."
        rm -f "$LOCKFILE"
    fi
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT INT TERM

echo ""
echo -e "${G}╔══════════════════════════════════════╗${N}"
echo -e "${G}║        DaiBot — Autorun v2           ║${N}"
echo -e "${G}╚══════════════════════════════════════╝${N}"
echo ""

# ── 1. Verificar dependencias ─────────────────────────────────────────────────

info "Verificando dependencias..."

if ! command -v cargo &>/dev/null; then
    warn "Rust no encontrado — instalando via rustup..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
    # shellcheck source=/dev/null
    source "$HOME/.cargo/env"
fi
ok "Rust $(cargo --version 2>&1 | awk '{print $2}')"

if ! command -v node &>/dev/null; then
    echo ""
    err "Node.js no encontrado. Instálalo:
     Arch:   sudo pacman -S nodejs npm
     Ubuntu: sudo apt install nodejs npm
     macOS:  brew install node"
fi
ok "Node $(node --version)"

# ── 2. Preparar .env ──────────────────────────────────────────────────────────

if [ ! -f ".env" ]; then
    warn ".env no encontrado — creando desde .env.example"
    cp .env.example .env
    echo ""
    echo "  Edita .env y añade al menos:"
    echo "    KICK_CLIENT_ID=      (kick.com/settings/developer)"
    echo "    KICK_CLIENT_SECRET=  (kick.com/settings/developer)"
    echo ""
    err "Completa .env y vuelve a ejecutar ./autorun.sh"
fi

# Cargar .env en el entorno del script
load_env

# ── 3. Verificar credenciales OAuth ──────────────────────────────────────────

if [ -z "${KICK_CLIENT_ID:-}" ]; then
    echo ""
    err "KICK_CLIENT_ID no está en .env
  Regístrate en kick.com/settings/developer,
  crea una app y copia el Client ID y Secret en .env"
fi

# ── 4. Instalar dependencias npm del login ────────────────────────────────────

if [ ! -d "$ROOT/login/node_modules" ]; then
    info "Instalando dependencias npm de login/..."
    (cd "$ROOT/login" && npm install)
    ok "npm install completado"
fi

# ── 5. Autenticación OAuth (obtener/refrescar tokens) ─────────────────────────

needs_login=false

if [ -z "${KICK_ACCESS_TOKEN:-}" ]; then
    warn "Sin tokens OAuth — se necesita autenticación"
    needs_login=true
else
    # Verificar si el token expira en los próximos 10 minutos
    EXPIRES="${KICK_TOKEN_EXPIRES:-0}"
    NOW=$(date +%s)
    if [ "$EXPIRES" -gt 0 ] && [ "$NOW" -gt "$((EXPIRES - 600))" ]; then
        info "Token OAuth expirado o a punto de expirar — renovando..."
        # Intentar refresh automático primero
        if refresh_token_auto; then
            ok "Token renovado automáticamente"
        else
            warn "Refresh falló — iniciando login manual"
            needs_login=true
        fi
    else
        ok "Token OAuth válido (expira en $(( (EXPIRES - NOW) / 60 )) min)"
    fi
fi

if [ "$needs_login" = true ]; then
    echo ""
    info "Iniciando flujo de autenticación OAuth..."
    info "Se abrirá el navegador — autoriza DaiBot en Kick"
    echo ""
    node "$ROOT/login/login.js"
    # Recargar .env con los nuevos tokens
    load_env
    ok "Autenticación completada"
fi

# ── 6. Compilar backend Rust ──────────────────────────────────────────────────

info "Compilando backend Rust (solo si hay cambios)..."
cargo build --release --quiet --manifest-path "$ROOT/backend/Cargo.toml"
ok "Backend compilado"

# ── 7. Arrancar el bot ────────────────────────────────────────────────────────

echo ""
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo -e "  Overlay  → ${B}http://localhost:${PORT:-3000}/pixel.html${N}"
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo ""

while true; do
    (cd "$ROOT/backend" && ./target/release/daibot)
    warn "El bot se detuvo — reiniciando en 5s... (Ctrl+C para salir)"
    sleep 5
done
