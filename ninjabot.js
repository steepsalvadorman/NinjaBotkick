import { createClient } from "@retconned/kick-js";
import dotenv from "dotenv";
import WebSocket from "ws";
import fs from "fs";
import path from "path";
import Gtts from "gtts"; 
import fetch from "node-fetch";

dotenv.config();

const ttsDir = path.join('.', 'tts');
if (!fs.existsSync(ttsDir)) fs.mkdirSync(ttsDir);

const client = createClient("seniordai", { logger: true });
const wss = new WebSocket.Server({ port: 3000 });

wss.on("connection", ws => console.log("✅ Widget conectado a WebSocket"));

client.login({
  type: "tokens",
  credentials: {
    bearerToken: process.env.BEARER_TOKEN || "",
    cookies: process.env.COOKIES,
  },
}).then(() => console.log("✅ Bot conectado usando cookies!"));

// Obtener primer video de playlist válida (no mix RD)
async function getFirstVideoIdFromPlaylist(url) {
  try {
    const listId = new URL(url).searchParams.get("list");
    if (!listId || listId.startsWith("RD")) return null; // Ignorar mixes
    const apiKey = 'AIzaSyBJRSpiY0bvQmjmJDdvUNPLRU_Z4YNCrRs';
    const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=1&playlistId=${listId}&key=${apiKey}`);
    const data = await res.json();
    if (data.items && data.items.length > 0) {
      return { videoId: data.items[0].snippet.resourceId.videoId, title: data.items[0].snippet.title };
    }
    return null;
  } catch(e) {
    console.error(e);
    return null;
  }
}

client.on("ChatMessage", async message => {
  const content = message.content.trim();
  const username = message.sender.username;
  const isOwner = username.toLowerCase() === "seniordai";

  // !von / !voff
  if (isOwner && (content === "!von" || content === "!voff")) {
    const showVideo = content === "!von";
    wss.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "toggleVideo", showVideo }));
    });
  }

 // !next
if (isOwner && content === "!next") {
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: "nextVideo", ownerCommand: true }));
  });
}




// Función para actualizar contador
function updateQueueCount() {
  const count = queue.length;
  queueCount.textContent = count > 0 ? `📥 ${count} en cola` : "";
}

  // !sr Song Request
if (content.startsWith("!sr ")) {
  const url = content.slice(4).trim();
  let videoData = null;

  // Extraer videoId del enlace
  const videoIdFromUrl = url.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/)?.[1];
  if (!videoIdFromUrl) return; // URL inválida

  // Intentar playlist válida primero
  if (url.includes("?list=")) {
    const firstFromPlaylist = await getFirstVideoIdFromPlaylist(url);
    if (firstFromPlaylist) {
      videoData = firstFromPlaylist;
    } else {
      // Mix RD → tomar primer video y obtener título con noembed
      try {
        const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
        const info = await res.json();
        videoData = { videoId: videoIdFromUrl, title: info.title || "Video de Mix" };
      } catch {
        videoData = { videoId: videoIdFromUrl, title: "Video de Mix" };
      }
    }
  } else {
    // Video individual
    try {
      const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
      const info = await res.json();
      videoData = { videoId: videoIdFromUrl, title: info.title || "Video" };
    } catch {
      videoData = { videoId: videoIdFromUrl, title: "Video" };
    }
  }

  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: "songRequest", videoId: videoData.videoId, title: videoData.title, user: username }));
  });
}


  // !s Speak
  if (content.startsWith("!s ")) {
    const text = content.slice(3);
    const ttsFile = path.join(ttsDir, `${Date.now()}.mp3`);
    const speech = new Gtts(`${username} dice: ${text}`, 'es');

    speech.save(ttsFile, err => {
      if (err) return console.error(err);
      fs.readFile(ttsFile, (err, data) => {
        if (err) return console.error(err);
        const audioBase64 = data.toString('base64');
        wss.clients.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: "speak", audioBase64 }));
        });
        fs.unlink(ttsFile, () => {});
      });
    });
  }
});
