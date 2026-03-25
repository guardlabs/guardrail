import cors from "@fastify/cors";
import Fastify from "fastify";

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.register(cors, {
    origin: true,
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "agent-wallet-backend",
  }));

  app.get("/v1/health", async () => ({
    status: "ok",
    version: "v1",
  }));

  return app;
}
