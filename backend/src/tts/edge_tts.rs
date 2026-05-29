// Usa el CLI de edge-tts (Python) como subprocess.
// Más confiable que reimplementar el protocolo WebSocket de Microsoft,
// que cambia su autenticación frecuentemente.

use uuid::Uuid;

pub const VOICES: &[(&str, &str)] = &[
    ("dalia",   "es-MX-DaliaNeural"),
    ("jorge",   "es-MX-JorgeNeural"),
    ("camila",  "es-PE-CamilaNeural"),
    ("alex",    "es-PE-AlexNeural"),
    ("jacinta", "es-PE-CamilaNeural"),
];

pub fn voice_name(id: &str) -> &'static str {
    VOICES.iter()
        .find(|(k, _)| *k == id)
        .map(|(_, v)| *v)
        .unwrap_or("es-PE-CamilaNeural")
}

pub fn is_valid_voice(id: &str) -> bool {
    VOICES.iter().any(|(k, _)| *k == id)
}

/// Sintetiza texto usando el CLI `edge-tts` de Python y devuelve bytes MP3.
pub async fn synthesize(text: &str, voice_id: &str) -> Result<Vec<u8>, String> {
    let vname = voice_name(voice_id);
    let tmp   = format!("/tmp/tts_{}.mp3", Uuid::new_v4());

    let out = tokio::process::Command::new("edge-tts")
        .args(["--voice", vname, "--text", text, "--write-media", &tmp])
        .output()
        .await
        .map_err(|e| format!("edge-tts spawn: {e}"))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("edge-tts: {err}"));
    }

    let bytes = tokio::fs::read(&tmp).await
        .map_err(|e| format!("edge-tts leer salida: {e}"))?;

    let _ = tokio::fs::remove_file(&tmp).await;

    if bytes.is_empty() {
        return Err("edge-tts: archivo de salida vacío".to_string());
    }

    Ok(bytes)
}
