mod commands;
mod config;
mod kick;
mod queue;
mod server;
mod stats;
mod tts;

use config::Config;
use queue::VideoQueue;
use socketioxide::SocketIo;
use std::sync::{
    atomic::AtomicU64,
    Arc,
};
use tokio::sync::{mpsc, RwLock};
use tower_http::services::ServeDir;
use tracing::info;
use tracing_subscriber::EnvFilter;

pub struct AppState {
    pub config:       Config,
    pub video_queue:  Arc<RwLock<VideoQueue>>,
    pub io:           SocketIo,
    pub tts_tx:       mpsc::UnboundedSender<tts::TtsQueueItem>,
    pub http:         reqwest::Client,
    /// channel_id del canal (broadcaster_user_id para la API oficial de chat)
    pub channel_id:   Arc<RwLock<Option<u64>>>,
    /// chatroom_id del canal (para la API legacy y Pusher)
    pub chatroom_id:  Arc<RwLock<Option<u64>>>,
    /// Contador de seguidores actualizado por Pusher en tiempo real
    pub followers:    Arc<AtomicU64>,
    /// Token OAuth activo (se puede renovar sin reiniciar)
    pub access_token:      Arc<RwLock<String>>,
    pub refresh_token_val: Arc<RwLock<String>>,
}

#[tokio::main]
async fn main() {
    let _ = dotenvy::from_path("../.env");

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = Config::from_env().unwrap_or_else(|e| {
        eprintln!("\n{e}\n");
        std::process::exit(1);
    });

    let video_queue = Arc::new(RwLock::new(VideoQueue::load(&config.queue_file)));
    let (layer, io) = SocketIo::new_layer();

    let tts_svc = Arc::new(tts::TtsService::new(&config.tts_cache_dir));
    let (tts_tx, tts_rx) = mpsc::unbounded_channel::<tts::TtsQueueItem>();
    tts::spawn_processor(tts_svc, tts_rx, io.clone());

    let state = Arc::new(AppState {
        access_token:      Arc::new(RwLock::new(config.access_token.clone())),
        refresh_token_val: Arc::new(RwLock::new(config.refresh_token.clone())),
        config: config.clone(),
        video_queue,
        io: io.clone(),
        tts_tx,
        http: reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0")
            .build()
            .unwrap(),
        channel_id:  Arc::new(RwLock::new(None)),
        chatroom_id: Arc::new(RwLock::new(None)),
        followers:   Arc::new(AtomicU64::new(config.current_followers)),
    });

    // Renovar token automáticamente antes de que expire
    tokio::spawn(kick::token_refresh_loop(state.clone(), config.token_expires));

    server::setup(&io, state.clone());
    stats::start(io.clone(), state.clone());
    tokio::spawn(kick::run(state.clone()));

    let overlay_dir = config.overlay_dir.clone();
    let app = axum::Router::new()
        .nest_service("/", ServeDir::new(&overlay_dir))
        .layer(layer);

    let addr = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    info!("DaiBot corriendo  → http://localhost:{}", config.port);
    info!("Panel de control  → http://localhost:{}/panel.html", config.port);

    axum::serve(listener, app).await.unwrap();
}
