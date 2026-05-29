use crate::{queue::VideoItem, tts, AppState};
use serde_json::json;
use std::sync::Arc;
use tracing::{info, warn};

const YT_API_KEY: &str = "AIzaSyBJRSpiY0bvQmjmJDdvUNPLRU_Z4YNCrRs";

/// Punto de entrada — llamado desde kick/mod.rs y desde panelCommand.
pub async fn handle(username: &str, content: &str, state: &Arc<AppState>) {
    let is_owner = username.eq_ignore_ascii_case(&state.config.channel_name);
    let cmd = content.to_lowercase();

    // ── Owner ──────────────────────────────────────────────────────────────────
    if is_owner {
        match cmd.as_str() {
            "!von" => {
                info!("[CMD] {username}: !von");
                state.io.emit("toggleVideo", json!({"showVideo": true})).ok();
                return;
            }
            "!voff" => {
                info!("[CMD] {username}: !voff");
                state.io.emit("toggleVideo", json!({"showVideo": false})).ok();
                return;
            }
            "!vstop" => {
                info!("[CMD] {username}: !vstop");
                let mut q = state.video_queue.write().await;
                q.clear();
                drop(q);
                state.io.emit("syncQueue", json!({"items": []})).ok();
                return;
            }
            "!next" | "!skip" => {
                info!("[CMD] {username}: !next");
                state.io.emit("nextVideo", json!({})).ok();
                return;
            }
            _ => {}
        }
    }

    // ── Comandos informativos (cualquiera del chat) ───────────────────────────
    {
        use crate::kick::sender;
        let cfg = &state.config;
        match cmd.as_str() {
            "!discord" => {
                if !cfg.cmd_discord.is_empty() {
                    sender::send(&format!("💬 Discord → {}", cfg.cmd_discord), state).await;
                }
                return;
            }
            "!redes" | "!rrss" | "!rss" => {
                if !cfg.cmd_redes.is_empty() {
                    sender::send(&format!("📱 Redes → {}", cfg.cmd_redes), state).await;
                }
                return;
            }
            "!pc" | "!setup" | "!specs" => {
                if !cfg.cmd_pc.is_empty() {
                    sender::send(&format!("🖥️ Setup → {}", cfg.cmd_pc), state).await;
                }
                return;
            }
            "!horario" | "!schedule" => {
                if !cfg.cmd_horario.is_empty() {
                    sender::send(&format!("📅 Horario → {}", cfg.cmd_horario), state).await;
                }
                return;
            }
            "!comandos" | "!help" | "!ayuda" | "!commands" => {
                sender::send(
                    "📋 Comandos: !play [url] · !s [texto] · !discord · !redes · !pc · !horario · !dado · !8ball [pregunta] · !sorteo · !uptime · !cola",
                    state,
                ).await;
                return;
            }
            _ => {}
        }
    }

    // ── Comandos dinámicos ────────────────────────────────────────────────────
    {
        use crate::kick::sender;
        use std::sync::atomic::Ordering;

        match cmd.as_str() {
            "!uptime" => {
                let secs  = state.start_time.elapsed().as_secs();
                let horas = secs / 3600;
                let mins  = (secs % 3600) / 60;
                let msg   = if horas > 0 {
                    format!("⏱️ Llevamos {horas}h {mins}m en vivo")
                } else {
                    format!("⏱️ Llevamos {mins}m en vivo")
                };
                sender::send(&msg, state).await;
                return;
            }
            "!cola" | "!queue" => {
                let q = state.video_queue.read().await;
                let msg = if q.items.is_empty() {
                    "📭 La cola de videos está vacía".to_string()
                } else {
                    let lista: Vec<String> = q.items.iter().enumerate()
                        .take(5)
                        .map(|(i, v)| format!("{}. {}", i + 1, v.title))
                        .collect();
                    let extra = if q.items.len() > 5 {
                        format!(" (+{} más)", q.items.len() - 5)
                    } else {
                        String::new()
                    };
                    format!("🎬 Cola: {}{}", lista.join(" · "), extra)
                };
                sender::send(&msg, state).await;
                return;
            }
            "!seguidores" | "!followers" | "!seguidos" => {
                let actual = state.followers.load(Ordering::Relaxed);
                let meta   = state.config.follow_goal;
                let pct    = if meta > 0 { actual * 100 / meta } else { 0 };
                sender::send(
                    &format!("👥 Seguidores: {actual} / {meta} ({pct}%)"),
                    state,
                ).await;
                return;
            }
            _ => {}
        }
    }

    // ── Entretenimiento ───────────────────────────────────────────────────────
    {
        use crate::kick::sender;
        use rand::Rng;
        use rand::seq::SliceRandom;

        // !dado
        if cmd == "!dado" {
            let n: u8 = rand::thread_rng().gen_range(1..=100);
            sender::send(&format!("🎲 {username} sacó un {n}!"), state).await;
            return;
        }

        // !8ball [pregunta]
        if cmd == "!8ball" || cmd.starts_with("!8ball ") {
            const RESPUESTAS: &[&str] = &[
                "Sí, definitivamente 🟢", "Es cierto 🟢", "Sin duda 🟢",
                "Por supuesto 🟢", "Puedes contar con ello 🟢",
                "Probablemente sí 🟡", "Perspectivas favorables 🟡",
                "Las señales apuntan al sí 🟡",
                "No lo sé, pregunta más tarde 🔵", "Concéntrate y pregunta de nuevo 🔵",
                "Mejor no te digo ahora 🔵", "Difícil de decir 🔵",
                "No cuentes con ello 🔴", "Mi respuesta es no 🔴",
                "Las perspectivas no son buenas 🔴", "Muy dudoso 🔴",
            ];
            let resp = RESPUESTAS.choose(&mut rand::thread_rng()).unwrap_or(&"Quizás");
            sender::send(&format!("🎱 {resp}"), state).await;
            return;
        }

        // !sorteo
        if cmd == "!sorteo" || cmd.starts_with("!sorteo ") || cmd == "!participar" || cmd == "!entrar" {
            let sub = if cmd == "!participar" || cmd == "!entrar" {
                ""
            } else {
                cmd.strip_prefix("!sorteo").unwrap_or("").trim()
            };

            match sub {
                "abrir" | "open" | "start" if is_owner => {
                    let mut s = state.sorteo.lock().await;
                    s.open = true;
                    s.participants.clear();
                    drop(s);
                    sender::send("🎟️ ¡El sorteo está abierto! Escribe !sorteo o !participar para unirte", state).await;
                }
                "cerrar" | "close" | "stop" if is_owner => {
                    let mut s = state.sorteo.lock().await;
                    s.open = false;
                    let count = s.participants.len();
                    drop(s);
                    sender::send(&format!("🔒 Sorteo cerrado. {count} participantes registrados"), state).await;
                }
                "ganador" | "winner" | "resultado" if is_owner => {
                    let mut s = state.sorteo.lock().await;
                    s.open = false;
                    let winner = s.participants.choose(&mut rand::thread_rng()).cloned();
                    drop(s);
                    match winner {
                        Some(w) => sender::send(&format!("🏆 ¡¡El ganador del sorteo es @{w}!! 🎉🎉🎉"), state).await,
                        None    => sender::send("😅 No hay participantes en el sorteo", state).await,
                    }
                }
                "" => {
                    let mut s = state.sorteo.lock().await;
                    if !s.open { return; }
                    if s.participants.iter().any(|p| p.eq_ignore_ascii_case(username)) {
                        return;
                    }
                    s.participants.push(username.to_string());
                    let count = s.participants.len();
                    drop(s);
                    sender::send(&format!("✅ @{username} se unió al sorteo! ({count} participantes)"), state).await;
                }
                _ => {}
            }
            return;
        }
    }

    // ── !play ──────────────────────────────────────────────────────────────────
    if let Some(url) = content.strip_prefix("!play ") {
        play(url.trim().to_string(), username.to_string(), state).await;
        return;
    }

    // ── Voz ────────────────────────────────────────────────────────────────────
    let Some((cmd_word, rest)) = content.split_once(' ') else { return };
    let text = rest.trim();
    if text.is_empty() { return; }

    let cmd_low = cmd_word.to_lowercase();
    if cmd_low == "!s" {
        state.tts_tx.send(tts::TtsQueueItem { text: text.into(), voice: "camila".into() }).ok();
        return;
    }

    if let Some(voice) = cmd_low.strip_prefix('!') {
        if tts::edge_tts::is_valid_voice(voice) {
            state.tts_tx.send(tts::TtsQueueItem { text: text.into(), voice: voice.into() }).ok();
        }
    }
}

/// Lógica de !play: YouTube, playlist, video directo.
pub async fn play(url: String, username: String, state: &Arc<AppState>) {
    info!("[PLAY] {username}: {url}");

    // 1. Video directo
    if is_direct_video(&url) {
        let title = url.split('/').next_back()
            .and_then(|s| s.split('?').next())
            .unwrap_or("Video Directo")
            .to_string();
        enqueue(VideoItem { video_id: None, url: Some(url), title, user: username }, state).await;
        return;
    }

    // 2. YouTube playlist
    if url.contains("list=") {
        if let Some((vid, title)) = first_from_playlist(&state.http, &url).await {
            enqueue(VideoItem { video_id: Some(vid), url: None, title, user: username }, state).await;
            return;
        }
    }

    // 3. YouTube individual
    if let Some(vid) = yt_id(&url) {
        let title = yt_title(&state.http, &url).await;
        enqueue(VideoItem { video_id: Some(vid), url: None, title, user: username }, state).await;
    } else {
        warn!("[PLAY] No se pudo extraer ID: {url}");
    }
}

async fn enqueue(item: VideoItem, state: &Arc<AppState>) {
    let title = item.title.clone();
    let mut q = state.video_queue.write().await;
    q.push(item);
    let items = q.items.clone();
    drop(q);
    info!("[PLAY] Cola: {title}");
    state.io.emit("syncQueue", serde_json::json!({"items": &items})).ok();
}

fn is_direct_video(url: &str) -> bool {
    let path = url.split('?').next().unwrap_or(url).to_lowercase();
    matches!(
        std::path::Path::new(&path).extension().and_then(|e| e.to_str()),
        Some("mp4" | "webm" | "mov" | "m4v")
    )
}

fn yt_id(url: &str) -> Option<String> {
    for sep in &["youtu.be/", "?v=", "&v=", "/embed/", "/shorts/", "/watch?v="] {
        if let Some(pos) = url.find(sep) {
            let id: String = url[pos + sep.len()..]
                .chars()
                .take_while(|c| !matches!(c, '?' | '&' | '"' | '\'' | '>' | ' '))
                .collect();
            if id.len() >= 8 { return Some(id); }
        }
    }
    None
}

async fn first_from_playlist(http: &reqwest::Client, url: &str) -> Option<(String, String)> {
    let list_id = url.split("list=").nth(1)?.split('&').next()?;
    if list_id.starts_with("RD") { return None; }
    let api = format!(
        "https://www.googleapis.com/youtube/v3/playlistItems\
         ?part=snippet&maxResults=1&playlistId={list_id}&key={YT_API_KEY}"
    );
    let json: serde_json::Value = http.get(&api).send().await.ok()?.json().await.ok()?;
    let item = json["items"].as_array()?.first()?;
    let vid   = item["snippet"]["resourceId"]["videoId"].as_str()?.to_string();
    let title = item["snippet"]["title"].as_str().unwrap_or("Video").to_string();
    Some((vid, title))
}

async fn yt_title(http: &reqwest::Client, url: &str) -> String {
    let enc: String = url.bytes().flat_map(|b| {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            vec![b as char]
        } else {
            format!("%{b:02X}").chars().collect()
        }
    }).collect();
    let api = format!("https://noembed.com/embed?url={enc}");
    http.get(&api).send().await.ok()
        .and_then(|r| tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(r.json::<serde_json::Value>()).ok()
        }))
        .and_then(|v| v["title"].as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "Video de YouTube".to_string())
}
