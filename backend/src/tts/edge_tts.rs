// Implementación del protocolo Edge TTS de Microsoft directamente en Rust.
// Replica lo que hace la librería edge-tts de Python: conexión WebSocket
// a speech.platform.bing.com, envío de SSML, recepción de MP3.

use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::warn;
use uuid::Uuid;

const TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const ENDPOINT: &str =
    "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

pub const VOICES: &[(&str, &str)] = &[
    ("dalia",  "es-MX-DaliaNeural"),
    ("jorge",  "es-MX-JorgeNeural"),
    ("camila", "es-PE-CamilaNeural"),
    ("alex",   "es-PE-AlexNeural"),
];

pub fn voice_name(id: &str) -> &'static str {
    VOICES.iter()
        .find(|(k, _)| *k == id)
        .map(|(_, v)| *v)
        .unwrap_or("es-MX-DaliaNeural")
}

pub fn is_valid_voice(id: &str) -> bool {
    VOICES.iter().any(|(k, _)| *k == id)
}

/// Sintetiza `text` con `voice_id` y devuelve el audio en bytes MP3.
pub async fn synthesize(text: &str, voice_id: &str) -> Result<Vec<u8>, String> {
    let conn_id = Uuid::new_v4().to_string().replace('-', "");
    let req_id  = Uuid::new_v4().to_string().replace('-', "");
    let ts      = timestamp();
    let vname   = voice_name(voice_id);

    let url = format!("{ENDPOINT}?TrustedClientToken={TOKEN}&ConnectionId={conn_id}");

    let (ws, _) = connect_async(&url)
        .await
        .map_err(|e| format!("Edge TTS connect: {e}"))?;

    let (mut tx, mut rx) = ws.split();

    // ── 1. Config ──────────────────────────────────────────────────────────────
    let config = format!(
        "X-Timestamp:{ts}\r\n\
         Content-Type:application/json; charset=utf-8\r\n\
         Path:speech.config\r\n\r\n\
         {{\"context\":{{\"synthesis\":{{\"audio\":{{\"metadataoptions\":\
         {{\"sentenceBoundaryEnabled\":false,\"wordBoundaryEnabled\":false}},\
         \"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}}}}}",
    );
    tx.send(Message::Text(config)).await.map_err(|e| format!("Config send: {e}"))?;

    // ── 2. SSML ────────────────────────────────────────────────────────────────
    let ssml = format!(
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='es'>\
         <voice name='{vname}'>{}</voice></speak>",
        escape_xml(text)
    );
    let ssml_msg = format!(
        "X-RequestId:{req_id}\r\n\
         Content-Type:application/ssml+xml\r\n\
         X-Timestamp:{ts}\r\n\
         Path:ssml\r\n\r\n{ssml}",
    );
    tx.send(Message::Text(ssml_msg)).await.map_err(|e| format!("SSML send: {e}"))?;

    // ── 3. Recolectar chunks de audio ─────────────────────────────────────────
    let mut audio: Vec<u8> = Vec::new();

    while let Some(msg) = rx.next().await {
        match msg {
            Ok(Message::Binary(data)) => {
                if let Some(chunk) = extract_audio(&data) {
                    audio.extend_from_slice(chunk);
                }
            }
            Ok(Message::Text(t)) if t.contains("Path:turn.end") => break,
            Ok(Message::Close(_)) => break,
            Err(e) => { warn!("Edge TTS WS error: {e}"); break; }
            _ => {}
        }
    }

    if audio.is_empty() {
        return Err("Edge TTS: no se recibió audio".to_string());
    }
    Ok(audio)
}

/// Extrae los bytes de audio del mensaje binario de Pusher/Edge TTS.
/// Formato: [2 bytes big-endian = header_len][header...][audio...]
fn extract_audio(data: &[u8]) -> Option<&[u8]> {
    if data.len() < 2 { return None; }
    let hlen = u16::from_be_bytes([data[0], data[1]]) as usize;
    let start = 2 + hlen;
    if data.len() <= start { return None; }
    let header = std::str::from_utf8(&data[2..start]).ok()?;
    if header.contains("Path:audio") {
        Some(&data[start..])
    } else {
        None
    }
}

fn timestamp() -> String {
    use chrono::Utc;
    Utc::now().format("%a %b %d %Y %H:%M:%S GMT+0000 (Coordinated Universal Time)").to_string()
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
     .replace('"', "&quot;")
     .replace('\'', "&apos;")
}
