import { useEffect, useMemo, useState } from "react";
import type { ResolveProvisioningResponse, WalletRequest } from "@agent-wallet/shared";
import { PROJECT_DEFAULT_BACKEND_URL } from "@agent-wallet/shared";
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
        displayName: "Agent Wallet",
        scope: request.scope,
        sessionPublicKey: request.sessionPublicKey,
      });

      const updatedRequest = await api.publishOwnerArtifacts({
        ...query,
        owner: provisioningArtifacts.owner,
        counterfactualWalletAddress:
          provisioningArtifacts.counterfactualWalletAddress,
        serializedPermissionAccount:
          provisioningArtifacts.serializedPermissionAccount,
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

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Agent Wallet</p>
          <h1>Provision this wallet</h1>
          <p className="lede">
            Create the passkey owner on this device, then fund the wallet if the
            wallet requires it.
          </p>
        </div>
        <div className="hero-side">
          <span className={`status-pill status-${status}`}>
            {status === "ready" ? "Wallet ready" : "Provisioning in progress"}
          </span>
          <p className="side-note">
            The wallet is real and the agent stays limited to the scoped permissions.
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
          <p>Checking the wallet and the allowed permissions.</p>
        </section>
      ) : (
        <section className="workspace">
          <div className="workspace-main">
            <div className="section-head">
              <p className="section-kicker">Secure wallet access</p>
              <h2>Create a passkey on this device</h2>
            </div>

            <p className="support-copy">
              You are approving a wallet owner for one agent wallet. The agent
              will not receive your passkey secret.
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
              <strong>Base Sepolia ({request?.scope.chainId ?? "pending"})</strong>
            </div>
            <div className="detail-line">
              <span>Target contract</span>
              <code>{request?.scope.targetContract ?? "Loading..."}</code>
            </div>
            <div className="detail-line">
              <span>Allowed methods</span>
              <strong>{request?.scope.allowedMethods.length ?? 0}</strong>
            </div>
            <div className="detail-line">
              <span>Funding</span>
              <strong>{funding ? formatFundingLabel(funding.status) : "Pending"}</strong>
            </div>
            <div className="detail-line">
              <span>Minimum funding</span>
              <code>{funding?.minimumRequiredWei ?? "Pending"}</code>
            </div>
          </aside>
        </section>
      )}
    </main>
  );
}
