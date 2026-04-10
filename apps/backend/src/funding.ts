import type { FundingState } from "@guardlabs/guardrail-core";

export function compareWei(left: string, right: string) {
  const leftWei = BigInt(left);
  const rightWei = BigInt(right);

  if (leftWei === rightWei) {
    return 0;
  }

  return leftWei > rightWei ? 1 : -1;
}

export function buildFundingState(input: {
  balanceWei: string;
  checkedAt: string;
  minimumRequiredWei: string;
}): FundingState {
  return {
    status:
      compareWei(input.balanceWei, input.minimumRequiredWei) >= 0
        ? "verified"
        : "insufficient",
    balanceWei: input.balanceWei,
    checkedAt: input.checkedAt,
    minimumRequiredWei: input.minimumRequiredWei,
  };
}
