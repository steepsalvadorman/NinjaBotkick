// ─── SeniorDai — Overlay v4.0 (AutoQueue + Autoplay Fix) ────────────────────

const socket = io();

// ─── DOM Refs ─────────────────────────────────────────────────────────────────

const chatMessages     = document.getElementById("chat-messages");
const mediaWidget      = document.getElementById("media-widget");
const videoTitle       = document.getElementById("video-title");
const videoRequester   = document.getElementById("video-requester");
const youtubePlayerDiv = document.getElementById("youtube-player");
const directVideo      = document.getElementById("direct-video");
const unlockScreen     = document.getElementById("unlock-screen");

// ─── Autoplay Unlock ──────────────────────────────────────────────────────────
// El browser bloquea autoplay con audio hasta que el usuario interactúa una vez.
// Esta pantalla transparente captura ese primer click y desaparece para siempre.

let audioUnlocked = false;

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  // Reanudar AudioContext si estaba suspendido
  if (audioContext.state === "suspended") audioContext.resume();

  // Ocultar pantalla de unlock
  if (unlockScreen) {
    unlockScreen.style.opacity = "0";
    setTimeout(() => unlockScreen.style.display = "none", 400);
  }

  console.log("🔓 Audio desbloqueado — autoplay activo");

  // Si ya había algo en cola esperando, arrancarlo ahora
  if (videoQueue.length > 0 && !isPlaying) checkQueue();
}

if (unlockScreen) {
  unlockScreen.addEventListener("click", unlockAudio);
  unlockScreen.addEventListener("keydown", unlockAudio);
}

// ─── Queue State ──────────────────────────────────────────────────────────────

let videoQueue    = [];
let isPlayerReady = false;
let isPlaying     = false;
let currentVideoId = null; // Para evitar recargar el mismo video si no es necesario
let loadingTimeout;

// ─── YouTube IFrame API ───────────────────────────────────────────────────────

let player;

function onYouTubeIframeAPIReady() {
  player = new YT.Player("youtube-player", {
    height: "100%",
    width:  "100%",
    playerVars: {
      autoplay:       1,
      controls:       0,
      modestbranding: 1,
      rel:            0,
      mute:           0,          // SIN mute — el unlock screen ya garantizó la interacción
      origin:         window.location.origin,
      enablejsapi:    1
    },
    events: {
      onReady:       onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError:       (e) => { console.error("❌ YT Error:", e.data); advanceQueue(); }
    }
  });
}

function onPlayerReady() {
  isPlayerReady = true;
  console.log("✅ YouTube Player listo");
  checkQueue();
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    clearTimeout(loadingTimeout);
    // Asegurar volumen máximo siempre
    player.setVolume(100);
    if (player.isMuted()) player.unMute();
  }
  if (event.data === YT.PlayerState.ENDED) {
    advanceQueue();
  }
}

// ─── Queue Engine ─────────────────────────────────────────────────────────────

function advanceQueue() {
  clearTimeout(loadingTimeout);
  isPlaying = false;
  currentVideoId = null;
  // Notificar al servidor que este video terminó
  socket.emit("advanceQueue");
}

function checkQueue() {
  // Si el audio no fue desbloqueado aún, esperar
  if (!audioUnlocked) {
    console.log("⏸ Esperando unlock de audio...");
    return;
  }
  
  if (videoQueue.length === 0) {
    isPlaying = false;
    currentVideoId = null;
    hideWidget();
    if (isPlayerReady) player.stopVideo();
    return;
  }

  const next = videoQueue[0];
  
  // Si ya estamos reproduciendo este video exacto, no hacer nada
  if (isPlaying && (next.videoId === currentVideoId || next.url === currentVideoId)) return;

  isPlaying = true;
  currentVideoId = next.videoId || next.url;
  console.log(`🎬 Reproduciendo: "${next.title}" — por ${next.user}`);
  showWidget(next);

  if (next.videoId) {
    playYouTube(next.videoId);
  } else if (next.url) {
    playDirect(next.url);
  } else {
    console.warn("⚠️ Item inválido, saltando...");
    advanceQueue();
  }
}

// ─── Reproductores ────────────────────────────────────────────────────────────

function playYouTube(videoId) {
  directVideo.pause();
  directVideo.style.display = "none";
  youtubePlayerDiv.style.display = "block";

  if (!isPlayerReady) {
    setTimeout(() => playYouTube(videoId), 500);
    return;
  }

  // cueVideoById + delay: evita fallo silencioso de loadVideoById
  player.cueVideoById({ videoId, suggestedQuality: "hd1080" });
  setTimeout(() => {
    player.setVolume(100);
    player.unMute();
    player.playVideo();
  }, 300);

  // Timeout de seguridad
  loadingTimeout = setTimeout(() => {
    const state = player.getPlayerState();
    const valid = [YT.PlayerState.PLAYING, YT.PlayerState.BUFFERING];
    if (!valid.includes(state)) {
      console.warn("⚠️ Video trabado, saltando...");
      advanceQueue();
    }
  }, 15000);
}

function playDirect(url) {
  youtubePlayerDiv.style.display = "none";
  directVideo.style.display = "block";
  if (isPlayerReady) player.stopVideo();
  directVideo.src = url;
  directVideo.play().catch(() => advanceQueue());
  directVideo.onended = () => advanceQueue();
  directVideo.onerror = () => advanceQueue();
}

// ─── Widget UI ────────────────────────────────────────────────────────────────

function showWidget(data) {
  if (videoTitle)     videoTitle.innerText     = data.title || "Sin título";
  if (videoRequester) videoRequester.innerText = data.user  || "Anónimo";

  mediaWidget.style.display = "block";
  requestAnimationFrame(() => {
    mediaWidget.style.opacity   = "1";
    mediaWidget.style.transform = "scale(1)";
  });
}

function hideWidget() {
  mediaWidget.style.opacity   = "0";
  mediaWidget.style.transform = "scale(0.9)";
  setTimeout(() => {
    if (videoQueue.length === 0) mediaWidget.style.display = "none";
  }, 500);
}

function updateQueueBadge() {
  const badge = document.getElementById("queue-indicator");
  if (!badge) return;
  if (videoQueue.length > 1) {
    badge.style.display = "inline-block";
    badge.innerText     = `+${videoQueue.length - 1} en cola`;
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
    const tempEl = document.getElementById("weather-temp");
    const condEl = document.getElementById("weather-cond");
    if (tempEl) tempEl.innerText = `${cur.temp_C}°C`;
    if (condEl) condEl.innerText = cur.lang_es
      ? cur.lang_es[0].value
      : cur.weatherDesc[0].value;
  } catch (e) {
    const tempEl = document.getElementById("weather-temp");
    const condEl = document.getElementById("weather-cond");
    if (tempEl) tempEl.innerText = "19°C";
    if (condEl) condEl.innerText = "Nublado";
  }
}
updateWeather();
setInterval(updateWeather, 900000);

// ─── Audio Visualizer ─────────────────────────────────────────────────────────

const audioContext   = new (window.AudioContext || window.webkitAudioContext)();
const systemAnalyser = audioContext.createAnalyser();
systemAnalyser.fftSize = 64;
systemAnalyser.smoothingTimeConstant = 0.8;

async function initCapture() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext.createMediaStreamSource(stream).connect(systemAnalyser);
  } catch (e) {
    console.warn("Stereo Mix no disponible:", e);
  }
}
initCapture();

const musicCanvas = document.getElementById("module-visualizer");
if (musicCanvas) {
  const ctx          = musicCanvas.getContext("2d");
  const bufferLength = systemAnalyser.frequencyBinCount;
  const dataArray    = new Uint8Array(bufferLength);

  (function draw() {
    requestAnimationFrame(draw);
    systemAnalyser.getByteFrequencyData(dataArray);
    musicCanvas.width  = musicCanvas.offsetWidth;
    musicCanvas.height = musicCanvas.offsetHeight;
    const w = musicCanvas.width, h = musicCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const barWidth = (w / bufferLength) * 1.5;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * h;
      ctx.fillStyle = `hsla(${260 + i * 2}, 80%, 70%, 0.4)`;
      ctx.fillRect(x, h - barHeight, barWidth - 1, barHeight);
      x += barWidth;
    }
  })();
}

// ─── Socket Events ────────────────────────────────────────────────────────────

socket.on("sysStats", (data) => {
  const cpuEl = document.getElementById("cpu-load");
  const ramEl = document.getElementById("ram-usage");
  if (cpuEl) cpuEl.innerText = `${data.cpu}%`;
  if (ramEl) ramEl.innerText = `${Math.round(data.ram)}%`;
});

socket.on("mediaUpdate", (data) => {
  const musicTitle   = document.getElementById("music-title");
  const musicArtist  = document.getElementById("music-artist");
  const platformIcon = document.getElementById("platform-icon");

  if (!data) {
    if (musicTitle)   musicTitle.innerText   = "Silencio";
    if (musicArtist)  musicArtist.innerText  = "Esperando música...";
    if (platformIcon) platformIcon.className = "ph-fill ph-music-note text-2xl text-white/20";
    return;
  }

  if (musicTitle)  musicTitle.innerText  = data.Title  || "Desconocido";
  if (musicArtist) musicArtist.innerText = data.Artist || "Varios Artistas";

  if (platformIcon) {
    platformIcon.className = "ph-fill text-2xl animate-pulse ";
    if      (data.platform === "spotify") platformIcon.className += "ph-spotify-logo text-[#1DB954]";
    else if (data.platform === "youtube") platformIcon.className += "ph-youtube-logo text-[#FF0000]";
    else if (data.platform === "apple")   platformIcon.className += "ph-apple-logo text-white";
    else                                  platformIcon.className += "ph-music-note text-[#53fc18]";
  }
});

socket.on("chatMessage", (data) => {
  const msgDiv = document.createElement("div");
  msgDiv.style.cssText = "margin-bottom:12px; display:flex; flex-direction:column; animation: slideIn 0.3s ease-out forwards;";
  msgDiv.innerHTML = `
    <div style="font-weight:800; font-size:0.85rem; color:#53fc18; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:3px;">
      ${data.user}
    </div>
    <div style="background:rgba(255,255,255,0.05); padding:8px 12px; border-radius:0 12px 12px 12px; font-size:1rem; line-height:1.4; border-left:3px solid #53fc18;">
      ${data.content}
    </div>
  `;
  chatMessages.appendChild(msgDiv);
  if (chatMessages.children.length > 8) chatMessages.removeChild(chatMessages.firstChild);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

// 🎵 Sincronización completa de la cola
socket.on("syncQueue", (newQueue) => {
  console.log("🔄 Cola sincronizada con el servidor:", newQueue.length, "videos");
  videoQueue = newQueue;
  updateQueueBadge();
  checkQueue();
});

// Toggle visibilidad manual (!von / !voff)
socket.on("toggleVideo", (data) => {
  console.log("📺 Toggle Video:", data.showVideo);
  if (data.showVideo) {
    if (videoQueue.length > 0) showWidget(videoQueue[0]);
  } else {
    hideWidget();
  }
});

// Skip manual desde el bot (!next)
socket.on("nextVideo", () => {
  console.log("⏭ Skip manual");
  advanceQueue();
});

socket.on("speak", (data) => {
  if (audioContext.state === "suspended") audioContext.resume();
  const audio = new Audio("data:audio/mp3;base64," + data.audioBase64);
  audio.play();
});