use crate::{commands, tts, AppState};
use socketioxide::extract::SocketRef;
use std::sync::Arc;
use tracing::info;

#[derive(serde::Deserialize)]
struct PanelCmd {
    command: String,
    args:    Option<String>,
    voice:   Option<String>,
    show:    Option<bool>,
    index:   Option<usize>,
    token:   Option<String>,
}

pub fn setup(io: &socketioxide::SocketIo, state: Arc<AppState>) {
    io.ns("/", move |socket: SocketRef| {
        let state = state.clone();
        let s2    = socket.clone();

        info!("Widget conectado: {}", socket.id);

        // Enviar cola actual al conectar
        let st = state.clone();
        tokio::spawn(async move {
            let q = st.video_queue.read().await;
            s2.emit("syncQueue", &q.items).ok();
        });

        // El overlay avanza la cola cuando termina un video
        let st = state.clone();
        socket.on("advanceQueue", move |_: SocketRef| {
            let st = st.clone();
            async move {
                let mut q = st.video_queue.write().await;
                q.advance();
                let items = q.items.clone();
                drop(q);
                st.io.emit("syncQueue", &items).ok();
            }
        });

        // Comandos desde el panel de control
        let st = state.clone();
        socket.on("panelCommand", move |_: SocketRef, socketioxide::extract::Data(data): socketioxide::extract::Data<PanelCmd>| {
            let st = st.clone();
            async move {
                // Validar token (si PANEL_TOKEN está configurado)
                let panel_token = &st.config.panel_token;
                if !panel_token.is_empty() {
                    if data.token.as_deref() != Some(panel_token.as_str()) {
                        return;
                    }
                }

                match data.command.as_str() {
                    "play" => {
                        if let Some(url) = data.args {
                            commands::play(url, "panel".into(), &st).await;
                        }
                    }
                    "skip" => { st.io.emit("nextVideo", serde_json::json!({})).ok(); }
                    "tts"  => {
                        if let Some(text) = data.args {
                            let voice = data.voice.unwrap_or_else(|| "dalia".into());
                            st.tts_tx.send(tts::TtsQueueItem { text, voice }).ok();
                        }
                    }
                    "toggleVideo" => {
                        st.io.emit("toggleVideo", serde_json::json!({"showVideo": data.show.unwrap_or(true)})).ok();
                    }
                    "removeFromQueue" => {
                        if let Some(idx) = data.index {
                            let mut q = st.video_queue.write().await;
                            q.remove(idx);
                            let items = q.items.clone();
                            drop(q);
                            st.io.emit("syncQueue", &items).ok();
                        }
                    }
                    "clearQueue" => {
                        let mut q = st.video_queue.write().await;
                        q.clear();
                        drop(q);
                        st.io.emit("syncQueue", &Vec::<()>::new()).ok();
                    }
                    _ => {}
                }
            }
        });
    });
}
