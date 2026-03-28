import { describe, expect, it } from "vitest";
import { PolicyFlags } from "@zerodev/permissions";
import { encodeAbiParameters } from "viem";
import {
  AGENT_SPEND_LIMIT_POLICY_TYPE,
  toAgentSpendLimitPolicy,
} from "./index.js";

describe("agent spend limit policy", () => {
  it("encodes an ERC20 periodic spend limit for Kernel policies", () => {
    const policy = toAgentSpendLimitPolicy({
      policyAddress: "0x1111111111111111111111111111111111111111",
      tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      limitBaseUnits: "25000000",
      period: "week",
    });

    expect(policy.getPolicyInfoInBytes()).toBe(
      "0x00021111111111111111111111111111111111111111",
    );
    expect(policy.getPolicyData()).toBe(
      encodeAbiParameters(
        [
          { name: "token", type: "address" },
          { name: "limit", type: "uint256" },
          { name: "periodSeconds", type: "uint48" },
        ],
        [
          "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          25_000_000n,
          604_800,
        ],
      ),
    );
    expect(policy.policyParams).toMatchObject({
      type: AGENT_SPEND_LIMIT_POLICY_TYPE,
      policyAddress: "0x1111111111111111111111111111111111111111",
      policyFlag: PolicyFlags.NOT_FOR_VALIDATE_SIG,
      tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      limitBaseUnits: "25000000",
      period: "week",
      periodSeconds: 604_800,
    });
  });
});
