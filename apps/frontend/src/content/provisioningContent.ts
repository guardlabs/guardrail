import type {
  WalletPolicy,
  WalletRequestStatus,
} from "@guardlabs/guardrail-core";
import { formatUnits } from "viem";

type FundingStatus = "unverified" | "insufficient" | "verified";

export type ProvisioningContentModel = {
  statusEyebrow: string;
  statusTitle: string;
  statusBody: string;
  statusLabel: string;
  reassurance: string;
  actionTitle: string;
  actionBody: string;
  primaryActionLabel: string;
  permissionItems: string[];
  fundingLabel: string;
  fundingGuidance: string | null;
  technicalPolicySummary: {
    contractSummary: string | null;
    usdcSummary: string | null;
    usdcBudgetSummary: string | null;
  };
};

function formatUsdcBudget(policy: WalletPolicy["usdcPolicy"]) {
  if (!policy) {
    return null;
  }

  const periodLabel =
    policy.period === "daily"
      ? "day"
      : policy.period === "weekly"
        ? "week"
        : "month";

  return `${formatUnits(BigInt(policy.maxAmountMinor), 6)} USDC per ${periodLabel}`;
}

function describeRuntimePolicy(policy: WalletPolicy) {
  const contractSummary = policy.contractAllowlist?.length
    ? `${policy.contractAllowlist.length} contract${
        policy.contractAllowlist.length > 1 ? "s" : ""
      } with explicit selectors only`
    : null;
  const usdcSummary = policy.usdcPolicy
    ? `Official USDC only: ${policy.usdcPolicy.allowedOperations.join(", ")}`
    : null;

  return {
    contractSummary,
    usdcSummary,
    usdcBudgetSummary: formatUsdcBudget(policy.usdcPolicy),
  };
}

export function formatFundingLabel(status: FundingStatus) {
  switch (status) {
    case "verified":
      return "Funding verified";
    case "insufficient":
      return "Funding still required";
    default:
      return "Funding not checked yet";
  }
}

export function getProvisioningContentModel(input: {
  status: WalletRequestStatus;
  fundingStatus: FundingStatus;
  policy: WalletPolicy;
  isAwaitingOwnerConfirmation?: boolean;
}): ProvisioningContentModel {
  const technicalPolicySummary = describeRuntimePolicy(input.policy);
  const usdcPermission = input.policy.usdcPolicy
    ? "Use official USDC within the configured budget."
    : "Operate only within the approved policy.";
  const contractPermission = input.policy.contractAllowlist?.length
    ? "Call only approved contract methods."
    : null;

  const permissionItems = [
    usdcPermission,
    contractPermission,
    "Anything outside policy is blocked by default.",
  ].filter((item): item is string => Boolean(item));

  switch (input.status) {
    case "owner_bound":
      return {
        statusEyebrow: "Provisioning",
        statusTitle:
          input.fundingStatus === "verified"
            ? "Final checks in progress"
            : "Fund the wallet",
        statusBody:
          input.fundingStatus === "verified"
            ? "Funding has been detected. The wallet is finishing activation."
            : "Ownership is attached. Add the required onchain balance so the wallet can complete activation.",
        statusLabel:
          input.fundingStatus === "verified" ? "Checking" : "Needs funding",
        reassurance:
          input.fundingStatus === "verified"
            ? "Your passkey is already attached on this device."
            : "Funding completes setup. It does not change who controls the wallet.",
        actionTitle:
          input.fundingStatus === "verified"
            ? "Wait for readiness"
            : "Send the required balance",
        actionBody:
          input.fundingStatus === "verified"
            ? "No extra approval is needed right now. Keep this page open while the final check completes."
            : "Transfer the minimum amount to the wallet address below. This page keeps checking automatically.",
        primaryActionLabel: "Ownership confirmed",
        permissionItems,
        fundingLabel: formatFundingLabel(input.fundingStatus),
        fundingGuidance:
          input.fundingStatus === "verified"
            ? "Funding has been detected. The screen keeps checking until the wallet is fully ready."
            : "Send the required amount to the wallet address shown below. The page refreshes funding automatically.",
        technicalPolicySummary,
      };
    case "ready":
      return {
        statusEyebrow: "Provisioning",
        statusTitle: "Wallet ready",
        statusBody:
          "The wallet is active and can now be used within the approved policy.",
        statusLabel: "Ready",
        reassurance: "Your passkey remains the admin control.",
        actionTitle: "Setup complete",
        actionBody:
          "Nothing else is required on this page unless you want to review the technical details.",
        primaryActionLabel: "Setup complete",
        permissionItems,
        fundingLabel: formatFundingLabel(input.fundingStatus),
        fundingGuidance: null,
        technicalPolicySummary,
      };
    case "failed":
      return {
        statusEyebrow: "Provisioning",
        statusTitle: "Provisioning needs attention",
        statusBody:
          "Something interrupted setup. Review the error below and try again.",
        statusLabel: "Needs attention",
        reassurance: "No new permissions are granted until setup succeeds.",
        actionTitle: "Retry the operator approval",
        actionBody:
          "You can attempt passkey creation again once the issue is clear.",
        primaryActionLabel: "Try creating the passkey again",
        permissionItems,
        fundingLabel: formatFundingLabel(input.fundingStatus),
        fundingGuidance: null,
        technicalPolicySummary,
      };
    case "created":
    default:
      if (input.isAwaitingOwnerConfirmation) {
        return {
          statusEyebrow: "Provisioning",
          statusTitle: "Approve wallet ownership",
          statusBody:
            "Your passkey is saved. Approve one signature with it to attach the wallet owner.",
          reassurance:
            "This confirms wallet ownership only. It does not expand the agent policy.",
          statusLabel: "Needs approval",
          actionTitle: "Confirm the owner signature",
          actionBody:
            "Use the passkey you just created to approve the Kernel ownership signature.",
          primaryActionLabel: "Approve ownership signature",
          permissionItems,
          fundingLabel: formatFundingLabel(input.fundingStatus),
          fundingGuidance: null,
          technicalPolicySummary,
        };
      }

      return {
        statusEyebrow: "Provisioning",
        statusTitle: "Create the passkey",
        statusBody:
          "Approve wallet ownership on this device. This passkey becomes the durable admin for the wallet.",
        reassurance:
          "The agent only receives limited runtime access after setup.",
        statusLabel: "Needs passkey",
        actionTitle: "Approve ownership on this device",
        actionBody:
          "Use the secure browser prompt to create the passkey and attach it to this wallet.",
        primaryActionLabel: "Create passkey",
        permissionItems,
        fundingLabel: formatFundingLabel(input.fundingStatus),
        fundingGuidance: null,
        technicalPolicySummary,
      };
  }
}
