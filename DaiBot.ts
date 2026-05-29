import { createClient } from "@retconned/kick-js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import Gtts from "gtts";
import fetch from "node-fetch";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import express from "express";
import os from "os";
import { URL } from "url";

dotenv.config();

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface VideoItem {
  videoId?: string;
  url?: string;
  title: string;
  user: string;
}

interface TtsItem {
  text: string;
  voice: string;
}

interface PanelCommand {
  command: "play" | "skip" | "tts" | "toggleVideo" | "clearQueue" | "removeFromQueue";
  args?: string;
  voice?: string;
  show?: boolean;
  index?: number;
  token: string;
}

interface SysStats {
  cpu: string;
  ram: string;
}

// ─── Servidor Web + Socket.io ────────────────────────────────────────────────

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const ttsDir = path.join(".", "tts");
if (!fs.existsSync(ttsDir)) fs.mkdirSync(ttsDir);

app.use(express.static("overlay"));

// ─── Variables de Entorno ────────────────────────────────────────────────────

const CHANNEL_NAME = process.env.CHANNEL_NAME ?? "seniordai";
const COOKIES = process.env.COOKIES;
const TTS_SERVER = process.env.TTS_SERVER_URL ?? "http://127.0.0.1:5000";
const PANEL_TOKEN = process.env.PANEL_TOKEN ?? "";
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const QUEUE_FILE = process.env.QUEUE_FILE ?? "./data/queue.json";

const EDGE_VOICES = ["dalia", "jorge", "camila", "alex"] as const;
type EdgeVoice = typeof EDGE_VOICES[number];

if (!COOKIES) {
  console.error("❌ ERROR: No se encontraron las COOKIES en el archivo .env");
  console.log("Ejecuta: cd login && npm install && node login.js");
  process.exit(1);
}

if (!PANEL_TOKEN) {
  console.warn("⚠️  PANEL_TOKEN no configurado en .env — el panel de control estará desprotegido");
}

// ─── Estadísticas de Sistema ─────────────────────────────────────────────────

let lastCpuTime = getCpuTime();

function getCpuTime() {
  let totalIdle = 0, totalTick = 0;
  const cpus = os.cpus();
  for (const core of cpus) {
    for (const type of Object.keys(core.times) as (keyof typeof core.times)[]) {
      totalTick += core.times[type];
    }
    totalIdle += core.times.idle;
  }
  return { idle: totalIdle / cpus.length, total: totalTick / cpus.length };
}

let followGoal = parseInt(process.env.FOLLOW_GOAL ?? "100", 10);
let currentFollowers = parseInt(process.env.CURRENT_FOLLOWERS ?? "0", 10);

async function fetchRealFollowers(): Promise<void> {
  try {
    const res = await fetch(`https://kick.com/api/v1/channels/${CHANNEL_NAME}`);
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      if (typeof data["followersCount"] === "number") {
        currentFollowers = data["followersCount"];
      } else if (typeof data["followers_count"] === "number") {
        currentFollowers = data["followers_count"];
      }
    }
  } catch { /* Cloudflare / sin conexión — silencioso */ }
}

fetchRealFollowers();
setInterval(fetchRealFollowers, 60_000);

function sendSystemStats(): void {
  const current = getCpuTime();
  const idleDiff = current.idle - lastCpuTime.idle;
  const totalDiff = current.total - lastCpuTime.total;
  const cpuUsage = 100 - Math.floor((100 * idleDiff) / totalDiff);
  lastCpuTime = current;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ramPercent = ((totalMem - freeMem) / totalMem) * 100;

  const stats: SysStats = {
    cpu: isNaN(cpuUsage) ? "0" : cpuUsage.toString(),
    ram: ramPercent.toFixed(1),
  };

  io.emit("sysStats", stats);
  io.emit("followGoal", { current: currentFollowers, goal: followGoal });
}

setInterval(sendSystemStats, 2_000);

httpServer.listen(PORT, () => {
  console.log(`🚀 DaiBot listo → http://localhost:${PORT}`);
  console.log(`🎛️  Panel de control → http://localhost:${PORT}/panel.html`);
});

// ─── Kick Client ──────────────────────────────────────────────────────────────

const extractedToken =
  process.env.BEARER_TOKEN ??
  (COOKIES.match(/kick_session=([^;]+)/)?.[1] ?? "");
const extractedXsrf = COOKIES.match(/XSRF-TOKEN=([^;]+)/)?.[1] ?? "";

const client = createClient(CHANNEL_NAME, { logger: true });

// ─── Persistencia de Cola ─────────────────────────────────────────────────────

let videoQueue: VideoItem[] = [];

if (fs.existsSync(QUEUE_FILE)) {
  try {
    videoQueue = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8")) as VideoItem[];
    console.log(`📦 Cola cargada: ${videoQueue.length} videos`);
  } catch { videoQueue = []; }
}

function saveQueue(): void {
  const dir = path.dirname(QUEUE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(videoQueue, null, 2));
}

// ─── Socket.io — Conexiones ───────────────────────────────────────────────────

io.on("connection", (socket: Socket) => {
  socket.emit("syncQueue", videoQueue);

  // El overlay avanza la cola cuando termina un video
  socket.on("advanceQueue", () => {
    if (videoQueue.length > 0) {
      videoQueue.shift();
      saveQueue();
      io.emit("syncQueue", videoQueue);
    }
  });

  // ── Comandos del Panel de Control ─────────────────────────────────────────
  socket.on("panelCommand", (data: PanelCommand) => {
    if (PANEL_TOKEN && data.token !== PANEL_TOKEN) return;

    switch (data.command) {
      case "play":
        if (data.args) handlePlayCommand(data.args, "panel");
        break;

      case "skip":
        io.emit("nextVideo");
        break;

      case "tts":
        if (data.args) enqueueTTS(data.args, (data.voice as EdgeVoice) ?? "dalia");
        break;

      case "toggleVideo":
        io.emit("toggleVideo", { showVideo: data.show ?? true });
        break;

      case "removeFromQueue":
        if (typeof data.index === "number" && videoQueue[data.index]) {
          videoQueue.splice(data.index, 1);
          saveQueue();
          io.emit("syncQueue", videoQueue);
        }
        break;

      case "clearQueue":
        videoQueue = [];
        saveQueue();
        io.emit("syncQueue", videoQueue);
        break;
    }
  });
});

// ─── Kick Login ───────────────────────────────────────────────────────────────

client.login({
  type: "tokens",
  credentials: {
    bearerToken: decodeURIComponent(extractedToken),
    xXsrfToken: decodeURIComponent(extractedXsrf),
    cookies: COOKIES,
  },
}).then(() => console.log(`✅ Bot conectado al canal ${CHANNEL_NAME}!`));

// ─── Cola de TTS ──────────────────────────────────────────────────────────────

const ttsQueue: TtsItem[] = [];
let isTTSProcessing = false;

async function processTTSQueue(): Promise<void> {
  if (isTTSProcessing || ttsQueue.length === 0) return;

  isTTSProcessing = true;
  const item = ttsQueue.shift()!;

  try {
    await generateTTS(item.text, item.voice);
  } catch (err) {
    console.error("Error procesando TTS:", err);
  }

  isTTSProcessing = false;
  processTTSQueue();
}

function enqueueTTS(text: string, voice: string = "dalia"): void {
  ttsQueue.push({ text, voice });
  console.log(`[TTS] Cola: "${text.substring(0, 30)}..." (voz: ${voice})`);
  processTTSQueue();
}

// ─── TTS Principal ────────────────────────────────────────────────────────────

async function generateTTS(text: string, voice: string = "dalia"): Promise<void> {
  try {
    const res = await fetch(`${TTS_SERVER}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
    });

    if (res.ok) {
      const data = await res.json() as { audioBase64: string; cached: boolean };
      io.emit("speak", { audioBase64: data.audioBase64 });
      console.log(`[TTS OK] Edge TTS${data.cached ? " (caché)" : ""}: "${text.substring(0, 40)}..."`);
      return;
    }
    throw new Error(`Python server respondió ${res.status}`);
  } catch {
    console.warn("⚠️  Servidor Python no disponible. Usando gTTS...");
    await generateFallbackTTS(text);
  }
}

async function generateFallbackTTS(text: string): Promise<void> {
  return new Promise((resolve) => {
    const tempFile = path.join(ttsDir, `tts_${Date.now()}.mp3`);
    const gtts = new Gtts(text, "es");

    gtts.save(tempFile, (err: Error | null) => {
      if (err) { console.error("Error gTTS:", err); resolve(); return; }

      fs.readFile(tempFile, (readErr, data) => {
        if (!readErr) {
          io.emit("speak", { audioBase64: data.toString("base64") });
          console.log(`[TTS OK] gTTS: "${text.substring(0, 40)}..."`);
        }
        setTimeout(() => {
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        }, 3_000);
        resolve();
      });
    });
  });
}

// ─── Utilidades de YouTube ────────────────────────────────────────────────────

async function getFirstVideoIdFromPlaylist(
  url: string
): Promise<{ videoId: string; title: string } | null> {
  try {
    const listId = new URL(url).searchParams.get("list");
    if (!listId || listId.startsWith("RD")) return null;

    const apiKey = "AIzaSyBJRSpiY0bvQmjmJDdvUNPLRU_Z4YNCrRs";
    const endpoint = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=1&playlistId=${listId}&key=${apiKey}`;
    const res = await fetch(endpoint);
    const data = await res.json() as { items?: { snippet: { resourceId: { videoId: string }; title: string } }[] };

    if (data.items?.length) {
      return {
        videoId: data.items[0].snippet.resourceId.videoId,
        title: data.items[0].snippet.title,
      };
    }
    return null;
  } catch { return null; }
}

async function getVideoTitle(url: string): Promise<string> {
  try {
    const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
    const info = await res.json() as { title?: string };
    return info.title ?? "Video";
  } catch { return "Video"; }
}

// ─── Lógica de !play ──────────────────────────────────────────────────────────

async function handlePlayCommand(url: string, username: string): Promise<void> {
  console.log(`[PLAY] Solicitud de ${username}: ${url}`);

  // 1. Video directo
  const isDirectVideo = /\.(mp4|webm|mov|m4v)$/i.test(url.split("?")[0]);
  if (isDirectVideo) {
    const title = url.split("/").pop()?.split("?")[0] ?? "Video Directo";
    videoQueue.push({ url, title, user: username });
    saveQueue();
    io.emit("syncQueue", videoQueue);
    return;
  }

  // 2. YouTube
  try {
    let videoId: string | null = null;
    let title = "Video de YouTube";

    if (url.includes("list=")) {
      const info = await getFirstVideoIdFromPlaylist(url);
      if (info) { videoId = info.videoId; title = info.title; }
    }

    if (!videoId) {
      const match = url.match(
        /(?:youtu\.be\/|youtube\.com\/(?:.*v=|.*\/|.*embed\/|.*shorts\/|.*watch\?v=))([^?&"'>\s]+)/
      );
      videoId = match?.[1] ?? null;
      if (videoId) title = await getVideoTitle(url);
    }

    if (videoId) {
      videoQueue.push({ videoId, title, user: username });
      saveQueue();
      console.log(`📡 En cola: ${title} (${videoId})`);
      io.emit("syncQueue", videoQueue);
    } else {
      console.warn(`⚠️  No se pudo extraer ID de YouTube: ${url}`);
    }
  } catch (err) {
    console.error("❌ Error en !play:", err);
  }
}

// ─── Manejador de Mensajes de Chat ────────────────────────────────────────────

client.on("ChatMessage", async (message: unknown) => {
  const msg = message as { content: string; sender: { username: string } };
  const content: string = msg.content.trim();
  const username: string = msg.sender.username;
  const isOwner = username.toLowerCase() === CHANNEL_NAME.toLowerCase();

  io.emit("chatMessage", { user: username, content });

  // Comandos exclusivos del owner
  const cmd = content.toLowerCase();
  if (isOwner) {
    if (cmd === "!von") { io.emit("toggleVideo", { showVideo: true }); return; }
    if (cmd === "!voff") { io.emit("toggleVideo", { showVideo: false }); return; }
    if (cmd === "!next") { io.emit("nextVideo"); return; }
  }

  // !play
  if (content.startsWith("!play ")) {
    await handlePlayCommand(content.slice(6).trim(), username);
    return;
  }

  // Comandos de voz
  const [cmdWord, ...rest] = content.split(" ");
  const text = rest.join(" ").trim();
  if (!text) return;

  if (cmdWord.toLowerCase() === "!s") {
    enqueueTTS(text, "dalia");
    return;
  }

  if (cmdWord.startsWith("!") && cmdWord.length > 1) {
    const voiceName = cmdWord.slice(1).toLowerCase();
    if ((EDGE_VOICES as readonly string[]).includes(voiceName)) {
      enqueueTTS(text, voiceName);
    }
  }
});
