use crate::AppState;
use std::sync::Arc;
use tracing::{info, warn};

/// Envía un mensaje al chat del canal.
pub async fn send(text: &str, state: &Arc<AppState>) {
    // channel_id = broadcaster_user_id (API oficial)
    // chatroom_id = para la API legacy
    let (channel_id, chatroom_id) = {
        let ch  = *state.channel_id.read().await;
        let cr  = *state.chatroom_id.read().await;
        match (ch, cr) {
            (Some(c), Some(r)) => (c, r),
            _ => {
                warn!("[Chat] IDs del canal no disponibles aún");
                return;
            }
        }
    };

    let bearer = {
        let tok = state.access_token.read().await;
        if !tok.is_empty() { tok.clone() } else { state.config.bearer_token.clone() }
    };

    if bearer.is_empty() {
        warn!("[Chat] Sin token de autenticación para enviar mensajes");
        return;
    }

    // Intentar API oficial; si devuelve 401 → renovar token y reintentar una vez
    match try_send_official(text, channel_id, &bearer, state).await {
        Ok(_)    => return,
        Err(true) => {
            // 401 — renovar token y reintentar
            warn!("[Chat] 401 en API oficial — renovando token...");
            if super::refresh_access_token(state).await {
                let new_bearer = state.access_token.read().await.clone();
                if try_send_official(text, channel_id, &new_bearer, state).await.is_ok() {
                    return;
                }
            }
        }
        Err(false) => {} // otro error — caer al legacy
    }

    // Fallback: API legacy de kick.com
    try_send_legacy(text, chatroom_id, &bearer, state).await;
}

/// Ok(()) = enviado. Err(true) = 401. Err(false) = otro error.
async fn try_send_official(
    text: &str,
    broadcaster_user_id: u64,
    bearer: &str,
    state: &Arc<AppState>,
) -> Result<(), bool> {
    let body = serde_json::json!({
        "broadcaster_user_id": broadcaster_user_id,
        "content": text,
        "type": "user",
    });

    let r = state.http
        .post("https://api.kick.com/public/v1/chat")
        .header("Authorization", format!("Bearer {bearer}"))
        .header("Content-Type",  "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| { warn!("[Chat][official] Error de red: {e}"); false })?;

    let status = r.status();
    if status.is_success() {
        info!("[Chat] ← \"{}\"", &text[..text.len().min(60)]);
        return Ok(());
    }

    let is_401 = status.as_u16() == 401;
    let body   = r.text().await.unwrap_or_default();
    warn!("[Chat][official] {status}: {body}");
    Err(is_401)
}

async fn try_send_legacy(text: &str, chatroom_id: u64, bearer: &str, state: &Arc<AppState>) {
    let cfg  = &state.config;
    let body = serde_json::json!({
        "chatroom_id": chatroom_id,
        "content":     text,
        "type":        "message",
    });

    let mut req = state.http
        .post("https://kick.com/api/v2/messages")
        .header("Authorization", format!("Bearer {bearer}"))
        .header("Content-Type",  "application/json")
        .header("Referer",       format!("https://kick.com/{}", cfg.channel_name))
        .header("Origin",        "https://kick.com");

    if cfg.access_token.is_empty() {
        req = req
            .header("Cookie",        &cfg.cookies)
            .header("X-XSRF-TOKEN",  &cfg.xsrf_token);
    }

    match req.json(&body).send().await {
        Ok(r) if r.status().is_success() => {
            info!("[Chat] ← \"{}\" (legacy)", &text[..text.len().min(60)]);
        }
        Ok(r) => {
            let status = r.status();
            let body   = r.text().await.unwrap_or_default();
            warn!("[Chat][legacy] {status}: {body}");
        }
        Err(e) => warn!("[Chat][legacy] Error de red: {e}"),
    }
}
