import { buildApiServer } from "./server.js";

const port = Number(process.env.API_PORT ?? 4100);
const host = process.env.API_HOST ?? "0.0.0.0";

const app = buildApiServer();

app
  .listen({ host, port })
  .then(() => {
    app.log.info(`API service listening on ${host}:${port}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
