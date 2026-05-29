# Plan de Integración con Kick — DaiBot

## Estado actual

| Componente | Implementación | Estado |
|---|---|---|
| Lectura de chat | Pusher WebSocket `chatrooms.{id}.v2` | ✅ Funciona |
| Autenticación | Cookies de sesión (Puppeteer) | ⚠️ Frágil |
| Seguidores | REST API pública (polling 60s) | ⚠️ Cloudflare |
| Envío de mensajes | No implementado | ❌ |
| Eventos (follows, subs) | No implementado | ❌ |

---

## Mejoras por prioridad

### 🔴 Prioridad Alta — Implementar ahora

#### 1. Canal Pusher `channel.{slug}` para eventos en tiempo real
El canal de chatroom ya es funcional. Suscribiendo también al canal de canal
se reciben eventos de follows y estados de stream sin polling.

```js
// En la suscripción de Pusher, añadir:
{ "event": "pusher:subscribe", "data": { "channel": "channel.seniordai" } }
```

Eventos disponibles:
- `App\Events\FollowersUpdated` → followers en tiempo real (elimina el polling de 60s)
- `App\Events\StreamerIsLive` / `StreamerIsOffline` → estado del stream
- `App\Events\SubscriptionEvent` → nuevas suscripciones

**Implementación en DaiBot.ts:** En el handler `ChatMessage`, añadir una segunda
suscripción Pusher al canal `channel.{CHANNEL_NAME}` y disparar alertas TTS
cuando llegue `SubscriptionEvent` o `FollowersUpdated`.

---

#### 2. Alertas TTS para follows y subs
Con los eventos del punto anterior, implementar en DaiBot.ts:

```typescript
// Cuando llega FollowersUpdated:
enqueueTTS(`¡Gracias por el follow, ${username}!`, "dalia");
io.emit("chatMessage", { user: "DaiBot", content: `🟢 Nuevo follow: ${username}` });

// Cuando llega SubscriptionEvent:
enqueueTTS(`¡${username} se suscribió al canal!`, "dalia");
```

---

### 🟡 Prioridad Media — Próxima iteración

#### 3. Envío de mensajes al chat
Con el Bearer Token (ya extraído por el login), DaiBot puede responder al chat:

```typescript
async function sendChatMessage(chatroomId: number, text: string) {
  await fetch("https://kick.com/api/v2/messages", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${BEARER_TOKEN}`,
      "X-XSRF-TOKEN": XSRF_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chatroom_id: chatroomId, content: text }),
  });
}
```

Uso: respuesta automática a comandos (`!play → "✅ Añadido: {title}"`).

---

#### 4. Migrar autenticación a OAuth 2.0 oficial
Kick lanzó su portal de desarrolladores. El flujo OAuth es más estable que las cookies:

1. Registrar app en `https://kick.com/developer`
2. Obtener `CLIENT_ID` y `CLIENT_SECRET`
3. Flujo de autorización:
   ```
   GET https://kick.com/oauth/authorize
     ?client_id={CLIENT_ID}
     &redirect_uri=http://localhost:3000/oauth/callback
     &scope=channel:read+chat:write+chat:read
   ```
4. El callback recibe un `code`, intercambiarlo por access_token
5. Guardar `access_token` + `refresh_token` en `.env`

**Ventaja:** Tokens de larga duración con auto-refresh. Sin Puppeteer. Sin riesgo de ban.

**Bloqueo actual:** Kick requiere aprobación manual para nuevas apps. Solicitar en su Discord de desarrolladores.

---

### 🟢 Prioridad Baja — Futuro

#### 5. Webhooks oficiales de Kick
Kick tiene un sistema de webhooks en beta para canales verificados:

```typescript
// En DaiBot.ts, añadir endpoint POST /webhook
app.post("/webhook", express.json(), (req, res) => {
  const event = req.body;
  if (event.type === "channel.followed") {
    const username = event.data.follower.username;
    enqueueTTS(`¡Gracias por seguir el canal, ${username}!`, "dalia");
  }
  res.sendStatus(200);
});
```

Requiere: URL pública (Railway/Render/Fly.io), certificado SSL, registro de webhook
en el portal de Kick.

---

#### 6. Channel Points / Recompensas
Kick está implementando un sistema similar a los puntos de canal de Twitch.
Cuando esté disponible via API/Pusher, integrar con el sistema de comandos existente.

---

## Despliegue en nube (Railway/Render)

Para usar DaiBot desde cualquier lugar:

1. Subir el repositorio a GitHub (sin el `.env`)
2. Crear proyecto en Railway.app (plan gratuito: 500h/mes)
3. Configurar variables de entorno en el dashboard de Railway:
   - `COOKIES`, `BEARER_TOKEN`, `XSRF_TOKEN`
   - `PANEL_TOKEN`
   - `CHANNEL_NAME`
   - `PORT=3000`
4. El panel en `https://tu-app.up.railway.app/panel.html`
5. El TTS server Python no funcionará en nube gratuita (edge-tts requiere red a Microsoft) — usar gTTS como fallback o contratar un tier con más recursos

**Nota sobre cookies en nube:** Las cookies de sesión expiran. Con OAuth (punto 4)
este problema desaparece. Mientras tanto, renovar manualmente cuando el bot deje de conectar.
