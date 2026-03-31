import { describe, expect, it } from "vitest";
import { buildLoggerOptions } from "./app.js";

describe("buildLoggerOptions", () => {
  it("uses pretty logs by default outside production and test", () => {
    const logger = buildLoggerOptions({} as NodeJS.ProcessEnv);

    expect(logger).toMatchObject({
      level: "info",
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          ignore: "pid,hostname",
          translateTime: "SYS:standard",
        },
      },
    });
  });

  it("uses the configured log level", () => {
    const logger = buildLoggerOptions({
      LOG_LEVEL: "debug",
    } as NodeJS.ProcessEnv);

    expect(logger).toMatchObject({
      level: "debug",
      transport: {
        target: "pino-pretty",
      },
    });
  });

  it("disables pretty logs in production", () => {
    const logger = buildLoggerOptions({
      NODE_ENV: "production",
      LOG_LEVEL: "debug",
    } as NodeJS.ProcessEnv);

    expect(logger).toEqual({
      level: "debug",
    });
  });

  it("disables pretty logs in test", () => {
    const logger = buildLoggerOptions({
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv);

    expect(logger).toEqual({
      level: "info",
    });
  });
});
