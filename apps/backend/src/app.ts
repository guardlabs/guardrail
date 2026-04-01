import cors from "@fastify/cors";
import Fastify, { type FastifyServerOptions } from "fastify";
import {
  createChainRelayService,
  type ChainRelayService,
} from "./chain-relay.js";
import { readConfig, type AppConfig } from "./config.js";
import { createPostgresWalletRequestRepository } from "./postgres-repository.js";
import type { WalletRequestRepository } from "./repository.js";
import { registerRoutes } from "./routes.js";
import {
  createWalletProvisioningService,
  type WalletProvisioningService,
} from "./wallet.js";

type BuildAppOptions = {
  config?: AppConfig;
  repository?: WalletRequestRepository;
  walletProvisioningService?: WalletProvisioningService;
  chainRelayService?: ChainRelayService;
};

export function buildLoggerOptions(
  env: NodeJS.ProcessEnv = process.env,
): FastifyServerOptions["logger"] {
  const level = env.LOG_LEVEL ?? "info";
  const shouldUsePrettyLogs =
    env.NODE_ENV !== "production" && env.NODE_ENV !== "test";

  if (!shouldUsePrettyLogs) {
    return {
      level,
    };
  }

  return {
    level,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        ignore: "pid,hostname",
        translateTime: "SYS:standard",
      },
    },
  };
}

export function buildApp(options: BuildAppOptions = {}) {
  const config = options.config ?? readConfig();
  const app = Fastify({
    logger: buildLoggerOptions(process.env),
    disableRequestLogging: true,
  });
  const repository =
    options.repository ??
    createPostgresWalletRequestRepository(config.databaseUrl);
  const walletProvisioningService =
    options.walletProvisioningService ??
    createWalletProvisioningService(config);
  const chainRelayService =
    options.chainRelayService ?? createChainRelayService(config);

  app.register(cors, {
    origin: true,
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "conduit-wallet-backend",
  }));

  app.get("/v1/health", async () => ({
    status: "ok",
    version: "v1",
  }));

  void registerRoutes(
    app,
    repository,
    config,
    walletProvisioningService,
    chainRelayService,
  );

  return app;
}
