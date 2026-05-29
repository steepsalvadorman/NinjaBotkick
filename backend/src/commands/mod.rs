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
            "!von"  => { state.io.emit("toggleVideo", json!({"showVideo":true})).ok();  return; }
            "!voff" => { state.io.emit("toggleVideo", json!({"showVideo":false})).ok(); return; }
            "!next" => { state.io.emit("nextVideo", json!({})).ok();                     return; }
            _ => {}
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
        state.tts_tx.send(tts::TtsQueueItem { text: text.into(), voice: "dalia".into() }).ok();
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
    state.io.emit("syncQueue", &items).ok();
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
