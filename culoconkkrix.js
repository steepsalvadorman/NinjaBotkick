import { createClient } from "@retconned/kick-js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import Gtts from "gtts";
import fetch from "node-fetch";
import { createServer } from "http";
import { Server } from "socket.io";
import express from "express";
import os from "os";
import { URL } from "url";

dotenv.config();

// ─── Servidor Web + Socket.io ────────────────────────────────────────────────

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const ttsDir = path.join(".", "tts");
if (!fs.existsSync(ttsDir)) fs.mkdirSync(ttsDir);

app.use(express.static("public"));

// ─── Estadísticas de Sistema (CPU/RAM) ──────────────────────────────────────

let lastCpuTime = getCpuTime();

function getCpuTime() {
    let totalIdle = 0, totalTick = 0;
    const cpus = os.cpus();
    cpus.forEach(core => {
        for (let type in core.times) totalTick += core.times[type];
        totalIdle += core.times.idle;
    });
    return { idle: totalIdle / cpus.length, total: totalTick / cpus.length };
}

function sendSystemStats() {
    const currentCpuTime = getCpuTime();
    const idleDiff = currentCpuTime.idle - lastCpuTime.idle;
    const totalDiff = currentCpuTime.total - lastCpuTime.total;
    const cpuUsage = 100 - Math.floor(100 * idleDiff / totalDiff);
    lastCpuTime = currentCpuTime;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMemPercent = ((totalMem - freeMem) / totalMem) * 100;
    
    io.emit("sysStats", {
        cpu: isNaN(cpuUsage) ? "0" : cpuUsage.toString(),
        ram: usedMemPercent.toFixed(1)
    });
}

setInterval(sendSystemStats, 2000);

httpServer.listen(3000, () => {
  console.log("🚀 Servidor de Overlay listo en http://localhost:3000");
});

// ─── Variables de Entorno ────────────────────────────────────────────────────

const CHANNEL_NAME = process.env.CHANNEL_NAME || "seniordai";
const COOKIES = process.env.COOKIES;
const TTS_SERVER = process.env.TTS_SERVER_URL || "http://127.0.0.1:5000";

if (!COOKIES) {
  console.error("❌ ERROR: No se encontraron las COOKIES en el archivo .env");
  console.log("Ejecuta RUN_BOT.bat para configurar tu bot automáticamente.");
  process.exit(1);
}

// ─── Kick Client ─────────────────────────────────────────────────────────────

// Extraer tokens de las cookies si no existen en .env
const extractedToken = process.env.BEARER_TOKEN || (COOKIES.match(/kick_session=([^;]+)/)?.[1] || "");
const extractedXsrf = (COOKIES.match(/XSRF-TOKEN=([^;]+)/)?.[1] || "");

const client = createClient(CHANNEL_NAME, { logger: true });

// ─── Persistencia de Cola ────────────────────────────────────────────────────
const QUEUE_FILE = path.join(".", "queue.json");
let videoQueue = [];

// Cargar cola al iniciar
if (fs.existsSync(QUEUE_FILE)) {
  try {
    videoQueue = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8"));
    console.log(`📦 Cola cargada desde archivo: ${videoQueue.length} videos.`);
  } catch (e) { videoQueue = []; }
}

function saveQueue() {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(videoQueue, null, 2));
}

io.on("connection", (socket) => {
  console.log("✅ Widget conectado via Socket.io");
  
  // Enviar cola actual al conectar
  socket.emit("syncQueue", videoQueue);

  // El cliente avanza la cola cuando termina un video
  socket.on("advanceQueue", () => {
    if (videoQueue.length > 0) {
      videoQueue.shift();
      saveQueue();
      io.emit("syncQueue", videoQueue);
    }
  });
});

client.login({
  type: "tokens",
  credentials: {
    bearerToken: decodeURIComponent(extractedToken),
    xXsrfToken: decodeURIComponent(extractedXsrf),
    cookies: COOKIES,
  },
}).then(() => console.log(`✅ Bot conectado al canal ${CHANNEL_NAME}!`));

// ─── Cola de TTS ─────────────────────────────────────────────────────────────

const ttsQueue = [];
let isTTSProcessing = false;

async function processTTSQueue() {
  if (isTTSProcessing || ttsQueue.length === 0) return;

  isTTSProcessing = true;
  const { text, voice } = ttsQueue.shift();

  try {
    await generateTTS(text, voice);
  } catch (error) {
    console.error("Error procesando TTS:", error);
  }

  isTTSProcessing = false;
  processTTSQueue();
}

function enqueueTTS(text, voice = "dalia") {
  ttsQueue.push({ text, voice });
  console.log(`[TTS] En cola: "${text.substring(0, 30)}..." (voz: ${voice}) — Cola: ${ttsQueue.length}`);
  processTTSQueue();
}

// ─── Función TTS Principal ───────────────────────────────────────────────────

async function generateTTS(text, voice = "dalia") {
  try {
    // Intentar servidor Python (Edge TTS — alta calidad)
    const res = await fetch(`${TTS_SERVER}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
    });

    if (res.ok) {
      const data = await res.json();
      io.emit("speak", { audioBase64: data.audioBase64 });
      const cached = data.cached ? " (caché)" : "";
      console.log(`[TTS OK] Edge TTS${cached}: "${text.substring(0, 40)}..."`);
      return;
    }

    throw new Error(`Python server respondió ${res.status}`);
  } catch {
    // Fallback a gTTS si Python no está corriendo
    console.warn("⚠️ Servidor Python no disponible. Usando gTTS básico...");
    await generateFallbackTTS(text);
  }
}

async function generateFallbackTTS(text) {
  return new Promise((resolve) => {
    const tempFile = path.join(ttsDir, `tts_${Date.now()}.mp3`);
    const gtts = new Gtts(text, "es");

    gtts.save(tempFile, (err) => {
      if (err) {
        console.error("Error gTTS:", err);
        resolve();
        return;
      }

      fs.readFile(tempFile, (readErr, data) => {
        if (!readErr) {
          io.emit("speak", { audioBase64: data.toString("base64") });
          console.log(`[TTS OK] gTTS fallback: "${text.substring(0, 40)}..."`);
        }

        // Limpiar archivo temporal
        setTimeout(() => {
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        }, 3000);

        resolve();
      });
    });
  });
}

// ─── Utilidades de YouTube ───────────────────────────────────────────────────

async function getFirstVideoIdFromPlaylist(url) {
  try {
    const listId = new URL(url).searchParams.get("list");
    if (!listId || listId.startsWith("RD")) return null;

    const apiKey = "AIzaSyBJRSpiY0bvQmjmJDdvUNPLRU_Z4YNCrRs";
    const endpoint = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=1&playlistId=${listId}&key=${apiKey}`;
    const res = await fetch(endpoint);
    const data = await res.json();

    if (data.items && data.items.length > 0) {
      return {
        videoId: data.items[0].snippet.resourceId.videoId,
        title: data.items[0].snippet.title,
      };
    }
    return null;
  } catch (error) {
    console.error("Error al obtener playlist:", error);
    return null;
  }
}

async function getVideoTitle(url) {
  try {
    const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
    const info = await res.json();
    return info.title || "Video";
  } catch {
    return "Video";
  }
}

client.on("ChatMessage", async (message) => {
  const content = message.content.trim();
  const username = message.sender.username;
  const isOwner = username.toLowerCase() === "seniordai";

  // Emitir mensajes al overlay
  io.emit("chatMessage", { user: username, content });

  // ── Comandos de Video ──────────────────────────────────────────────────
  const cmd = content.toLowerCase();
  if (isOwner && (cmd === "!von" || cmd === "!voff")) {
    io.emit("toggleVideo", { showVideo: cmd === "!von" });
    return;
  }
  if (isOwner && cmd === "!next") {
    io.emit("nextVideo");
    return;
  }

  // !play — Reproducir video (YouTube o Link Directo)
  if (content.startsWith("!play ")) {
    const url = content.slice(6).trim();
    console.log(`[PLAY] Solicitud recibida: ${url}`);

    // 1. Detectar si es un link de video directo (.mp4, .webm, etc)
    const isDirectVideo = /\.(mp4|webm|mov|m4v)$/i.test(url);
    if (isDirectVideo) {
        const fileName = url.split('/').pop().split('?')[0];
        io.emit("songRequest", {
            url: url,
            title: fileName || "Video Directo",
            user: username,
        });
        return;
    }

    // 2. YouTube
    try {
        let videoId = null;
        let title = "Video de YouTube";

        // Caso A: Es una Playlist
        if (url.includes("list=")) {
            const playlistInfo = await getFirstVideoIdFromPlaylist(url);
            if (playlistInfo) {
                videoId = playlistInfo.videoId;
                title = playlistInfo.title;
            }
        }

        // Caso B: Es un video individual (o fallback de playlist si no se obtuvo ID)
        if (!videoId) {
            const youtubeIdMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:.*v=|.*\/|.*embed\/|.*shorts\/|.*watch\?v=))([^?&"'>\s]+)/);
            videoId = youtubeIdMatch ? youtubeIdMatch[1] : null;
            if (videoId) {
                title = await getVideoTitle(url);
            }
        }

        if (videoId) {
            const songData = {
                videoId: videoId,
                title: title,
                user: username,
            };
            videoQueue.push(songData);
            saveQueue();
            console.log(`📡 Enviando al overlay: ${title} (ID: ${videoId})`);
            io.emit("syncQueue", videoQueue);
        } else {
            console.warn(`⚠️ No se pudo extraer ID de YouTube de: ${url}`);
        }
    } catch (err) {
        console.error("❌ Error procesando !play:", err);
    }
    return;
  }
  // ── Comandos de Voz ────────────────────────────────────────────────────

  const args = content.split(" ");
  const command = args[0].toLowerCase();
  const text = args.slice(1).join(" ").trim();

  if (!text) return;

  // !s — Voz Edge TTS por defecto (Dalia)
  if (command === "!s") {
    enqueueTTS(text, "dalia");
    return;
  }

  // ![nombre] — Voces custom (futuro: modelos RVC descargados)
  // Por ahora, verificar si el nombre coincide con una voz Edge TTS
  if (command.startsWith("!") && command.length > 1) {
    const voiceName = command.slice(1);
    // Verificar si es una voz Edge TTS conocida
    const edgeVoices = ["dalia", "jorge", "camila", "alex"];
    if (edgeVoices.includes(voiceName)) {
      enqueueTTS(text, voiceName);
      return;
    }
    // En el futuro: verificar custom_voices/ para modelos RVC
  }
});
