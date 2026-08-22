import { createRelayServer } from "./server.mjs";

const PORT = Number(process.env.PORT ?? 8080);
createRelayServer({ port: PORT, host: "0.0.0.0" }).then((relay) => {
  console.log(`Bylina signaling relay listening on http://0.0.0.0:${relay.port}`);
});
