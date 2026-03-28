import {
  toSpendLimitPeriodSeconds,
  type SpendLimitPeriod,
} from "@agent-wallet/shared";
import { PolicyFlags, type Policy } from "@zerodev/permissions";
import type { Address } from "viem";
import { concatHex, encodeAbiParameters } from "viem";

export const AGENT_SPEND_LIMIT_POLICY_TYPE = "agent-spend-limit" as const;

export type AgentSpendLimitPolicyParams = {
  type: typeof AGENT_SPEND_LIMIT_POLICY_TYPE;
  policyAddress: Address;
  policyFlag: PolicyFlags;
  tokenAddress: Address;
  limitBaseUnits: string;
  period: SpendLimitPeriod;
  periodSeconds: number;
};

export function isAgentSpendLimitPolicyParams(
  value: unknown,
): value is AgentSpendLimitPolicyParams {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { type?: unknown };
  return candidate.type === AGENT_SPEND_LIMIT_POLICY_TYPE;
}

export function toAgentSpendLimitPolicy(input: {
  policyAddress: Address;
  tokenAddress: Address;
  limitBaseUnits: string | bigint;
  period: SpendLimitPeriod;
  policyFlag?: PolicyFlags;
}) {
  const limitBaseUnits =
    typeof input.limitBaseUnits === "bigint"
      ? input.limitBaseUnits.toString()
      : input.limitBaseUnits;
  const periodSeconds = toSpendLimitPeriodSeconds(input.period);
  const policyFlag = input.policyFlag ?? PolicyFlags.NOT_FOR_VALIDATE_SIG;

  return {
    getPolicyData: () =>
      encodeAbiParameters(
        [
          { name: "token", type: "address" },
          { name: "limit", type: "uint256" },
          { name: "periodSeconds", type: "uint48" },
        ],
        [input.tokenAddress, BigInt(limitBaseUnits), periodSeconds],
      ),
    getPolicyInfoInBytes: () => concatHex([policyFlag, input.policyAddress]),
    policyParams: {
      type: AGENT_SPEND_LIMIT_POLICY_TYPE,
      policyAddress: input.policyAddress,
      policyFlag,
      tokenAddress: input.tokenAddress,
      limitBaseUnits,
      period: input.period,
      periodSeconds,
    } satisfies AgentSpendLimitPolicyParams,
  } as unknown as Policy;
}
