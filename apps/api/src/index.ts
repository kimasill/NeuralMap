import { createApp } from "./server.js";

const port = Number(process.env.PORT ?? 4317);
const host = process.env.HOST ?? "0.0.0.0";

const app = createApp();

try {
  await app.listen({ port, host });
  app.log.info({ port, host }, "NeuralMap API listening");
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

