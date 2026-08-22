# Ретранслятор установления соединения

Поставка версии 0.17.0 (roadmap §6.4). Сервер знакомит участников состязательного
режима в сети общего пользования: перечень комнат и обмен описаниями сессии
WebRTC. **Правила боя сервер не исполняет.**

## Запуск (стенд)

```bash
cd app
pnpm install
pnpm --filter @bylina/signaling-server start        # порт 8080 (env PORT)
```

## Windows

```bash
pnpm --filter @bylina/signaling-server build
```

В `dist/` появляются самодостаточный бандл `signaling-server.cjs` и запускающий
`bylina-relay.cmd` (при доступном `pkg` — исполняемый `bylina-relay.exe`).
Запуск на Windows: `bylina-relay.cmd` (или `node signaling-server.cjs`).

## Проверка

- `GET /health` — `{"ok":true,"rooms":0}`
- `GET /rooms` — перечень открытых комнат
- WebSocket `ws://host:8080` — протокол в `src/server.mjs`

Автоматические проверки: `pnpm --filter @bylina/signaling-server test`,
`pnpm --filter @bylina/signaling test` (клиент), `pnpm --filter @bylina/session test` (сквозной бой через ретранслятор).
