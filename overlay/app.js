// ─── SeniorDai — Overlay v4.1 (syncQueue Protocol) ──────────────────────────
// El servidor (culoconkkrix.js) emite:
//   io.emit("syncQueue", videoQueue)  → array completo de la cola
//   io.emit("nextVideo")              → skip manual del owner
//   io.emit("chatMessage", {...})
//   io.emit("sysStats", {...})
//   io.emit("speak", {...})
// El overlay emite de vuelta:
//   socket.emit("advanceQueue")       → cuando un video termina

const socket = io();
// ─── DOM Refs ─────────────────────────────────────────────────────────────────

// ─── CONFIGURACIÓN DE VOLUMEN ─────────────────────────────────────────────────
const VOL_MUSIC_YT = 25;    // Volumen de YouTube (0 a 100)
const VOL_MUSIC_DIR = 0.25; // Volumen de videos directos (0.0 a 1.0)
const VOL_TTS = 1.0;        // Volumen de las alertas/TTS (0.0 a 1.0)

const chatMessages     = document.getElementById("chat-messages");
const mediaWidget      = document.getElementById("media-widget");
const videoTitleEl     = document.getElementById("video-title");
const videoRequesterEl = document.getElementById("video-requester");
const youtubePlayerDiv = document.getElementById("youtube-player");
const directVideo      = document.getElementById("direct-video");
const unlockScreen     = document.getElementById("unlock-screen");

// ─── Autoplay Unlock ──────────────────────────────────────────────────────────

let audioUnlocked = true;
audioContext.resume();

function unlockAudio() {} // no-op, mantenido por compatibilidad

// ─── Estado local ─────────────────────────────────────────────────────────────

let localQueue     = [];   // copia local del array que envía el servidor
let isPlayerReady  = false;
let isPlaying      = false;
let isVideoVisible = true;
let loadingTimeout;

// ─── syncQueue — evento principal ────────────────────────────────────────────
// El servidor manda el array COMPLETO cada vez que cambia.
// Nosotros solo reproducimos el [0] si no estamos reproduciendo ya.

socket.on("syncQueue", (queue) => {
  console.log(`📋 syncQueue recibido: ${queue.length} videos`);
  localQueue = queue;
  updateQueueBadge();

  if (!isPlaying && localQueue.length > 0 && audioUnlocked) {
    playHead();
  }

  // Si la cola quedó vacía, limpiar y pausar todo
  if (localQueue.length === 0) {
    isPlaying = false;
    hideWidget();
    if (isPlayerReady && player && player.stopVideo) player.stopVideo();
    if (directVideo) { directVideo.pause(); directVideo.src = ""; }
  }
});

// Skip manual desde el owner (!next)
socket.on("nextVideo", () => {
  console.log("⏭ Skip manual recibido");
  finishCurrent();
});

// Visibilidad de video (!von / !voff)
socket.on("toggleVideo", (data) => {
  console.log(`👁️ toggleVideo: ${data.showVideo}`);
  isVideoVisible = data.showVideo;
  if (!isVideoVisible) {
    if (mediaWidget) mediaWidget.style.display = "none";
  } else {
    if (isPlaying && mediaWidget) {
      mediaWidget.style.display = "block";
      requestAnimationFrame(() => {
        mediaWidget.style.opacity   = "1";
        mediaWidget.style.transform = "scale(1)";
      });
    }
  }
});

// ─── Lógica de reproducción ───────────────────────────────────────────────────

function playHead() {
  if (isPlaying || localQueue.length === 0 || !audioUnlocked) return;

  const next = localQueue[0];
  isPlaying = true;

  console.log(`🎬 Reproduciendo: "${next.title}" — por ${next.user}`);
  showWidget(next);

  if (next.videoId) {
    playYouTube(next.videoId);
  } else if (next.url) {
    playDirect(next.url);
  } else {
    console.warn("⚠️ Item sin videoId ni url");
    finishCurrent();
  }
}

// Llamar cuando el video termina — notifica al servidor para que haga shift()
let isAdvancing = false;
function finishCurrent() {
  if (isAdvancing || localQueue.length === 0) return;
  isAdvancing = true;
  setTimeout(() => isAdvancing = false, 1000);

  clearTimeout(loadingTimeout);
  isPlaying = false;

  // Decirle al servidor que avance la cola (él hace el shift y re-emite syncQueue)
  socket.emit("advanceQueue");
}

// ─── YouTube Player ───────────────────────────────────────────────────────────

let player;

function onYouTubeIframeAPIReady() {
  player = new YT.Player("youtube-player", {
    height: "100%", width: "100%",
    playerVars: {
      autoplay: 1, controls: 0, modestbranding: 1,
      rel: 0, mute: 1,
      origin: window.location.origin,
      enablejsapi: 1
    },
    events: {
      onReady:       () => { isPlayerReady = true; console.log("✅ YT Player listo"); },
      onStateChange: onPlayerStateChange,
      onError:       (e) => { console.error("❌ YT Error:", e.data); finishCurrent(); }
    }
  });
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    clearTimeout(loadingTimeout);
    if (player.isMuted()) { player.unMute(); player.setVolume(VOL_MUSIC_YT); }
  }
  if (event.data === YT.PlayerState.ENDED) {
    finishCurrent();
  }
}

function playYouTube(videoId) {
  directVideo.pause();
  directVideo.style.display = "none";
  youtubePlayerDiv.style.display = "block";

  if (!isPlayerReady) {
    setTimeout(() => playYouTube(videoId), 500);
    return;
  }

  player.loadVideoById({ videoId: videoId, suggestedQuality: "hd1080" });

  // Timeout de seguridad: 15s sin arrancar → saltar
  loadingTimeout = setTimeout(() => {
    const state = player.getPlayerState();
    if (![YT.PlayerState.PLAYING, YT.PlayerState.BUFFERING].includes(state)) {
      console.warn("⚠️ Video trabado, saltando...");
      finishCurrent();
    }
  }, 15000);
}

function playDirect(url) {
  youtubePlayerDiv.style.display = "none";
  directVideo.style.display = "block";
  if (isPlayerReady) player.stopVideo();

  directVideo.src = url;
  directVideo.volume = VOL_MUSIC_DIR;
  directVideo.play().catch(() => finishCurrent());
  directVideo.onended = () => finishCurrent();
  directVideo.onerror = () => finishCurrent();
}

// ─── Widget UI ────────────────────────────────────────────────────────────────

function showWidget(data) {
  if (isVideoVisible && mediaWidget) {
    mediaWidget.style.display = "block";
    void mediaWidget.offsetWidth; // Forzar cálculo de layout en el navegador
  }

  if (videoTitleEl) {
    const titleText = data.title || "Sin título";
    videoTitleEl.classList.remove("scrolling");
    videoTitleEl.innerHTML = `<span class="title-inner" style="display: inline-block; white-space: nowrap;">${titleText}</span>`;

    setTimeout(() => {
      const innerSpan = videoTitleEl.querySelector(".title-inner");
      if (innerSpan) {
        // Medimos tanto el desbordamiento real en DOM como una heurística segura de longitud para OBS en segundo plano
        const isOverflowing = innerSpan.scrollWidth > videoTitleEl.clientWidth || titleText.length > 32;
        if (isOverflowing) {
          videoTitleEl.classList.add("scrolling");
          innerSpan.innerText = `${titleText}   ★★★   ${titleText}`;
          innerSpan.classList.add("marquee");
        }
      }
    }, 150);
  }

  if (videoRequesterEl) videoRequesterEl.innerText = data.user  || "Anónimo";

  if (isVideoVisible && mediaWidget) {
    requestAnimationFrame(() => {
      mediaWidget.style.opacity   = "1";
      mediaWidget.style.transform = "scale(1)";
    });
  }
}

function hideWidget() {
  mediaWidget.style.opacity   = "0";
  mediaWidget.style.transform = "scale(0.9)";
  setTimeout(() => {
    if (localQueue.length === 0) mediaWidget.style.display = "none";
  }, 500);
}

function updateQueueBadge() {
  const badge = document.getElementById("queue-indicator");
  if (!badge) return;
  if (localQueue.length > 1) {
    badge.style.display = "inline-block";
    badge.innerText     = `+${localQueue.length - 1} en cola`;
  } else {
    badge.style.display = "none";
  }
}

// ─── Weather ──────────────────────────────────────────────────────────────────

async function updateWeather() {
  try {
    const res  = await fetch("https://wttr.in/Lima?format=j1");
    const data = await res.json();
    const cur  = data.current_condition[0];
    const t = document.getElementById("weather-temp");
    const c = document.getElementById("weather-cond");
    if (t) t.innerText = `${cur.temp_C}°C`;
    if (c) c.innerText = cur.lang_es ? cur.lang_es[0].value : cur.weatherDesc[0].value;
  } catch (e) { /* silencioso */ }
}
updateWeather();
setInterval(updateWeather, 900000);

// ─── Audio Visualizer ─────────────────────────────────────────────────────────

const audioContext   = new (window.AudioContext || window.webkitAudioContext)();
const systemAnalyser = audioContext.createAnalyser();
systemAnalyser.fftSize = 64;
systemAnalyser.smoothingTimeConstant = 0.8;

(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext.createMediaStreamSource(stream).connect(systemAnalyser);
  } catch (e) { console.warn("Stereo Mix no disponible"); }
})();

const musicCanvas = document.getElementById("module-visualizer");
if (musicCanvas) {
  const ctx = musicCanvas.getContext("2d");
  const buf = new Uint8Array(systemAnalyser.frequencyBinCount);
  (function draw() {
    requestAnimationFrame(draw);
    systemAnalyser.getByteFrequencyData(buf);
    musicCanvas.width  = musicCanvas.offsetWidth;
    musicCanvas.height = musicCanvas.offsetHeight;
    const w = musicCanvas.width, h = musicCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const bw = (w / buf.length) * 1.5;
    let x = 0;
    for (let i = 0; i < buf.length; i++) {
      const bh = (buf[i] / 255) * h;
      ctx.fillStyle = `hsla(${260 + i * 2}, 80%, 70%, 0.4)`;
      ctx.fillRect(x, h - bh, bw - 1, bh);
      x += bw;
    }
  })();
}

// ─── Socket Events ────────────────────────────────────────────────────────────

socket.on("sysStats", (data) => {
  const c = document.getElementById("cpu-load");
  const r = document.getElementById("ram-usage");
  if (c) c.innerText = `${data.cpu}%`;
  if (r) r.innerText = `${Math.round(data.ram)}%`;
});

socket.on("chatMessage", (data) => {
  if (!chatMessages) return;
  const div = document.createElement("div");
  div.style.cssText = "margin-bottom:12px;display:flex;flex-direction:column;animation:slideIn 0.3s ease-out forwards;";
  div.innerHTML = `
    <div style="font-weight:800;font-size:0.85rem;color:#53fc18;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">${data.user}</div>
    <div style="background:rgba(255,255,255,0.05);padding:8px 12px;border-radius:0 12px 12px 12px;font-size:1rem;line-height:1.4;border-left:3px solid #53fc18;">${data.content}</div>
  `;
  chatMessages.appendChild(div);
  if (chatMessages.children.length > 8) chatMessages.removeChild(chatMessages.firstChild);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on("speak", (data) => {
  if (audioContext.state === "suspended") audioContext.resume();
  const ttsAudio = new Audio("data:audio/mp3;base64," + data.audioBase64);
  ttsAudio.volume = VOL_TTS;
  ttsAudio.play();
});
