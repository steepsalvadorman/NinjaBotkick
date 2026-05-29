use std::collections::HashMap;
use std::time::{Duration, Instant};

pub struct CooldownManager {
    per_user: HashMap<(String, String), Instant>,
    global:   HashMap<String, Instant>,
}

impl CooldownManager {
    pub fn new() -> Self {
        Self { per_user: HashMap::new(), global: HashMap::new() }
    }

    /// true → puede usar; false → en cooldown.
    pub fn check_user(&self, user: &str, cmd: &str, secs: u64) -> bool {
        match self.per_user.get(&(user.to_lowercase(), cmd.to_string())) {
            Some(t) => t.elapsed() >= Duration::from_secs(secs),
            None    => true,
        }
    }

    pub fn use_user(&mut self, user: &str, cmd: &str) {
        self.per_user.insert((user.to_lowercase(), cmd.to_string()), Instant::now());
    }

    pub fn check_global(&self, cmd: &str, secs: u64) -> bool {
        match self.global.get(cmd) {
            Some(t) => t.elapsed() >= Duration::from_secs(secs),
            None    => true,
        }
    }

    pub fn use_global(&mut self, cmd: &str) {
        self.global.insert(cmd.to_string(), Instant::now());
    }

    /// Elimina entradas expiradas para evitar crecimiento ilimitado.
    /// Llamar cada hora aprox. es suficiente.
    pub fn gc(&mut self, max_secs: u64) {
        let limit = Duration::from_secs(max_secs);
        self.per_user.retain(|_, t| t.elapsed() < limit);
        self.global.retain(|_, t| t.elapsed() < limit);
    }
}
