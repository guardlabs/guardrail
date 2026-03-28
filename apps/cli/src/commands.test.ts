import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hydrateReadyWalletRequest,
  callReadyWalletTransaction,
} from "./kernel.js";
import { readLocalWalletRequest, saveLocalWalletRequest } from "./local-store.js";
import {
  executeAwait,
  executeCall,
  executeCreate,
  executeStatus,
} from "./commands.js";

vi.mock("./kernel.js", () => ({
  hydrateReadyWalletRequest: vi.fn(),
  callReadyWalletTransaction: vi.fn(),
}));

describe("cli commands", () => {
  let tempStoreDirectory = "";

  beforeEach(async () => {
    tempStoreDirectory = await mkdtemp(join(tmpdir(), "agent-wallet-cli-"));
    process.env.AGENT_WALLET_LOCAL_STORE_DIR = tempStoreDirectory;
  });

  afterEach(() => {
    delete process.env.AGENT_WALLET_LOCAL_STORE_DIR;
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    if (tempStoreDirectory) {
      await rm(tempStoreDirectory, {
        recursive: true,
        force: true,
      });
    }
  });

  it("creates a wallet against the backend API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          walletId: "wal_123",
          status: "created",
          provisioningUrl:
            "http://127.0.0.1:5173/?walletId=wal_123&token=abc&backendUrl=http%3A%2F%2F127.0.0.1%3A3000",
          expiresAt: new Date().toISOString(),
        }),
      }),
    );

    const result = await executeCreate({
      chainId: "84532",
      targetContract: "0x1111111111111111111111111111111111111111",
      allowedMethod: "0xa9059cbb",
      backendUrl: "http://127.0.0.1:3000",
    });

    expect(result.walletId).toBe("wal_123");
    expect(result.sessionPublicKey.startsWith("0x")).toBe(true);
    expect(result.localStatePath.endsWith("wal_123.json")).toBe(true);
    expect(result.provisioningUrl).toContain(
      "backendUrl=http%3A%2F%2F127.0.0.1%3A3000",
    );
    expect(result.nextSteps).toMatchObject({
      recommendedPollIntervalMs: 5000,
      walletAddressStatus: "owner_bound",
      humanActionUrl:
        "http://127.0.0.1:5173/?walletId=wal_123&token=abc&backendUrl=http%3A%2F%2F127.0.0.1%3A3000",
      humanAction:
        "Ask the human to open the provisioning URL and create the wallet with the passkey owner.",
      walletAddressCommand:
        "agent-wallet status wal_123 --backend-url http://127.0.0.1:3000",
      statusCommand:
        "agent-wallet status wal_123 --backend-url http://127.0.0.1:3000",
      awaitCommand:
        "agent-wallet await wal_123 --backend-url http://127.0.0.1:3000",
    });
    expect(result.nextSteps.guidance).toHaveLength(4);
  });

  it("preserves the caller backend override in create output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          walletId: "wal_localhost",
          status: "created",
          provisioningUrl:
            "http://127.0.0.1:5173/?walletId=wal_localhost&token=abc&backendUrl=http%3A%2F%2F127.0.0.1%3A3000",
          expiresAt: new Date().toISOString(),
          nextSteps: {
            recommendedPollIntervalMs: 5000,
            walletAddressStatus: "owner_bound",
            humanActionUrl:
              "http://127.0.0.1:5173/?walletId=wal_localhost&token=abc&backendUrl=http%3A%2F%2F127.0.0.1%3A3000",
            humanAction:
              "Ask the human to open the provisioning URL and create the wallet with the passkey owner.",
            walletAddressCommand:
              "agent-wallet status wal_localhost --backend-url http://127.0.0.1:3000",
            statusCommand:
              "agent-wallet status wal_localhost --backend-url http://127.0.0.1:3000",
            awaitCommand:
              "agent-wallet await wal_localhost --backend-url http://127.0.0.1:3000",
            guidance: [
              "Ask the human to open the provisioning URL and create the wallet with the passkey owner.",
              "Then call the CLI wallet-address command again to refresh status and obtain the wallet address.",
              "When the wallet address is available, ask the human to fund it on the request chain.",
              "After funding, continue waiting until the request reaches ready.",
            ],
          },
        }),
      }),
    );

    const result = await executeCreate({
      chainId: "84532",
      targetContract: "0x1111111111111111111111111111111111111111",
      allowedMethod: "0xa9059cbb",
      backendUrl: "http://localhost:3000",
    });

    expect(result.provisioningUrl).toContain(
      "backendUrl=http%3A%2F%2Flocalhost%3A3000",
    );
    expect(result.nextSteps.humanActionUrl).toContain(
      "backendUrl=http%3A%2F%2Flocalhost%3A3000",
    );
    expect(result.nextSteps.walletAddressCommand).toContain(
      "--backend-url http://localhost:3000",
    );
    expect(result.nextSteps.statusCommand).toContain(
      "--backend-url http://localhost:3000",
    );
    expect(result.nextSteps.awaitCommand).toContain(
      "--backend-url http://localhost:3000",
    );
  });

  it("encodes and persists an optional weekly USDC spend limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        walletId: "wal_limit",
        status: "created",
        provisioningUrl:
          "http://127.0.0.1:5173/?walletId=wal_limit&token=abc&backendUrl=http%3A%2F%2F127.0.0.1%3A3000",
        expiresAt: new Date().toISOString(),
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    await executeCreate({
      chainId: "84532",
      targetContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      allowedMethod: "0xa9059cbb",
      usdcLimit: "25",
      usdcLimitPeriod: "week",
      backendUrl: "http://127.0.0.1:3000",
    });

    const createCall = fetchMock.mock.calls[0];
    expect(createCall?.[0]).toBe("http://127.0.0.1:3000/v1/wallets");
    const requestInit = createCall?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(requestInit?.body)) as {
      spendLimits?: Array<{
        type: string;
        tokenAddress: string;
        limitBaseUnits: string;
        period: string;
      }>;
    };

    expect(body.spendLimits).toEqual([
      {
        type: "erc20",
        tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        limitBaseUnits: "25000000",
        period: "week",
      },
    ]);

    const persistedRequest = await readLocalWalletRequest("wal_limit");
    expect(persistedRequest.spendLimits).toEqual(body.spendLimits);
  });

  it("reads wallet status from the backend API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          walletId: "wal_123",
          status: "created",
          scope: {
            chainId: 84532,
            targetContract: "0x1111111111111111111111111111111111111111",
            allowedMethods: ["0xa9059cbb"],
          },
          sessionPublicKey: "0x1234",
          funding: {
            status: "unverified",
            minimumRequiredWei: "500000000000000",
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          expiresAt: new Date().toISOString(),
        }),
      }),
    );

    const result = await executeStatus({
      walletId: "wal_123",
      backendUrl: "http://127.0.0.1:3000",
    });

    expect(result.walletId).toBe("wal_123");
    expect(result.status).toBe("created");
  });

  it("waits until the backend returns a ready wallet", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    vi.mocked(hydrateReadyWalletRequest).mockResolvedValue({
      walletAddress: "0x2222222222222222222222222222222222222222",
      serializedPermissionAccount: "approval_123",
    });

    const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            walletId: "wal_123",
            status: "created",
            provisioningUrl:
              "http://127.0.0.1:5173/?walletId=wal_123&token=abc&backendUrl=http%3A%2F%2F127.0.0.1%3A3000",
            expiresAt: new Date().toISOString(),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            walletId: "wal_123",
            status: "created",
            scope: {
              chainId: 84532,
              targetContract: "0x1111111111111111111111111111111111111111",
              allowedMethods: ["0xa9059cbb"],
            },
            sessionPublicKey: "0x1234",
            funding: {
              status: "unverified",
              minimumRequiredWei: "500000000000000",
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            expiresAt: new Date().toISOString(),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            walletId: "wal_123",
            status: "owner_bound",
            scope: {
              chainId: 84532,
              targetContract: "0x1111111111111111111111111111111111111111",
              allowedMethods: ["0xa9059cbb"],
            },
            sessionPublicKey: "0x1234",
            counterfactualWalletAddress:
              "0x2222222222222222222222222222222222222222",
            funding: {
              status: "insufficient",
              minimumRequiredWei: "500000000000000",
              balanceWei: "0",
              checkedAt: new Date().toISOString(),
            },
            walletContext: {
              walletAddress: "0x2222222222222222222222222222222222222222",
              chainId: 84532,
              kernelVersion: "3.1",
              sessionPublicKey: "0x1234",
              owner: {
                credentialId: "credential-id",
                publicKey: "0x1234",
              },
              scope: {
                chainId: 84532,
                targetContract: "0x1111111111111111111111111111111111111111",
                allowedMethods: ["0xa9059cbb"],
              },
              policyDigest: "0x12345678",
              serializedPermissionAccount: "approval_123",
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            expiresAt: new Date().toISOString(),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            walletId: "wal_123",
            status: "ready",
            scope: {
              chainId: 84532,
              targetContract: "0x1111111111111111111111111111111111111111",
              allowedMethods: ["0xa9059cbb"],
            },
            sessionPublicKey: "0x1234",
            counterfactualWalletAddress:
              "0x2222222222222222222222222222222222222222",
            funding: {
              status: "verified",
              minimumRequiredWei: "500000000000000",
              balanceWei: "600000000000000",
              checkedAt: new Date().toISOString(),
            },
            walletContext: {
              walletAddress: "0x2222222222222222222222222222222222222222",
              chainId: 84532,
              kernelVersion: "3.1",
              sessionPublicKey: "0x1234",
              owner: {
                credentialId: "credential-id",
                publicKey: "0x1234",
              },
              scope: {
                chainId: 84532,
                targetContract: "0x1111111111111111111111111111111111111111",
                allowedMethods: ["0xa9059cbb"],
              },
              policyDigest: "0x12345678",
              serializedPermissionAccount: "approval_123",
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            expiresAt: new Date().toISOString(),
          }),
        });

    vi.stubGlobal("fetch", fetchMock);

    await executeCreate({
      chainId: "84532",
      targetContract: "0x1111111111111111111111111111111111111111",
      allowedMethod: "0xa9059cbb",
      backendUrl: "http://127.0.0.1:3000",
    });

    const result = await executeAwait({
      walletId: "wal_123",
      intervalMs: 1,
      backendUrl: "http://127.0.0.1:3000",
    });

    expect(hydrateReadyWalletRequest).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ready");
    expect(result.counterfactualWalletAddress).toBe(
      "0x2222222222222222222222222222222222222222",
    );
    expect(result.walletContext?.walletAddress).toBe(
      "0x2222222222222222222222222222222222222222",
    );
    expect("localStatePath" in result).toBe(true);
    if (!("localStatePath" in result)) {
      throw new Error("Expected executeAwait to return a localStatePath.");
    }
    expect(result.localStatePath.endsWith("wal_123.json")).toBe(true);

    const persistedRequest = await readLocalWalletRequest("wal_123");
    expect(persistedRequest.lastKnownStatus).toBe("ready");
    expect(persistedRequest.walletAddress).toBe(
      "0x2222222222222222222222222222222222222222",
    );
    expect(persistedRequest.serializedPermissionAccount).toBe("approval_123");
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:3000/v1/wallets/wal_123/refresh-funding",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining("Waiting for wallet wal_123"),
    );
  });

  it("calls an authorized contract from a ready local wallet", async () => {
    vi.mocked(callReadyWalletTransaction).mockResolvedValue({
      walletAddress: "0x2222222222222222222222222222222222222222",
      transactionHash: "0xtransactionhash",
    });

    await saveLocalWalletRequest({
      walletId: "wal_ready",
      backendBaseUrl: "http://127.0.0.1:3000",
      provisioningUrl:
        "http://127.0.0.1:5173/?walletId=wal_ready&token=abc&backendUrl=http%3A%2F%2F127.0.0.1%3A3000",
      chainId: 84532,
      targetContract: "0x1111111111111111111111111111111111111111",
      allowedMethods: ["0xa9059cbb"],
      sessionPublicKey:
        "0x04bfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabfcabf",
      sessionPrivateKey:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      walletAddress: "0x2222222222222222222222222222222222222222",
      serializedPermissionAccount: "approval_123",
      createdAt: "2026-03-25T12:00:00.000Z",
      lastKnownStatus: "ready",
    });

    const result = await executeCall({
      walletId: "wal_ready",
      to: "0x1111111111111111111111111111111111111111",
      data: "0xa9059cbb",
      valueWei: "0",
    });

    expect(callReadyWalletTransaction).toHaveBeenCalledWith({
      localRequest: expect.objectContaining({
        walletId: "wal_ready",
        lastKnownStatus: "ready",
      }),
      call: {
        to: "0x1111111111111111111111111111111111111111",
        data: "0xa9059cbb",
        valueWei: "0",
      },
    });
    expect(result).toEqual({
      walletId: "wal_ready",
      walletAddress: "0x2222222222222222222222222222222222222222",
      targetContract: "0x1111111111111111111111111111111111111111",
      data: "0xa9059cbb",
      valueWei: "0",
      transactionHash: "0xtransactionhash",
    });
  });

});
