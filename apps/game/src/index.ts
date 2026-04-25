import { buildGameServer } from "./server.js";

const port = Number(process.env.GAME_PORT ?? 4200);
const host = process.env.GAME_HOST ?? "0.0.0.0";

const { app } = buildGameServer();

app
  .listen({ host, port })
  .then(() => {
    app.log.info(`Game service listening on ${host}:${port}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
