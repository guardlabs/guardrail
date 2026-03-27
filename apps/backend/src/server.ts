import { readConfig } from "./config.js";
import { buildApp } from "./app.js";
import { loadEnvFiles } from "./env.js";

loadEnvFiles();

const config = readConfig();
const app = buildApp({
  config,
});

app
  .listen({ port: config.port, host: "0.0.0.0" })
  .catch((error) => {
    app.log.error(error);
    process.exitCode = 1;
  });
