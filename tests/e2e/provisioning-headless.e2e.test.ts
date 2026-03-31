import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  getWalletRequestResponseSchema,
  localWalletRequestSchema,
} from "@conduit/shared";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { reservePort } from "./helpers/ports.js";
import {
  pollUntil,
  runCommand,
  startProcess,
  waitForHttpOk,
} from "./helpers/process.js";
import { publishHeadlessOwnerArtifacts } from "./helpers/provision-headless.js";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  getOfficialUsdcBalance,
  mintOfficialUsdcOnAnvil,
  startX402ExactEip3009Server,
} from "./helpers/x402.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, "../..");
const e2eComposeFile = join(workspaceRoot, "tests/e2e/fixtures/docker-compose.e2e.yml");
const backendEntry = join(workspaceRoot, "apps/backend/dist/server.js");
const backendMigrateEntry = join(workspaceRoot, "apps/backend/dist/db/migrate.js");
const cliEntry = join(workspaceRoot, "apps/cli/dist/index.js");
const DEFAULT_ANVIL_ACCOUNT_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ENTRYPOINT_V07_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

loadDotenv({
  path: join(workspaceRoot, ".env.local"),
  override: false,
});
loadDotenv({
  path: join(workspaceRoot, ".env"),
  override: false,
});

async function isPostgresReachable(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
  });

  try {
    await pool.query("select 1");
    return true;
  } finally {
    await pool.end();
  }
}

function buildComposeArgs(projectName: string, ...args: string[]) {
  return [
    "compose",
    "-f",
    e2eComposeFile,
    "-p",
    projectName,
    ...args,
  ];
}

async function ensurePostgres(projectName: string) {
  await runCommand({
    command: "docker",
    args: buildComposeArgs(projectName, "up", "-d", "postgres"),
    cwd: workspaceRoot,
    env: process.env,
  });
  const portResult = await pollUntil(
    async () =>
      runCommand({
        command: "docker",
        args: buildComposeArgs(projectName, "port", "postgres", "5432"),
        cwd: workspaceRoot,
        env: process.env,
      }),
    {
      timeoutMs: 30_000,
      intervalMs: 1_000,
      isReady: (result) => result.stdout.trim().length > 0,
      description: "Docker Compose port mapping for Postgres",
    },
  );
  const mappedPortOutput = portResult.stdout.trim();
  const mappedPort = Number(mappedPortOutput.split(":").at(-1));

  if (!Number.isInteger(mappedPort) || mappedPort <= 0) {
    throw new Error(`Failed to resolve mapped Postgres port from "${mappedPortOutput}".`);
  }
  const databaseUrl = `postgresql://conduit:conduit@127.0.0.1:${mappedPort}/conduit`;

  await pollUntil(
    () => isPostgresReachable(databaseUrl),
    {
      timeoutMs: 30_000,
      intervalMs: 1_000,
      isReady: (ready) => ready,
      description: "Postgres readiness",
    },
  );

  return {
    databaseUrl,
    stop: async () => {
      await runCommand({
        command: "docker",
        args: buildComposeArgs(projectName, "down", "-v"),
        cwd: workspaceRoot,
        env: process.env,
      });
    },
  };
}

async function waitForRpcReady(rpcUrl: string) {
  return pollUntil(
    async () => {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      });

      if (!response.ok) {
        return false;
      }

      const payload = (await response.json()) as {
        result?: string;
      };

      return payload.result === "0x14a34";
    },
    {
      timeoutMs: 45_000,
      intervalMs: 1_000,
      isReady: (ready) => ready,
      description: `Anvil RPC on ${rpcUrl}`,
    },
  );
}

async function waitForBundlerReady(bundlerUrl: string) {
  return pollUntil(
    async () => {
      const response = await fetch(bundlerUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_supportedEntryPoints",
          params: [],
        }),
      });

      if (!response.ok) {
        return false;
      }

      const payload = (await response.json()) as {
        result?: string[];
      };

      return payload.result?.includes(ENTRYPOINT_V07_ADDRESS) ?? false;
    },
    {
      timeoutMs: 90_000,
      intervalMs: 1_000,
      isReady: (ready) => ready,
      description: `Alto bundler on ${bundlerUrl}`,
    },
  );
}

async function getWalletPersistenceState(databaseUrl: string, walletId: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
  });

  try {
    const query = await pool.query<{
      status: string;
      counterfactual_wallet_address: string | null;
      deployment: {
        status: string;
      };
      runtime_policy_state: {
        usdc: {
          periodStartedAt: string;
          consumedAmountMinor: string;
        } | null;
      };
      used_signing_request_ids: string[];
    }>(
      `
        select
          status,
          counterfactual_wallet_address,
          deployment,
          runtime_policy_state,
          used_signing_request_ids
        from wallets
        where wallet_id = $1
      `,
      [walletId],
    );

    if (query.rows.length !== 1 || !query.rows[0]) {
      throw new Error(`Expected one persisted wallet row for ${walletId}.`);
    }

    return query.rows[0];
  } finally {
    await pool.end();
  }
}

async function runCliFailure(
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  try {
    await runCommand({
      command: "node",
      args: [cliEntry, ...args],
      cwd: workspaceRoot,
      env,
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error(`Expected CLI command "${args.join(" ")}" to fail.`);
}

async function runCliJson(
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  const result = await runCommand({
    command: "node",
    args: [cliEntry, ...args],
    cwd: workspaceRoot,
    env,
  });

  try {
    return JSON.parse(result.stdout) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Failed to parse CLI JSON output for args "${args.join(" ")}": ${result.stdout}\n${result.stderr}`,
    );
  }
}

describe("headless provisioning e2e", () => {
  it(
    "provisions a wallet and executes co-signed runtime operations through the real local stack",
    async () => {
      const forkUrl =
        process.env.CONDUIT_E2E_FORK_URL ?? process.env.CONDUIT_PUBLIC_RPC_URL_84532;

      if (!forkUrl) {
        throw new Error(
          "Set CONDUIT_E2E_FORK_URL or CONDUIT_PUBLIC_RPC_URL_84532 before running the provisioning e2e.",
        );
      }

      const postgresProjectName = `conduit-wallet-e2e-${process.pid}`;
      const backendPort = await reservePort();
      const frontendPort = await reservePort();
      const anvilPort = await reservePort();
      const bundlerPort = await reservePort();
      const x402Port = await reservePort();
      const backendUrl = `http://127.0.0.1:${backendPort}`;
      const frontendUrl = `http://127.0.0.1:${frontendPort}`;
      const anvilUrl = `http://127.0.0.1:${anvilPort}`;
      const bundlerUrl = `http://127.0.0.1:${bundlerPort}`;
      const allowedGenericTarget = "0x1111111111111111111111111111111111111111";
      const allowedGenericSelector = "0xdeadbeef";
      const deniedGenericSelector = "0xaabbccdd";
      const tempStoreDirectory = await mkdtemp(join(tmpdir(), "conduit-wallet-e2e-"));
      const postgresHandle = await ensurePostgres(postgresProjectName);
      const { databaseUrl } = postgresHandle;
      const anvilProcess = startProcess({
        name: "anvil",
        command: process.env.CONDUIT_E2E_ANVIL_BIN ?? "anvil",
        args: [
          "--host",
          "127.0.0.1",
          "--port",
          String(anvilPort),
          "--fork-url",
          forkUrl,
          "--chain-id",
          "84532",
        ],
        cwd: workspaceRoot,
        env: process.env,
      });
      const bundlerProcess = startProcess({
        name: "alto",
        command: "pnpm",
        args: [
          "exec",
          "alto",
          "run",
          "-e",
          ENTRYPOINT_V07_ADDRESS,
          "-x",
          DEFAULT_ANVIL_ACCOUNT_PRIVATE_KEY,
          "-u",
          DEFAULT_ANVIL_ACCOUNT_PRIVATE_KEY,
          "-r",
          anvilUrl,
          "--port",
          String(bundlerPort),
          "--min-balance",
          "0",
          "--safe-mode",
          "false",
          "--enable-debug-endpoints",
          "true",
          "--enable-cors",
          "true",
          "--log-level",
          "error",
        ],
        cwd: workspaceRoot,
        env: process.env,
      });
      const backendProcess = startProcess({
        name: "backend",
        command: "node",
        args: [backendEntry],
        cwd: workspaceRoot,
        env: {
          ...process.env,
          PORT: String(backendPort),
          DATABASE_URL: databaseUrl,
          CONDUIT_PUBLIC_BACKEND_URL: backendUrl,
          CONDUIT_PUBLIC_FRONTEND_URL: frontendUrl,
          CONDUIT_PUBLIC_RPC_URL_84532: anvilUrl,
          CONDUIT_BUNDLER_URL_84532: bundlerUrl,
        },
      });
      let x402Server:
        | Awaited<ReturnType<typeof startX402ExactEip3009Server>>
        | null = null;

      try {
        await waitForRpcReady(anvilUrl);
        await waitForBundlerReady(bundlerUrl);
        await runCommand({
          command: "node",
          args: [backendMigrateEntry],
          cwd: workspaceRoot,
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
          },
        });
        await waitForHttpOk(`${backendUrl}/health`, {
          timeoutMs: 30_000,
          intervalMs: 500,
        });
        x402Server = await startX402ExactEip3009Server({
          port: x402Port,
          rpcUrl: anvilUrl,
          merchantPrivateKey: DEFAULT_ANVIL_ACCOUNT_PRIVATE_KEY as Hex,
          amount: 250_000n,
        });

        const cliEnv = {
          ...process.env,
          CONDUIT_LOCAL_STORE_DIR: tempStoreDirectory,
        };
        const createResult = await runCliJson(
          [
            "create",
            "--chain-id",
            "84532",
            "--backend-url",
            backendUrl,
            "--allow-call",
            `${allowedGenericTarget}:${allowedGenericSelector}`,
            "--usdc-period",
            "daily",
            "--usdc-max",
            "0.25",
            "--usdc-allow",
            "transferWithAuthorization",
          ],
          cliEnv,
        );
        const walletId = String(createResult.walletId);
        const provisioningUrl = new URL(String(createResult.provisioningUrl));
        const token = provisioningUrl.searchParams.get("token");
        const provisioningBackendUrl = provisioningUrl.searchParams.get("backendUrl");

        expect(walletId).toMatch(/^wal_/);
        expect(token).toBeTruthy();
        expect(provisioningBackendUrl).toBe(backendUrl);
        const createdWallet = await getWalletPersistenceState(databaseUrl, walletId);
        expect(createdWallet.status).toBe("created");
        expect(createdWallet.counterfactual_wallet_address).toBeNull();
        expect(createdWallet.runtime_policy_state.usdc).toBeNull();
        expect(createdWallet.used_signing_request_ids).toEqual([]);

        const published = await publishHeadlessOwnerArtifacts({
          walletId,
          token: token ?? "",
          backendUrl,
        });

        expect(published.publishedWallet.status).toBe("owner_bound");
        expect(published.publishedWallet.counterfactualWalletAddress).toMatch(
          /^0x[a-fA-F0-9]{40}$/,
        );

        const fundingAmount =
          BigInt(published.publishedWallet.funding.minimumRequiredWei) + parseEther("0.05");
        const fundingClient = createWalletClient({
          chain: baseSepolia,
          transport: http(anvilUrl),
          account: privateKeyToAccount(
            DEFAULT_ANVIL_ACCOUNT_PRIVATE_KEY as `0x${string}`,
          ),
        });
        const anvilPublicClient = createPublicClient({
          chain: baseSepolia,
          transport: http(anvilUrl),
        });
        const fundingHash = await fundingClient.sendTransaction({
          to: published.publishedWallet.counterfactualWalletAddress as `0x${string}`,
          value: fundingAmount,
        });

        await anvilPublicClient.waitForTransactionReceipt({
          hash: fundingHash,
        });

        const awaitResult = await runCliJson(
          [
            "await",
            walletId,
            "--interval-ms",
            "1000",
            "--backend-url",
            backendUrl,
          ],
          cliEnv,
        );
        const walletRequest = getWalletRequestResponseSchema.parse(
          await (
            await fetch(`${backendUrl}/v1/wallets/${walletId}`)
          ).json(),
        );
        const localWallet = localWalletRequestSchema.parse(
          JSON.parse(
            await readFile(join(tempStoreDirectory, `${walletId}.json`), "utf8"),
          ),
        );

        expect(awaitResult.status).toBe("ready");
        expect(walletRequest.status).toBe("ready");
        expect(walletRequest.funding.status).toBe("verified");
        expect(walletRequest.walletContext?.walletAddress).toBe(localWallet.walletAddress);
        expect(walletRequest.walletContext?.agentAddress).toBe(localWallet.agentAddress);
        expect(walletRequest.walletContext?.backendAddress).toBe(localWallet.backendAddress);
        expect(localWallet.walletAddress).toBe(walletRequest.walletContext?.walletAddress);
        expect(localWallet.ownerPublicArtifacts).toEqual(walletRequest.ownerPublicArtifacts);
        expect(localWallet.regularValidatorInitArtifact).toEqual(
          walletRequest.regularValidatorInitArtifact,
        );
        expect(localWallet.policy).toEqual(walletRequest.policy);
        expect(walletRequest.policy).toEqual({
          contractAllowlist: [
            {
              contractAddress: allowedGenericTarget,
              allowedSelectors: [allowedGenericSelector],
            },
          ],
          usdcPolicy: {
            period: "daily",
            maxAmountMinor: "250000",
            allowedOperations: ["transferWithAuthorization"],
          },
        });
        expect(localWallet.lastKnownStatus).toBe("ready");
        expect(walletRequest.deployment.status).toMatch(/^(undeployed|deployed)$/);

        const signingRequestCountBeforeDeniedTypedData = (
          await getWalletPersistenceState(databaseUrl, walletId)
        ).used_signing_request_ids.length;
        const deniedTypedDataError = await runCliFailure(
          [
            "sign-typed-data",
            walletId,
            "--typed-data-json",
            JSON.stringify({
              domain: {
                name: "Conduit Wallet E2E",
                version: "1",
                chainId: 84532,
                verifyingContract: localWallet.walletAddress,
              },
              types: {
                RuntimeApproval: [
                  { name: "walletId", type: "string" },
                  { name: "action", type: "string" },
                ],
              },
              primaryType: "RuntimeApproval",
              message: {
                walletId,
                action: "sign-typed-data",
              },
            }),
          ],
          cliEnv,
        );
        const persistedAfterDeniedTypedData = await getWalletPersistenceState(databaseUrl, walletId);

        expect(deniedTypedDataError).toContain("Backend signer request failed");
        expect(deniedTypedDataError).toContain(
          "Only official USDC typed data are supported by the backend policy.",
        );
        expect(persistedAfterDeniedTypedData.deployment.status).toBe("deployed");
        expect(
          persistedAfterDeniedTypedData.used_signing_request_ids.length,
        ).toBeGreaterThanOrEqual(signingRequestCountBeforeDeniedTypedData + 1);

        const signingRequestCountBeforeAllowedCall =
          persistedAfterDeniedTypedData.used_signing_request_ids.length;
        const allowedCallResult = await runCliJson(
          [
            "call",
            walletId,
            "--to",
            allowedGenericTarget,
            "--data",
            allowedGenericSelector,
            "--value-wei",
            "0",
          ],
          cliEnv,
        );
        const allowedCallReceipt = await anvilPublicClient.waitForTransactionReceipt({
          hash: allowedCallResult.transactionHash as `0x${string}`,
        });
        const persistedAfterAllowedCall = await getWalletPersistenceState(databaseUrl, walletId);

        expect(allowedCallResult.walletId).toBe(walletId);
        expect(allowedCallResult.walletAddress).toBe(localWallet.walletAddress);
        expect(allowedCallResult.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(allowedCallReceipt.status).toBe("success");
        expect(persistedAfterAllowedCall.deployment.status).toBe("deployed");
        expect(persistedAfterAllowedCall.used_signing_request_ids.length).toBeGreaterThanOrEqual(
          signingRequestCountBeforeAllowedCall + 1,
        );

        const signingRequestCountBeforeDeniedCall =
          persistedAfterAllowedCall.used_signing_request_ids.length;
        const deniedCallError = await runCliFailure(
          [
            "call",
            walletId,
            "--to",
            allowedGenericTarget,
            "--data",
            deniedGenericSelector,
            "--value-wei",
            "0",
          ],
          cliEnv,
        );
        const persistedAfterDeniedCall = await getWalletPersistenceState(databaseUrl, walletId);

        expect(deniedCallError).toContain("Backend signer request failed");
        expect(deniedCallError).toContain("runtime allowlist");
        expect(persistedAfterDeniedCall.used_signing_request_ids.length).toBe(
          signingRequestCountBeforeDeniedCall,
        );

        if (!x402Server) {
          throw new Error("x402 server was not started.");
        }

        await mintOfficialUsdcOnAnvil({
          rpcUrl: anvilUrl,
          recipient: localWallet.walletAddress as Address,
          amount: x402Server.paymentAmount * 2n,
          facilitatorPrivateKey: DEFAULT_ANVIL_ACCOUNT_PRIVATE_KEY as Hex,
        });
        const merchantUsdcBefore = await getOfficialUsdcBalance({
          rpcUrl: anvilUrl,
          address: x402Server.merchantAddress as Address,
        });
        const payerUsdcBefore = await getOfficialUsdcBalance({
          rpcUrl: anvilUrl,
          address: localWallet.walletAddress as Address,
        });
        const x402FetchResult = await runCliJson(
          [
            "x402-fetch",
            walletId,
            x402Server.protectedUrl,
          ],
          cliEnv,
        );

        const merchantUsdcAfter = await getOfficialUsdcBalance({
          rpcUrl: anvilUrl,
          address: x402Server.merchantAddress as Address,
        });
        const payerUsdcAfter = await getOfficialUsdcBalance({
          rpcUrl: anvilUrl,
          address: localWallet.walletAddress as Address,
        });
        const paymentRequired = decodePaymentRequiredHeader(
          Buffer.from(
            JSON.stringify(x402FetchResult.paymentRequired),
            "utf8",
          ).toString("base64"),
        );
        const settlementResponse = decodePaymentResponseHeader(
          Buffer.from(
            JSON.stringify(x402FetchResult.paymentResponse),
            "utf8",
          ).toString("base64"),
        );

        expect(x402FetchResult.walletAddress).toBe(localWallet.walletAddress);
        expect(x402FetchResult.status).toBe(200);
        expect(x402FetchResult.x402Paid).toBe(true);
        expect(x402FetchResult.body).toEqual({
          ok: true,
          resource: "premium-data",
        });
        expect(paymentRequired.accepts[0]?.amount).toBe(x402Server.paymentAmount.toString());
        expect(paymentRequired.accepts[0]?.payTo).toBe(x402Server.merchantAddress);
        expect(settlementResponse.success).toBe(true);
        expect(settlementResponse.transaction).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(settlementResponse.network).toBe("eip155:84532");
        expect(settlementResponse.payer).toBe(localWallet.walletAddress);
        expect(settlementResponse.amount).toBe(x402Server.paymentAmount.toString());
        expect(merchantUsdcAfter - merchantUsdcBefore).toBe(x402Server.paymentAmount);
        expect(payerUsdcBefore - payerUsdcAfter).toBe(x402Server.paymentAmount);
        expect(x402Server.settlements).toHaveLength(1);
        expect(x402Server.settlements[0]?.transactionHash).toBe(
          settlementResponse.transaction,
        );

        const persistedAfterX402 = await getWalletPersistenceState(databaseUrl, walletId);

        expect(persistedAfterX402.runtime_policy_state.usdc).toMatchObject({
          consumedAmountMinor: x402Server.paymentAmount.toString(),
        });

        const merchantUsdcBeforeDeniedX402 = merchantUsdcAfter;
        const payerUsdcBeforeDeniedX402 = payerUsdcAfter;
        const deniedX402Error = await runCliFailure(
          [
            "x402-fetch",
            walletId,
            x402Server.protectedUrl,
          ],
          cliEnv,
        );
        const merchantUsdcAfterDeniedX402 = await getOfficialUsdcBalance({
          rpcUrl: anvilUrl,
          address: x402Server.merchantAddress as Address,
        });
        const payerUsdcAfterDeniedX402 = await getOfficialUsdcBalance({
          rpcUrl: anvilUrl,
          address: localWallet.walletAddress as Address,
        });
        const persistedAfterDeniedX402 = await getWalletPersistenceState(databaseUrl, walletId);

        expect(deniedX402Error).toContain("Backend signer request failed");
        expect(deniedX402Error).toContain("configured USDC budget has been exceeded");
        expect(merchantUsdcAfterDeniedX402).toBe(merchantUsdcBeforeDeniedX402);
        expect(payerUsdcAfterDeniedX402).toBe(payerUsdcBeforeDeniedX402);
        expect(x402Server.settlements).toHaveLength(1);
        expect(persistedAfterDeniedX402.runtime_policy_state.usdc).toMatchObject({
          consumedAmountMinor: x402Server.paymentAmount.toString(),
        });
      } finally {
        await x402Server?.stop();
        await backendProcess.stop();
        await bundlerProcess.stop();
        await anvilProcess.stop();
        await postgresHandle.stop();
        await rm(tempStoreDirectory, {
          recursive: true,
          force: true,
        });
      }

      if (backendProcess.output.stderr.includes("Error")) {
        expect(backendProcess.output.stderr).not.toContain("Error");
      }
      if (anvilProcess.output.stderr.includes("error")) {
        expect(anvilProcess.output.stderr.toLowerCase()).not.toContain("error");
      }
      if (bundlerProcess.output.stderr.includes("error")) {
        expect(bundlerProcess.output.stderr.toLowerCase()).not.toContain("error");
      }
    },
    180_000,
  );
});
