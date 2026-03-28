import { describe, expect, it } from "vitest";
import {
  AGENT_SPEND_LIMIT_POLICY_TYPE,
} from "./index.js";
import { createPolicyFromParams } from "./permission-account.js";

describe("permission account helpers", () => {
  it("recreates the custom spend-limit policy from serialized params", async () => {
    const policy = await createPolicyFromParams({
      policyParams: {
        type: AGENT_SPEND_LIMIT_POLICY_TYPE,
        policyAddress: "0x1111111111111111111111111111111111111111",
        policyFlag: "0x0001",
        tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        limitBaseUnits: "25000000",
        period: "week",
        periodSeconds: 604_800,
      },
    } as never);

    expect(policy.policyParams).toMatchObject({
      type: AGENT_SPEND_LIMIT_POLICY_TYPE,
      tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      limitBaseUnits: "25000000",
      period: "week",
      periodSeconds: 604_800,
    });
  });
});
