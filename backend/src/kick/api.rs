use tracing::warn;

#[derive(Debug, Clone)]
pub struct ChannelInfo {
    pub channel_id: u64,
    pub chatroom_id: u64,
    pub slug: String,
}

/// Obtiene IDs del canal desde la API pública de Kick.
pub async fn get_channel_info(http: &reqwest::Client, channel: &str) -> Option<ChannelInfo> {
    let url = format!("https://kick.com/api/v1/channels/{channel}");
    let resp = http.get(&url).send().await.ok()?;

    if !resp.status().is_success() {
        warn!("Kick API {channel}: {}", resp.status());
        return None;
    }

    let json: serde_json::Value = resp.json().await.ok()?;

    let channel_id  = json["id"].as_u64()?;
    let chatroom_id = json["chatroom"]["id"].as_u64()?;
    let slug        = json["slug"].as_str().unwrap_or(channel).to_string();

    Some(ChannelInfo { channel_id, chatroom_id, slug })
}
