# Ретранслятор установления соединения

Компонент добавлен в версии 0.17.0 (roadmap §6.4). Сервер знакомит участников
состязательного режима в сети общего пользования: перечень комнат и обмен
описаниями сессии WebRTC. **Правила боя сервер не исполняет.**

## Запуск (стенд)

```bash
cd app
pnpm install
pnpm --filter @bylina/signaling-server start        # порт 8080 (env PORT)
```

## Пределы

Защита от исчерпания ресурсов на недоверенной стороне (поведение
нормативно описано в `doc/network-protocol.md` §8.1):

- полезная нагрузка `SIGNAL` — не более 64 KiB; кадр WebSocket крупнее
  65 KiB отвергается транспортом (`maxPayload` у `WebSocketServer`):
  сокет закрывается кодом `1009` до буферизации кадра;
- комнат — не более 200 по умолчанию: создание комнаты сверх предела
  возвращает `ERROR` с сообщением `CAPACITY` и закрывает соединение;
- одновременных соединений — не более 400 по умолчанию: лишнее
  соединение закрывается кодом `1013` с причиной `OVERLOADED`;
- в комнате — не более четырёх участников (`ROOM_FULL`);
- `peerId` формируется через `crypto.randomUUID()`.

Пределы комнат и соединений настраиваются переменными окружения
`RELAY_MAX_ROOMS` и `RELAY_MAX_SOCKETS` (положительные целые; значения по
умолчанию — 200 и 400; недоверенные значения игнорируются). Порт — `PORT`,
источник CORS — `RELAY_ALLOW_ORIGIN`. При встраивании как модуль пределы
передаются опциями `maxRooms` и `maxSockets` функции `createRelayServer`.

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

## CORS

HTTP-эндпоинты (`/health`, `/rooms`) отдают `Access-Control-Allow-Origin`:
клиент комнаты работает на другом источнике (порт/домен). По умолчанию
источник не ограничивается (`*`); развёртывание сужает его переменной
окружения `RELAY_ALLOW_ORIGIN` либо опцией `corsOrigin` функции
`createRelayServer`. На WebSocket-соединение заголовок не влияет —
ограничение действует только на перечисленные HTTP-запросы.

Автоматические проверки: `pnpm --filter @bylina/signaling-server test`,
`pnpm --filter @bylina/signaling test` (клиент), `pnpm --filter @bylina/session test` (сквозной бой через ретранслятор).
