"""
CuloconKKRix — Servidor de Voz Pro (Edge TTS)
Genera audio de alta calidad usando las voces neurales de Microsoft Edge.
Preparado para extensión con modelos RVC/Applio en custom_voices/.
"""

import edge_tts
import base64
import hashlib
import socket
import os
from pathlib import Path
from fastapi import FastAPI, Body
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware


# ─── Configuración ────────────────────────────────────────────────────────────

PORT = 5000
CACHE_DIR = Path("tts_cache")
CACHE_DIR.mkdir(exist_ok=True)

CUSTOM_VOICES_DIR = Path("custom_voices")
CUSTOM_VOICES_DIR.mkdir(exist_ok=True)

# Voces Edge TTS disponibles
EDGE_VOICES = {
    "dalia":  "es-MX-DaliaNeural",    # Femenina mexicana (por defecto)
    "jorge":  "es-MX-JorgeNeural",    # Masculino mexicano
    "camila": "es-PE-CamilaNeural",   # Femenina peruana
    "alex":   "es-PE-AlexNeural",     # Masculino peruano
}

DEFAULT_VOICE = "dalia"


# ─── FastAPI App ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="CuloconKKRix TTS Server",
    description="Servidor local de Text-to-Speech para el overlay de Kick",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/voices")
async def list_voices():
    """Devuelve las voces disponibles (Edge TTS + custom)."""
    voices = []

    # Voces Edge TTS
    for shortname, full_id in EDGE_VOICES.items():
        voices.append({
            "id": shortname,
            "name": full_id,
            "type": "edge-tts",
        })

    # Voces custom (archivos .pth en custom_voices/)
    for file in CUSTOM_VOICES_DIR.glob("*.pth"):
        voices.append({
            "id": file.stem.lower(),
            "name": file.stem,
            "type": "custom-rvc",
        })

    return {"voices": voices, "default": DEFAULT_VOICE}


@app.post("/tts")
async def generate_tts(data: dict = Body(...)):
    """
    Genera audio TTS a partir de texto.

    Body JSON:
        text (str):  Texto a sintetizar (requerido)
        voice (str): ID de la voz. Por defecto "dalia".
    """
    text = data.get("text", "").strip()
    voice_id = data.get("voice", DEFAULT_VOICE).lower().strip()

    if not text:
        return JSONResponse(
            status_code=400,
            content={"error": "El campo 'text' es requerido."},
        )

    # Verificar que la voz existe
    if voice_id not in EDGE_VOICES:
        return JSONResponse(
            status_code=400,
            content={
                "error": f"Voz '{voice_id}' no encontrada.",
                "available": list(EDGE_VOICES.keys()),
            },
        )

    # Revisar caché
    cache_key = hashlib.md5(f"{voice_id}:{text}".encode()).hexdigest()
    cache_file = CACHE_DIR / f"{cache_key}.mp3"

    if cache_file.exists():
        audio_b64 = base64.b64encode(cache_file.read_bytes()).decode("utf-8")
        return {"audioBase64": audio_b64, "cached": True, "voice": voice_id}

    # Generar con Edge TTS
    try:
        edge_voice = EDGE_VOICES[voice_id]
        communicate = edge_tts.Communicate(text, edge_voice)
        audio_data = b""

        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data += chunk["data"]

        if not audio_data:
            return JSONResponse(
                status_code=500,
                content={"error": "No se generó audio. Intenta de nuevo."},
            )

        # Guardar en caché
        cache_file.write_bytes(audio_data)

        audio_b64 = base64.b64encode(audio_data).decode("utf-8")
        return {"audioBase64": audio_b64, "cached": False, "voice": voice_id}

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": f"Error al generar TTS: {str(e)}"},
        )


@app.get("/health")
async def health_check():
    """Verificación rápida de que el servidor está vivo."""
    return {"status": "ok", "service": "CuloconKKRix TTS Server v2.0"}


@app.get("/test", response_class=HTMLResponse)
async def test_page():
    """Página de pruebas con visualizador de barras de audio."""
    return """
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>TTS Test — CuloconKKRix</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', sans-serif;
    background: #0a0a0a;
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px 20px;
    min-height: 100vh;
  }
  h1 {
    font-size: 1.6rem;
    margin-bottom: 8px;
    color: #53fc18;
    text-shadow: 0 0 12px rgba(83,252,24,0.4);
  }
  .subtitle { color: #888; font-size: 0.85rem; margin-bottom: 30px; }
  .card {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 16px;
    padding: 24px;
    width: 100%;
    max-width: 520px;
    margin-bottom: 20px;
    backdrop-filter: blur(10px);
  }
  label { display: block; font-size: 0.8rem; color: #aaa; margin-bottom: 6px; }
  textarea, select {
    width: 100%;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(0,0,0,0.4);
    color: #fff;
    font-size: 0.95rem;
    resize: vertical;
  }
  textarea:focus, select:focus { outline: none; border-color: #53fc18; }
  select { margin-bottom: 16px; cursor: pointer; }
  textarea { min-height: 80px; margin-bottom: 16px; }
  button {
    width: 100%;
    padding: 12px;
    border: none;
    border-radius: 10px;
    background: linear-gradient(135deg, #53fc18, #3ad410);
    color: #000;
    font-weight: 700;
    font-size: 1rem;
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s;
  }
  button:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(83,252,24,0.4); }
  button:active { transform: scale(0.97); }
  button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  #status {
    margin-top: 12px;
    font-size: 0.85rem;
    text-align: center;
    min-height: 20px;
  }
  .ok { color: #53fc18; }
  .err { color: #ff5555; }
  .loading { color: #ffd866; }
  canvas {
    width: 100%;
    height: 60px;
    border-radius: 8px;
    background: rgba(0,0,0,0.3);
  }
  .vis-label {
    font-size: 0.75rem;
    color: #666;
    text-align: center;
    margin-top: 6px;
  }
</style>
</head>
<body>
  <h1>🎤 CuloconKKRix — Test TTS</h1>
  <p class="subtitle">Prueba las voces y verifica las barras de audio</p>

  <div class="card">
    <label>Voz</label>
    <select id="voice">
      <option value="dalia">Dalia (es-MX, femenina)</option>
      <option value="jorge">Jorge (es-MX, masculino)</option>
      <option value="camila">Camila (es-PE, femenina)</option>
      <option value="alex">Alex (es-PE, masculino)</option>
    </select>
    <label>Texto</label>
    <textarea id="text">Hola, soy CuloconKKRix y las barras de sonido están funcionando perfectamente.</textarea>
    <button id="btn" onclick="testTTS()">▶ Generar y Reproducir</button>
    <div id="status"></div>
  </div>

  <div class="card">
    <label>Visualizador de Audio (barras)</label>
    <canvas id="visualizer"></canvas>
    <div class="vis-label">Las barras se mueven cuando hay audio reproduciéndose</div>
  </div>

<script>
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 64;
analyser.connect(audioCtx.destination);

canvas.width = canvas.offsetWidth;
canvas.height = canvas.offsetHeight;

const bufferLength = analyser.frequencyBinCount;
const dataArray = new Uint8Array(bufferLength);
const colors = [
  '#ff6188','#fc9867','#ffd866','#a9dc76','#78dce8','#ab9df2',
  '#ff6188','#fc9867','#ffd866','#a9dc76','#78dce8','#ab9df2',
  '#ff6188','#fc9867','#ffd866','#a9dc76','#78dce8','#ab9df2',
  '#ff6188','#fc9867','#ffd866','#a9dc76','#78dce8','#ab9df2',
  '#ff6188','#fc9867','#ffd866','#a9dc76','#78dce8','#ab9df2',
  '#ff6188','#fc9867',
];

function draw() {
  requestAnimationFrame(draw);
  analyser.getByteFrequencyData(dataArray);
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const barW = w / bufferLength;
  for (let i = 0; i < bufferLength; i++) {
    const barH = (dataArray[i] / 255) * h;
    const x = i * barW;
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(x + 1, h - barH, barW - 2, barH);
    ctx.globalAlpha = 0.15;
    ctx.fillRect(x + 1, h, barW - 2, barH * 0.3);
    ctx.globalAlpha = 1;
  }
}
draw();

async function testTTS() {
  const btn = document.getElementById('btn');
  const status = document.getElementById('status');
  const text = document.getElementById('text').value.trim();
  const voice = document.getElementById('voice').value;

  if (!text) { status.className = 'err'; status.textContent = '⚠ Escribe algo primero'; return; }

  btn.disabled = true;
  status.className = 'loading';
  status.textContent = '⏳ Generando audio...';

  try {
    const t0 = performance.now();
    const res = await fetch('/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
    });
    const data = await res.json();
    const ms = Math.round(performance.now() - t0);

    if (data.error) { status.className = 'err'; status.textContent = '❌ ' + data.error; btn.disabled = false; return; }

    status.className = 'ok';
    status.textContent = '✅ Audio generado en ' + ms + 'ms' + (data.cached ? ' (caché)' : '') + ' — Reproduciendo...';

    if (audioCtx.state === 'suspended') await audioCtx.resume();

    const raw = atob(data.audioBase64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const buffer = await audioCtx.decodeAudioData(bytes.buffer);
    const source = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(analyser);
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.05);
    gain.gain.setValueAtTime(1, audioCtx.currentTime + buffer.duration - 0.1);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + buffer.duration);
    source.onended = () => { status.textContent = '✅ Listo (' + ms + 'ms)'; btn.disabled = false; };
    source.start(0);
  } catch (e) {
    status.className = 'err';
    status.textContent = '❌ Error: ' + e.message;
    btn.disabled = false;
  }
}
</script>
</body>
</html>
"""


# ─── Utilidades ───────────────────────────────────────────────────────────────

def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """Verifica si un puerto TCP está ocupado."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        return sock.connect_ex((host, port)) == 0


def find_available_port(start_port: int, host: str = "127.0.0.1") -> int:
    """Busca un puerto libre empezando desde start_port."""
    port = start_port
    while is_port_in_use(port, host):
        print(f"  ⚠ Puerto {port} ocupado, probando {port + 1}...")
        port += 1
        if port > start_port + 10:
            raise RuntimeError(f"No se encontró puerto libre entre {start_port}-{port}")
    return port


# ─── Arranque ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    import uvicorn

    # Forzar UTF-8 en la consola de Windows para caracteres unicode
    sys.stdout.reconfigure(encoding="utf-8")

    actual_port = find_available_port(PORT)

    print()
    print("╔══════════════════════════════════════════════════╗")
    print("║   🎤 CuloconKKRix — Servidor de Voz Pro v2.0   ║")
    print("╠══════════════════════════════════════════════════╣")
    print("║  Voces disponibles:                             ║")
    for vid, vname in EDGE_VOICES.items():
        label = f"  ► {vid:8s} → {vname}"
        print(f"║{label:<50s}║")
    print("╠══════════════════════════════════════════════════╣")
    print(f"║  API Docs: http://127.0.0.1:{actual_port}/docs{' ' * (11 - len(str(actual_port)))}║")
    print(f"║  Test TTS: http://127.0.0.1:{actual_port}/test{' ' * (11 - len(str(actual_port)))}║")
    print("╚══════════════════════════════════════════════════╝")
    print()

    uvicorn.run(app, host="127.0.0.1", port=actual_port, log_level="warning")
