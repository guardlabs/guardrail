import { useEffect, useMemo, useState } from "react";
import type { ResolveProvisioningResponse, WalletRequest } from "@conduit/shared";
import { getSupportedChainById, PROJECT_DEFAULT_BACKEND_URL } from "@conduit/shared";
import type { FrontendApi } from "./api.js";
import { browserApi } from "./api.js";
import { MarketingHome } from "./components/MarketingHome.js";
import { PermissionSummary } from "./components/PermissionSummary.js";
import { ProvisioningLayout } from "./components/ProvisioningLayout.js";
import { TechnicalDetailsDisclosure } from "./components/TechnicalDetailsDisclosure.js";
import { getProvisioningContentModel } from "./content/provisioningContent.js";
import type { PasskeyClient } from "./passkey.js";
import { parseProvisioningQuery } from "./provisioning.js";
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

function hasWalletContext(
  request: ResolveProvisioningResponse | WalletRequest | null,
): request is WalletRequest & {
  walletContext: NonNullable<WalletRequest["walletContext"]>;
} {
  return Boolean(request && "walletContext" in request && request.walletContext);
}

function getChainLabel(chainId: number) {
  return getSupportedChainById(chainId)?.name ?? `Chain ${chainId}`;
}

function formatCompactValue(value: string | null | undefined) {
  if (!value) {
    return "Pending";
  }

  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function MessageState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <section className="cw-message-state">
      <p className="cw-kicker">Provisioning</p>
      <h2>{title}</h2>
      <p>{body}</p>
    </section>
  );
}

function TechnicalDetail({
  label,
  value,
  code,
}: {
  label: string;
  value: string;
  code?: boolean;
}) {
  return (
    <div className="cw-detail-row">
      <span>{label}</span>
      {code ? <code>{value}</code> : <strong>{value}</strong>}
    </div>
  );
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
  const hasProvisioningIntent = useMemo(() => {
    const params = new URLSearchParams(currentSearch);
    return params.has("walletId") || params.has("token");
  }, [currentSearch]);

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
  const contentModel = request
    ? getProvisioningContentModel({
        status,
        fundingStatus: funding?.status ?? "unverified",
        policy: request.policy,
      })
    : null;
  const chainLabel = request ? getChainLabel(request.walletConfig.chainId) : "Supported network";
  const isPrimaryActionDisabled =
    isSubmitting || status === "owner_bound" || status === "ready";
  const walletAddress =
    request?.counterfactualWalletAddress ??
    (hasWalletContext(request) ? request.walletContext.walletAddress : null);

  if (!hasProvisioningIntent) {
    return <MarketingHome />;
  }

  const hero = (
    <>
      <div className="cw-hero-copy">
        <div className="cw-brand-row">
          <p className="cw-eyebrow">Conduit Wallet</p>
          <span className="cw-hero-chip">Human-controlled provisioning</span>
        </div>
        <h1>Set up this wallet</h1>
        <p className="cw-lede">
          Create the human passkey for this wallet, then fund it if activation
          requires it.
        </p>

        <div className="cw-hero-meta" aria-label="Wallet snapshot">
          <div className="cw-hero-meta-item">
            <span>Network</span>
            <strong>{chainLabel}</strong>
          </div>
          <div className="cw-hero-meta-item">
            <span>Wallet ID</span>
            <strong>{formatCompactValue(request?.walletId ?? null)}</strong>
          </div>
          <div className="cw-hero-meta-item">
            <span>Funding</span>
            <strong>{contentModel?.fundingLabel ?? "Loading"}</strong>
          </div>
        </div>
      </div>
    </>
  );

  const technicalDetails = request && contentModel ? (
    <TechnicalDetailsDisclosure summary="Technical details">
      <div className="cw-technical-grid">
        <TechnicalDetail label="Wallet ID" value={request.walletId} code />
        <TechnicalDetail
          label="Chain"
          value={`${chainLabel} (${request.walletConfig.chainId})`}
        />
        <TechnicalDetail
          label="Threshold"
          value={request.walletConfig.regularValidator.threshold.toString()}
        />
        <TechnicalDetail label="Agent signer" value={request.agentAddress} code />
        <TechnicalDetail label="Backend signer" value={request.backendAddress} code />
        <TechnicalDetail label="Funding" value={contentModel.fundingLabel} />
        <TechnicalDetail
          label="Minimum funding (wei)"
          value={request.funding.minimumRequiredWei}
          code
        />
      </div>

      <div className="cw-policy-block">
        <p className="cw-kicker">Runtime policy</p>
        <h3>Agent + backend co-signing</h3>
        <p>
          Denied by default. Only the rules below can execute without your direct
          intervention. Your passkey does not use this policy.
        </p>
        {contentModel.technicalPolicySummary.contractSummary ? (
          <TechnicalDetail
            label="Contracts"
            value={contentModel.technicalPolicySummary.contractSummary}
          />
        ) : null}
        {contentModel.technicalPolicySummary.usdcSummary ? (
          <TechnicalDetail
            label="USDC"
            value={contentModel.technicalPolicySummary.usdcSummary}
          />
        ) : null}
        {contentModel.technicalPolicySummary.usdcBudgetSummary ? (
          <TechnicalDetail
            label="Budget"
            value={contentModel.technicalPolicySummary.usdcBudgetSummary}
          />
        ) : null}
      </div>
    </TechnicalDetailsDisclosure>
  ) : (
    <MessageState
      title="Technical details appear once the request loads"
      body="Signer addresses, thresholds, and funding requirements stay tucked away until the wallet is available."
    />
  );

  const secondary = request && contentModel ? (
    <>
      <PermissionSummary items={contentModel.permissionItems} />
      {technicalDetails}
    </>
  ) : (
    technicalDetails
  );

  const primary = !query ? (
    <MessageState
      title="Invalid provisioning link"
      body="Open the full link from the CLI output to continue."
    />
  ) : !request && !error ? (
    <MessageState
      title="Loading wallet"
      body="Checking the wallet request, passkey state, and activation requirements."
    />
  ) : request && contentModel ? (
    <div className="cw-flow">
      <section className="cw-action-panel">
        <div className="cw-card-head">
          <div className="cw-card-head-top">
            <p className="cw-kicker">{contentModel.statusEyebrow}</p>
            <span className={`cw-status-pill cw-status-pill-${status}`}>
              {contentModel.statusLabel}
            </span>
          </div>
          <h2>{contentModel.statusTitle}</h2>
          <p className="cw-card-copy">{contentModel.statusBody}</p>
        </div>

        <button
          className="cw-primary-button"
          disabled={isPrimaryActionDisabled}
          onClick={() => {
            void handleCreatePasskey();
          }}
          type="button"
        >
          {isSubmitting ? "Creating passkey..." : contentModel.primaryActionLabel}
        </button>

        <p className="cw-support-copy cw-support-note">{contentModel.reassurance}</p>

        {error ? (
          <p className="cw-error-copy" role="alert">
            {error}
          </p>
        ) : null}

        {walletAddress ? (
          <div className="cw-wallet-readout">
            <div className="cw-readout-head">
              <p className="cw-kicker">Wallet address</p>
              <span>Use this exact destination on {chainLabel}</span>
            </div>
            <code>{walletAddress}</code>
          </div>
        ) : null}

        {request.status === "owner_bound" ? (
          <div aria-live="polite" className="cw-funding-callout">
            <div className="cw-card-head">
              <p className="cw-kicker">Activation</p>
              <h3>
                {request.funding.status === "verified"
                  ? "Final readiness checks in progress"
                  : "Send funds to the wallet address"}
              </h3>
              <p>
                {request.funding.status === "verified"
                  ? "Funding was detected and the wallet is completing its final readiness check."
                  : `Send at least ${request.funding.minimumRequiredWei} wei to the wallet address above on ${chainLabel}.`}
              </p>
            </div>
            <p className="cw-support-copy">
              {contentModel.fundingGuidance}{" "}
              {isRefreshingFunding ? "Checking again now..." : "Refreshes every 5 seconds."}
            </p>
          </div>
        ) : null}
      </section>
    </div>
  ) : (
    <MessageState
      title="Unable to load this provisioning request"
      body={error ?? "The provisioning request could not be loaded."}
    />
  );

  return <ProvisioningLayout hero={hero} primary={primary} secondary={secondary} />;
}
