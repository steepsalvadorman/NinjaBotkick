use crate::AppState;
use std::sync::{atomic::Ordering, Arc};
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};
use tokio::time::{interval, Duration};

/// Emite CPU/RAM y followGoal cada 2s.
/// El conteo de followers ya no se obtiene por polling —
/// lo actualiza kick/mod.rs en tiempo real vía Pusher.
pub fn start(io: socketioxide::SocketIo, state: Arc<AppState>) {
    let config = state.config.clone();

    tokio::spawn(async move {
        let mut sys = System::new_with_specifics(
            RefreshKind::new()
                .with_cpu(CpuRefreshKind::everything())
                .with_memory(MemoryRefreshKind::everything()),
        );

        // Baseline para el primer delta de CPU
        sys.refresh_cpu_all();
        tokio::time::sleep(Duration::from_millis(250)).await;

        let mut ticker = interval(Duration::from_secs(2));

        loop {
            ticker.tick().await;

            sys.refresh_specifics(
                RefreshKind::new()
                    .with_cpu(CpuRefreshKind::everything())
                    .with_memory(MemoryRefreshKind::everything()),
            );

            let cpu   = sys.global_cpu_usage();
            let total = sys.total_memory();
            let used  = sys.used_memory();
            let ram   = if total > 0 { (used as f64 / total as f64) * 100.0 } else { 0.0 };

            io.emit("sysStats", serde_json::json!({
                "cpu": format!("{:.0}", cpu),
                "ram": format!("{:.1}", ram),
            })).ok();

            // Leer el contador que Pusher actualiza en tiempo real
            let followers = state.followers.load(Ordering::Relaxed);
            io.emit("followGoal", serde_json::json!({
                "current": followers,
                "goal":    config.follow_goal,
            })).ok();
        }
    });
}
