import {
  toOutgoingBudgetPeriodSeconds,
  type OutgoingBudgetFlow,
  type OutgoingBudgetPeriod,
} from "@agent-wallet/shared";
import { PolicyFlags, type Policy } from "@zerodev/permissions";
import type { Address } from "viem";
import { concatHex, encodeAbiParameters } from "viem";

export const AGENT_OUTGOING_BUDGET_POLICY_TYPE = "agent-outgoing-budget" as const;

export type AgentOutgoingBudgetPolicyParams = {
  type: typeof AGENT_OUTGOING_BUDGET_POLICY_TYPE;
  policyAddress: Address;
  policyFlag: PolicyFlags;
  tokenAddress: Address;
  limitBaseUnits: string;
  period: OutgoingBudgetPeriod;
  periodSeconds: number;
  allowedFlows: OutgoingBudgetFlow[];
  allowedCounterparties?: Address[];
};

function toFlowMask(flows: OutgoingBudgetFlow[]) {
  let mask = 0;

  for (const flow of flows) {
    if (flow === "transfer") {
      mask |= 0x01;
    } else if (flow === "approve") {
      mask |= 0x02;
    }
  }

  return mask;
}

export function isAgentOutgoingBudgetPolicyParams(
  value: unknown,
): value is AgentOutgoingBudgetPolicyParams {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { type?: unknown };
  return candidate.type === AGENT_OUTGOING_BUDGET_POLICY_TYPE;
}

export function toAgentOutgoingBudgetPolicy(input: {
  policyAddress: Address;
  tokenAddress: Address;
  limitBaseUnits: string | bigint;
  period: OutgoingBudgetPeriod;
  allowedFlows: OutgoingBudgetFlow[];
  allowedCounterparties?: Address[];
  policyFlag?: PolicyFlags;
}) {
  const limitBaseUnits =
    typeof input.limitBaseUnits === "bigint"
      ? input.limitBaseUnits.toString()
      : input.limitBaseUnits;
  const periodSeconds = toOutgoingBudgetPeriodSeconds(input.period);
  const policyFlag = input.policyFlag ?? PolicyFlags.NOT_FOR_VALIDATE_SIG;
  const allowedCounterparties = input.allowedCounterparties ?? [];
  const flowMask = toFlowMask(input.allowedFlows);

  return {
    getPolicyData: () =>
      encodeAbiParameters(
        [
          { name: "token", type: "address" },
          { name: "limit", type: "uint256" },
          { name: "periodSeconds", type: "uint48" },
          { name: "flowMask", type: "uint8" },
          { name: "allowedCounterparties", type: "address[]" },
        ],
        [
          input.tokenAddress,
          BigInt(limitBaseUnits),
          periodSeconds,
          flowMask,
          allowedCounterparties,
        ],
      ),
    getPolicyInfoInBytes: () => concatHex([policyFlag, input.policyAddress]),
    policyParams: {
      type: AGENT_OUTGOING_BUDGET_POLICY_TYPE,
      policyAddress: input.policyAddress,
      policyFlag,
      tokenAddress: input.tokenAddress,
      limitBaseUnits,
      period: input.period,
      periodSeconds,
      allowedFlows: input.allowedFlows,
      allowedCounterparties,
    } satisfies AgentOutgoingBudgetPolicyParams,
  } as unknown as Policy;
}
