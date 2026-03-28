import { describe, expect, it } from "vitest";
import {
  ERC20_TRANSFER_SELECTOR,
  canTransitionStatus,
  getSpendLimitScopeValidationErrors,
  createWalletRequestResponseSchema,
  localWalletRequestSchema,
  normalizePermissionScope,
  selectorSchema,
  toSpendLimitPeriodSeconds,
} from "./contracts.js";

describe("shared contracts", () => {
  it("normalizes duplicate selectors", () => {
    const scope = normalizePermissionScope({
      chainId: 8453,
      targetContract: "0x1111111111111111111111111111111111111111",
      allowedMethods: ["0xa9059cbb", "0xa9059cbb"],
    });

    expect(scope.allowedMethods).toEqual(["0xa9059cbb"]);
  });

  it("validates selector format", () => {
    expect(() => selectorSchema.parse("0xa9059cbb")).not.toThrow();
    expect(() => selectorSchema.parse("transfer(address,uint256)")).toThrow();
  });

  it("validates spend-limited scopes against direct transfer-only surfaces", () => {
    const validScope = normalizePermissionScope({
      chainId: 84532,
      targetContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      allowedMethods: [ERC20_TRANSFER_SELECTOR],
      spendLimits: [
        {
          type: "erc20",
          tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          limitBaseUnits: "25000000",
          period: "week",
        },
      ],
    });

    expect(getSpendLimitScopeValidationErrors(validScope)).toEqual([]);

    const invalidScope = normalizePermissionScope({
      chainId: 84532,
      targetContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      allowedMethods: [ERC20_TRANSFER_SELECTOR, "0x095ea7b3"],
      spendLimits: [
        {
          type: "erc20",
          tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          limitBaseUnits: "25000000",
          period: "week",
        },
      ],
    });

    expect(getSpendLimitScopeValidationErrors(invalidScope)).toContain(
      "ERC20 spend-limited scopes must allow only transfer(address,uint256).",
    );
  });

  it("converts supported spend-limit periods into seconds", () => {
    expect(toSpendLimitPeriodSeconds("day")).toBe(86_400);
    expect(toSpendLimitPeriodSeconds("week")).toBe(604_800);
    expect(toSpendLimitPeriodSeconds("month")).toBe(2_592_000);
  });

  it("enforces the status graph", () => {
    expect(canTransitionStatus("created", "owner_bound")).toBe(true);
    expect(canTransitionStatus("created", "ready")).toBe(false);
  });

  it("validates create response and local request shapes", () => {
    expect(() =>
      createWalletRequestResponseSchema.parse({
        walletId: "wal_123",
        status: "created",
        provisioningUrl: "http://127.0.0.1:5173/?walletId=wal_123&token=abc",
        expiresAt: new Date().toISOString(),
        nextSteps: {
          recommendedPollIntervalMs: 5000,
          walletAddressStatus: "owner_bound",
          humanActionUrl: "http://127.0.0.1:5173/?walletId=wal_123&token=abc",
          humanAction:
            "Ask the human to open the provisioning URL and create the passkey owner.",
          walletAddressCommand:
            "agent-wallet status wal_123 --backend-url http://127.0.0.1:3000",
          statusCommand: "agent-wallet status wal_123 --backend-url http://127.0.0.1:3000",
          awaitCommand: "agent-wallet await wal_123 --backend-url http://127.0.0.1:3000",
          guidance: [
            "Ask the human to open the provisioning URL and create the wallet with the passkey owner.",
            "Then call the CLI wallet-address command again to refresh status and obtain the wallet address.",
            "When the wallet address is available, ask the human to fund it on the request chain.",
            "After funding, continue waiting until the request reaches ready.",
          ],
        },
      }),
    ).not.toThrow();

    expect(() =>
      localWalletRequestSchema.parse({
        walletId: "wal_123",
        backendBaseUrl: "http://127.0.0.1:3000",
        provisioningUrl: "http://127.0.0.1:5173/?walletId=wal_123&token=abc",
        chainId: 84532,
        targetContract: "0x1111111111111111111111111111111111111111",
        allowedMethods: ["0xa9059cbb"],
        spendLimits: [
          {
            type: "erc20",
            tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            limitBaseUnits: "25000000",
            period: "week",
          },
        ],
        sessionPublicKey: "0x1234",
        sessionPrivateKey: "0xabcd",
        createdAt: new Date().toISOString(),
        lastKnownStatus: "created",
      }),
    ).not.toThrow();
  });
});
