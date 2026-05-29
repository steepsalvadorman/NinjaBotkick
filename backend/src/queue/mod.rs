use serde::{Deserialize, Serialize};
use std::fs;
use tracing::{error, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_id: Option<String>,   // → "videoId" en JSON
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub title: String,
    pub user: String,
}

#[derive(Debug)]
pub struct VideoQueue {
    pub items: Vec<VideoItem>,
    queue_file: String,
}

impl VideoQueue {
    pub fn load(queue_file: &str) -> Self {
        let items: Vec<VideoItem> = fs::read_to_string(queue_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();

        if !items.is_empty() {
            info!("Cola cargada: {} videos", items.len());
        }
        Self { items, queue_file: queue_file.to_string() }
    }

    pub fn push(&mut self, item: VideoItem) {
        self.items.push(item);
        self.save();
    }

    pub fn advance(&mut self) {
        if !self.items.is_empty() {
            self.items.remove(0);
            self.save();
        }
    }

    pub fn remove(&mut self, index: usize) {
        if index < self.items.len() {
            self.items.remove(index);
            self.save();
        }
    }

    pub fn clear(&mut self) {
        self.items.clear();
        self.save();
    }

    pub fn save(&self) {
        if let Some(parent) = std::path::Path::new(&self.queue_file).parent() {
            let _ = fs::create_dir_all(parent);
        }
        match serde_json::to_string_pretty(&self.items) {
            Ok(json) => { if let Err(e) = fs::write(&self.queue_file, json) { error!("Error guardando cola: {e}"); } }
            Err(e) => error!("Error serializando cola: {e}"),
        }
    }
}
