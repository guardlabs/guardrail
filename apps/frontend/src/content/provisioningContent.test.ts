import { describe, expect, it } from "vitest";
import type { WalletPolicy } from "@conduit/shared";
import { getProvisioningContentModel } from "./provisioningContent.js";

function createPolicy(overrides: Partial<WalletPolicy> = {}): WalletPolicy {
  return {
    contractAllowlist: [
      {
        contractAddress: "0x4444444444444444444444444444444444444444",
        allowedSelectors: ["0xa9059cbb"],
      },
    ],
    usdcPolicy: {
      period: "daily",
      maxAmountMinor: "1500000",
      allowedOperations: ["transfer", "permit"],
    },
    ...overrides,
  };
}

describe("getProvisioningContentModel", () => {
  it("translates policy and created status into non-technical copy", () => {
    const model = getProvisioningContentModel({
      status: "created",
      fundingStatus: "unverified",
      policy: createPolicy(),
    });

    expect(model.statusTitle).toBe("Create the passkey");
    expect(model.permissionItems).toContain(
      "Use official USDC within the configured budget.",
    );
    expect(model.permissionItems).toContain(
      "Anything outside policy is blocked by default.",
    );
    expect(model.reassurance).toBe(
      "The agent only receives limited runtime access after setup.",
    );
  });

  it("adjusts the primary message when funding is still required", () => {
    const model = getProvisioningContentModel({
      status: "owner_bound",
      fundingStatus: "insufficient",
      policy: createPolicy(),
    });

    expect(model.statusTitle).toBe("Fund the wallet");
    expect(model.statusBody).toMatch(/complete activation/i);
  });
});
