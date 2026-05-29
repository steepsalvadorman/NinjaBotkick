# DaiBot — Bot de Stream para Kick.com

Bot de streaming para el canal **SeniorDai** en Kick.com. Maneja el chat, reproduce videos de YouTube pedidos por el chat, hace text-to-speech y muestra un overlay animado en OBS.

---

## ¿Qué hace?

| Función | Descripción |
|---|---|
| 💬 Chat en vivo | Lee el chat de Kick y lo muestra en el overlay de OBS |
| 🎬 Cola de videos | El chat puede pedir videos de YouTube con `!play` |
| 🔊 Text-to-Speech | El chat puede hacer hablar al bot con `!s` |
| 📺 Overlay OBS | Pantalla animada estilo pixel art con stats, chat y reproductor |
| 👥 Meta de seguidores | Barra de progreso de seguidores en tiempo real |
| 💻 Stats del sistema | CPU, RAM y temperatura de Lima en el overlay |

---

## Requisitos

Antes de correr el bot necesitas tener instalado:

- **Rust** — [rustup.rs](https://rustup.rs) (el script lo instala solo si falta)
- **Node.js** — para el login OAuth de Kick
- **Python edge-tts** — para el text-to-speech

```bash
# Instalar edge-tts (solo una vez)
pip install edge-tts
```

---

## Configuración

**1. Clonar el repositorio**
```bash
git clone https://github.com/steepsalvadorman/DaiBotkick.git
cd DaiBotkick
```

**2. Crear tu archivo `.env`**
```bash
cp .env.example .env
```

**3. Editar `.env` con tus datos**

Lo mínimo que necesitas:
```env
CHANNEL_NAME=tu_canal_de_kick

KICK_CLIENT_ID=     # de kick.com/settings/developer
KICK_CLIENT_SECRET= # de kick.com/settings/developer
```

El resto de campos (tokens OAuth) se llenan automáticamente al hacer login.

---

## Cómo iniciar

```bash
./autorun.sh
```

El script hace todo solo:
1. Verifica que Rust y Node.js estén instalados
2. Abre el navegador para que autorices el bot en Kick (primera vez)
3. Compila el backend en Rust
4. Arranca el bot (y lo reinicia solo si se cae)

---

## Configurar OBS

Agrega una **Browser Source** con estos ajustes:

| Campo | Valor |
|---|---|
| URL | `http://localhost:3000/pixel.html` |
| Ancho | `1920` |
| Alto | `1080` |
| Controlar audio vía OBS | ✅ Marcado |
| CSS personalizado | `body { background-color: rgba(0,0,0,0); margin: 0; overflow: hidden; }` |

> ⚠️ Usa **una sola** browser source. Cada vez que refresca se crea una nueva conexión.

---

## Comandos del chat

Estos los puede usar **cualquier persona** en el chat:

| Comando | Qué hace |
|---|---|
| `!play [url]` | Agrega un video de YouTube a la cola |
| `!s [texto]` | El bot habla con voz peruana (Camila) |
| `!camila [texto]` | Voz peruana femenina |
| `!dalia [texto]` | Voz mexicana femenina |
| `!jorge [texto]` | Voz mexicana masculina |
| `!alex [texto]` | Voz peruana masculina |
| `!jacinta [texto]` | Voz peruana femenina (alias de Camila) |

---

## Comandos del streamer

Solo funcionan si los escribe el dueño del canal:

| Comando | Qué hace |
|---|---|
| `!von` | Muestra el reproductor de video en el overlay |
| `!voff` | Oculta el video pero el audio sigue sonando |
| `!vstop` | Para todo: limpia la cola y oculta el reproductor |
| `!next` / `!skip` | Salta al siguiente video de la cola |

---

## Estructura del proyecto

```
DaiBotkick/
├── autorun.sh          ← Script para iniciar todo
├── .env                ← Tus credenciales (NO se sube a git)
├── .env.example        ← Plantilla de configuración
│
├── backend/            ← Servidor en Rust
│   └── src/
│       ├── main.rs         Punto de entrada
│       ├── commands/       Lógica de comandos del chat
│       ├── kick/           Conexión al chat de Kick.com
│       ├── tts/            Text-to-speech (edge-tts)
│       ├── queue/          Cola de videos
│       ├── server/         WebSocket con el overlay
│       └── stats/          CPU/RAM en tiempo real
│
├── overlay/            ← Archivos que ve OBS
│   └── pixel.html          El overlay principal (estilo pixel art)
│
├── login/              ← Login OAuth de Kick
│   └── login.js
│
└── data/               ← Datos en tiempo real (no en git)
    └── tts_cache/          Cache de audios generados
```

---

## Tecnologías usadas

- **Backend:** Rust con [Axum](https://github.com/tokio-rs/axum) + [socketioxide](https://github.com/Totodore/socketioxide)
- **Overlay:** HTML + CSS + JavaScript vanilla
- **Chat:** API de Kick.com vía Pusher WebSocket
- **TTS:** [edge-tts](https://github.com/rany2/edge-tts) (voces de Microsoft Edge, gratis)
- **Videos:** YouTube IFrame embed con autoplay + Web Audio API

---

## Solución de problemas comunes

**El bot no se conecta al chat**
→ Corre `./autorun.sh` de nuevo para renovar el token OAuth

**No se escucha el TTS**
→ Verifica que `edge-tts` esté instalado: `pip install edge-tts`
→ Verifica que "Controlar audio vía OBS" esté marcado en la browser source

**El video no reproduce**
→ Asegúrate de tener una sola browser source en OBS (no refrescar)
→ El video aparece automáticamente cuando alguien usa `!play`

**El overlay se ve cortado**
→ El overlay está diseñado para 1920×1080. Verifica las dimensiones en OBS
