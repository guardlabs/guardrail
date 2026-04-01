import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROJECT_WALLET_MODE,
  buildDefaultWalletConfig,
  type ResolveProvisioningResponse,
  type WalletPolicy,
  type WalletRequest,
} from "@conduit/shared";
import { App } from "./App.js";

const walletConfig = buildDefaultWalletConfig({
  chainId: 84532,
  agentAddress: "0x95b4d8f3a9f0ac9d4d7f9ef42fb0f4f6e11d1111",
  backendAddress: "0x1111111111111111111111111111111111111111",
});
const regularValidatorInitArtifact = {
  validatorAddress: "0x3333333333333333333333333333333333333333",
  enableData: "0x1234",
  pluginEnableSignature: "0x5678",
} as const;

function createRuntimePolicy(): WalletPolicy {
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
      allowedOperations: ["transfer", "approve", "increaseAllowance", "permit", "transferWithAuthorization"],
    },
  };
}

function buildProvisioningResponse(
  overrides: Partial<ResolveProvisioningResponse> = {},
): ResolveProvisioningResponse {
  return {
    walletMode: PROJECT_WALLET_MODE,
    walletId: "wal_test",
    status: "created",
    walletConfig,
    policy: createRuntimePolicy(),
    agentAddress: walletConfig.regularValidator.signers[0]?.address ?? "",
    backendAddress: walletConfig.regularValidator.signers[1]?.address ?? "",
    ownerPublicArtifacts: undefined,
    regularValidatorInitArtifact: undefined,
    counterfactualWalletAddress: null,
    funding: {
      status: "unverified",
      minimumRequiredWei: "500000000000000",
    },
    deployment: {
      status: "undeployed",
    },
    expiresAt: "2026-03-30T10:00:00.000Z",
    ...overrides,
  };
}

function buildWalletRequest(
  overrides: Partial<WalletRequest> = {},
): WalletRequest {
  return {
    walletMode: PROJECT_WALLET_MODE,
    walletId: "wal_test",
    status: "ready",
    walletConfig,
    policy: createRuntimePolicy(),
    agentAddress: walletConfig.regularValidator.signers[0]?.address ?? "",
    backendAddress: walletConfig.regularValidator.signers[1]?.address ?? "",
    counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
    regularValidatorInitArtifact,
    funding: {
      status: "verified",
      minimumRequiredWei: "500000000000000",
      balanceWei: "600000000000000",
      checkedAt: "2026-03-29T12:00:00.000Z",
    },
    deployment: {
      status: "deployed",
    },
    walletContext: {
      walletAddress: "0x2222222222222222222222222222222222222222",
      chainId: 84532,
      kernelVersion: "3.1",
      entryPointVersion: "0.7",
      owner: {
        credentialId: "credential-id",
        publicKey: "0x1234",
      },
      agentAddress: walletConfig.regularValidator.signers[0]?.address ?? "",
      backendAddress: walletConfig.regularValidator.signers[1]?.address ?? "",
      weightedValidator: walletConfig.regularValidator,
    },
    createdAt: "2026-03-29T11:00:00.000Z",
    updatedAt: "2026-03-29T12:00:00.000Z",
    expiresAt: "2026-03-30T10:00:00.000Z",
    ...overrides,
  };
}

describe("frontend app mode B", () => {
  afterEach(() => {
    cleanup();
  });

  it("loads a provisioning request and completes owner binding", async () => {
    const loadProvisioningRequest = vi
      .fn<() => Promise<ResolveProvisioningResponse>>()
      .mockResolvedValue(buildProvisioningResponse());
    const createProvisioningArtifacts = vi
      .fn<
        () => Promise<{
          owner: { credentialId: string; publicKey: string };
          counterfactualWalletAddress: string;
          regularValidatorInitArtifact: typeof regularValidatorInitArtifact;
        }>
      >()
      .mockResolvedValue({
        owner: {
          credentialId: "credential-id",
          publicKey: "0x1234",
        },
        counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
        regularValidatorInitArtifact,
      });
    const publishOwnerArtifacts = vi
      .fn<() => Promise<WalletRequest>>()
      .mockResolvedValue(buildWalletRequest());
    const refreshFunding = vi.fn<() => Promise<WalletRequest>>();

    render(
      <App
        search="?walletId=wal_test&token=token_123&backendUrl=http://127.0.0.1:3000"
        api={{
          loadProvisioningRequest,
          publishOwnerArtifacts,
          refreshFunding,
        }}
        passkeyClient={{
          createProvisioningArtifacts,
        }}
      />,
    );

    expect(
      await screen.findByText(/set up this wallet/i),
    ).toBeInTheDocument();
    expect(loadProvisioningRequest).toHaveBeenCalledWith({
      walletId: "wal_test",
      token: "token_123",
      backendUrl: "http://127.0.0.1:3000",
    });

    fireEvent.click(screen.getByRole("button", { name: /create passkey/i }));

    await waitFor(() => {
      expect(createProvisioningArtifacts).toHaveBeenCalledWith({
        displayName: "Conduit Wallet",
        walletConfig,
      });
    });

    expect(publishOwnerArtifacts).toHaveBeenCalledWith({
      walletId: "wal_test",
      token: "token_123",
      backendUrl: "http://127.0.0.1:3000",
      owner: {
        credentialId: "credential-id",
        publicKey: "0x1234",
      },
      counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
      regularValidatorInitArtifact,
    });

    expect(
      await screen.findByRole("heading", { name: /wallet ready/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /wallet permissions/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/your passkey remains the admin control/i),
    ).toBeInTheDocument();

    const technicalDetailsButton = screen.getByRole("button", {
      name: /technical details/i,
    });

    expect(technicalDetailsButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/backend signer/i)).not.toBeInTheDocument();

    fireEvent.click(technicalDetailsButton);

    expect(technicalDetailsButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/backend signer/i)).toBeInTheDocument();
    expect(screen.getByText(/0x2222/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(walletConfig.regularValidator.threshold.toString()).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/transferwithauthorization/i)).toBeInTheDocument();
  });

  it("shows a clear error when the provisioning link is incomplete", () => {
    render(<App search="?walletId=wal_test" />);

    expect(screen.getByText(/invalid provisioning link/i)).toBeInTheDocument();
    expect(
      screen.getByText(/open the full link from the cli output/i),
    ).toBeInTheDocument();
  });

  it("shows the homepage when opened without provisioning params", () => {
    render(<App search="" />);

    expect(
      screen.getByRole("heading", { name: /secure wallet rails for autonomous agents/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /quickstart/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /install, provision, use/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /github/i }),
    ).toBeInTheDocument();
  });

  it("polls funding after owner binding until the wallet is ready", async () => {
    const setIntervalSpy = vi
      .spyOn(window, "setInterval")
      .mockImplementation(((callback: TimerHandler) => {
        queueMicrotask(() => {
          void (callback as () => void)();
        });
        return 1;
      }) as typeof window.setInterval);
    const clearIntervalSpy = vi
      .spyOn(window, "clearInterval")
      .mockImplementation(() => {});

    const loadProvisioningRequest = vi
      .fn<() => Promise<ResolveProvisioningResponse>>()
      .mockResolvedValue(buildProvisioningResponse());
    const createProvisioningArtifacts = vi
      .fn<
        () => Promise<{
          owner: { credentialId: string; publicKey: string };
          counterfactualWalletAddress: string;
          regularValidatorInitArtifact: typeof regularValidatorInitArtifact;
        }>
      >()
      .mockResolvedValue({
        owner: {
          credentialId: "credential-id",
          publicKey: "0x1234",
        },
        counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
        regularValidatorInitArtifact,
      });
    const publishOwnerArtifacts = vi
      .fn<() => Promise<WalletRequest>>()
      .mockResolvedValue(
        buildWalletRequest({
          status: "owner_bound",
          funding: {
            status: "insufficient",
            minimumRequiredWei: "500000000000000",
            balanceWei: "0",
            checkedAt: "2026-03-29T11:59:00.000Z",
          },
        }),
      );
    const refreshFunding = vi
      .fn<() => Promise<WalletRequest>>()
      .mockResolvedValue(buildWalletRequest());

    render(
      <App
        search="?walletId=wal_test&token=token_123&backendUrl=http://127.0.0.1:3000"
        api={{
          loadProvisioningRequest,
          publishOwnerArtifacts,
          refreshFunding,
        }}
        passkeyClient={{
          createProvisioningArtifacts,
        }}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /create passkey/i }),
    );

    await waitFor(() => {
      expect(refreshFunding).toHaveBeenCalledWith({
        walletId: "wal_test",
        backendUrl: "http://127.0.0.1:3000",
      });
    });

    expect(
      await screen.findByRole("heading", { name: /wallet ready/i }),
    ).toBeInTheDocument();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it("shows one dominant next action when funding is required", async () => {
    const loadProvisioningRequest = vi
      .fn<() => Promise<ResolveProvisioningResponse>>()
      .mockResolvedValue(
        buildProvisioningResponse({
          status: "owner_bound",
          counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
          funding: {
            status: "insufficient",
            minimumRequiredWei: "500000000000000",
            balanceWei: "0",
            checkedAt: "2026-03-29T11:59:00.000Z",
          },
        }),
      );

    render(
      <App
        search="?walletId=wal_test&token=token_123&backendUrl=http://127.0.0.1:3000"
        api={{
          loadProvisioningRequest,
          publishOwnerArtifacts: vi.fn(),
          refreshFunding: vi
            .fn<() => Promise<WalletRequest>>()
            .mockResolvedValue(
              buildWalletRequest({
                status: "owner_bound",
                funding: {
                  status: "insufficient",
                  minimumRequiredWei: "500000000000000",
                  balanceWei: "0",
                  checkedAt: "2026-03-29T11:59:00.000Z",
                },
              }),
            ),
        }}
        passkeyClient={{
          createProvisioningArtifacts: vi.fn(),
        }}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: /fund the wallet/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /technical details/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /passkey already created/i }),
    ).toBeDisabled();
  });

  it("shows a recoverable backend error without dropping the screen structure", async () => {
    const loadProvisioningRequest = vi
      .fn<() => Promise<ResolveProvisioningResponse>>()
      .mockResolvedValue(buildProvisioningResponse());
    const createProvisioningArtifacts = vi
      .fn<
        () => Promise<{
          owner: { credentialId: string; publicKey: string };
          counterfactualWalletAddress: string;
          regularValidatorInitArtifact: typeof regularValidatorInitArtifact;
        }>
      >()
      .mockResolvedValue({
        owner: {
          credentialId: "credential-id",
          publicKey: "0x1234",
        },
        counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
        regularValidatorInitArtifact,
      });
    const publishOwnerArtifacts = vi
      .fn<() => Promise<WalletRequest>>()
      .mockRejectedValue(new Error("Unable to save passkey owner."));

    render(
      <App
        search="?walletId=wal_test&token=token_123&backendUrl=http://127.0.0.1:3000"
        api={{
          loadProvisioningRequest,
          publishOwnerArtifacts,
          refreshFunding: vi.fn(),
        }}
        passkeyClient={{
          createProvisioningArtifacts,
        }}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /create passkey/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/unable to save passkey owner/i);
    expect(
      screen.getByRole("heading", { name: /create the passkey/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /wallet permissions/i }),
    ).toBeInTheDocument();
  });
});
