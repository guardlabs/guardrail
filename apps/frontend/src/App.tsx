import { useEffect, useMemo, useState } from "react";
import type { ResolveProvisioningResponse, WalletPolicy, WalletRequest } from "@conduit/shared";
import { PROJECT_DEFAULT_BACKEND_URL } from "@conduit/shared";
import { formatUnits } from "viem";
import type { FrontendApi } from "./api.js";
import { browserApi } from "./api.js";
import type { PasskeyClient } from "./passkey.js";
import { formatFundingLabel, parseProvisioningQuery } from "./provisioning.js";
import "./styles.css";

const resolvedBackendUrl = __DEFAULT_BACKEND_URL__ ?? PROJECT_DEFAULT_BACKEND_URL;

type AppProps = {
  search?: string;
  api?: FrontendApi;
  passkeyClient?: PasskeyClient;
};

async function loadBrowserPasskeyClient() {
  const module = await import("./passkey.js");
  return module.browserPasskeyClient;
}

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

export function App({
  search,
  api = browserApi,
  passkeyClient,
}: AppProps) {
  const [request, setRequest] = useState<ResolveProvisioningResponse | WalletRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshingFunding, setIsRefreshingFunding] = useState(false);
  const currentSearch =
    search ?? (typeof window !== "undefined" ? window.location.search : "");

  const query = useMemo(() => {
    try {
      return parseProvisioningQuery(currentSearch, resolvedBackendUrl);
    } catch {
      return null;
    }
  }, [currentSearch]);

  useEffect(() => {
    if (!query) {
      return;
    }

    let cancelled = false;

    void api
      .loadProvisioningRequest(query)
      .then((nextRequest) => {
        if (!cancelled) {
          setRequest(nextRequest);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load wallet.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, query]);

  useEffect(() => {
    if (!query || request?.status !== "owner_bound") {
      return;
    }

    let cancelled = false;

    const intervalId = window.setInterval(() => {
      setIsRefreshingFunding(true);

      void api
        .refreshFunding({
          walletId: query.walletId,
          backendUrl: query.backendUrl,
        })
        .then((nextRequest) => {
          if (!cancelled) {
            setRequest(nextRequest);
          }
        })
        .catch((nextError) => {
          if (!cancelled) {
            setError(
              nextError instanceof Error
                ? nextError.message
                : "Unable to refresh funding state.",
            );
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsRefreshingFunding(false);
          }
        });
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [api, query, request?.status]);

  async function handleCreatePasskey() {
    if (!query) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      if (!request) {
        throw new Error("Provisioning wallet not loaded.");
      }

      const resolvedPasskeyClient =
        passkeyClient ?? (await loadBrowserPasskeyClient());
      const provisioningArtifacts =
        await resolvedPasskeyClient.createProvisioningArtifacts({
        displayName: "Conduit Wallet",
        walletConfig: request.walletConfig,
      });

      const updatedRequest = await api.publishOwnerArtifacts({
        ...query,
        owner: provisioningArtifacts.owner,
        counterfactualWalletAddress:
          provisioningArtifacts.counterfactualWalletAddress,
        regularValidatorInitArtifact:
          provisioningArtifacts.regularValidatorInitArtifact,
      });

      setRequest(updatedRequest);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Passkey provisioning failed.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const status = request?.status ?? "created";
  const funding = request?.funding;
  const policySummary = request ? describeRuntimePolicy(request.policy) : null;

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Conduit</p>
          <h1>Provision this wallet</h1>
          <p className="lede">
            Create the Conduit Wallet passkey owner on this device, then fund
            the wallet if activation requires it.
          </p>
        </div>
        <div className="hero-side">
          <span className={`status-pill status-${status}`}>
            {status === "ready" ? "Wallet ready" : "Provisioning in progress"}
          </span>
          <p className="side-note">
            Runtime transactions require both the local agent and the backend co-signer.
          </p>
        </div>
      </section>

      {!query ? (
        <section className="message-panel">
          <h2>Invalid provisioning link</h2>
          <p>Open the full link from the CLI output to continue.</p>
        </section>
      ) : !request && !error ? (
        <section className="message-panel">
          <h2>Loading wallet</h2>
          <p>Checking the wallet and its weighted multisig configuration.</p>
        </section>
      ) : (
        <section className="workspace">
          <div className="workspace-main">
            <div className="section-head">
              <p className="section-kicker">Secure wallet access</p>
              <h2>Create a passkey on this device</h2>
            </div>

            <p className="support-copy">
              You are approving a passkey owner for one Conduit Wallet. The
              agent will not receive your passkey secret.
            </p>

            <button
              className="primary-button"
              disabled={isSubmitting || status === "ready"}
              onClick={() => {
                void handleCreatePasskey();
              }}
              type="button"
            >
              {status === "ready"
                ? "Passkey already created"
                : isSubmitting
                  ? "Creating passkey..."
                  : "Create a passkey"}
            </button>

            {error ? (
              <p className="error-copy" role="alert">
                {error}
              </p>
            ) : null}

            {request?.counterfactualWalletAddress ? (
              <div className="wallet-readout">
                <p className="section-kicker">Wallet address</p>
                <code>{request.counterfactualWalletAddress}</code>
              </div>
            ) : null}

            {request?.status === "owner_bound" ? (
              <div className="funding-callout" aria-live="polite">
                <p className="section-kicker">Next step</p>
                <h3>Fund this wallet to continue activation</h3>
                <p>
                  Send at least {request.funding.minimumRequiredWei} wei to the wallet
                  address above on Base Sepolia.
                </p>
                <p className="support-copy">
                  Checking funding status automatically
                  {isRefreshingFunding ? "..." : " every 5 seconds."}
                </p>
              </div>
            ) : null}
          </div>

          <aside className="workspace-side">
            <div className="detail-line">
              <span>Chain</span>
              <strong>Base Sepolia ({request?.walletConfig.chainId ?? "pending"})</strong>
            </div>
            <div className="detail-line">
              <span>Threshold</span>
              <strong>{request?.walletConfig.regularValidator.threshold ?? "Pending"}</strong>
            </div>
            <div className="detail-line">
              <span>Agent signer</span>
              <code>{request?.agentAddress ?? "Pending"}</code>
            </div>
            <div className="detail-line">
              <span>Backend signer</span>
              <code>{request?.backendAddress ?? "Pending"}</code>
            </div>
            <div className="detail-line">
              <span>Funding</span>
              <strong>{funding ? formatFundingLabel(funding.status) : "Pending"}</strong>
            </div>
            <div className="detail-line">
              <span>Minimum funding</span>
              <code>{funding?.minimumRequiredWei ?? "Pending"}</code>
            </div>
            {request ? (
              <div className="policy-panel">
                <p className="section-kicker">Runtime policy</p>
                <h3>Agent + backend co-signer</h3>
                <p className="policy-copy">
                  Deny by default. The passkey keeps full admin access and does not use
                  this policy.
                </p>
                {policySummary?.contractSummary ? (
                  <div className="policy-line">
                    <span>Contracts</span>
                    <strong>{policySummary.contractSummary}</strong>
                  </div>
                ) : null}
                {policySummary?.usdcSummary ? (
                  <div className="policy-line">
                    <span>USDC</span>
                    <strong>{policySummary.usdcSummary}</strong>
                  </div>
                ) : null}
                {policySummary?.usdcBudgetSummary ? (
                  <div className="policy-line">
                    <span>Budget</span>
                    <strong>{policySummary.usdcBudgetSummary}</strong>
                  </div>
                ) : null}
              </div>
            ) : null}
          </aside>
        </section>
      )}
    </main>
  );
}
