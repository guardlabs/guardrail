import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolveProvisioningResponse, WalletRequest } from "@agent-wallet/shared";
import { App } from "./App.js";

function buildProvisioningResponse(
  overrides: Partial<ResolveProvisioningResponse> = {},
): ResolveProvisioningResponse {
  return {
    walletId: "wal_test",
    status: "created",
    scope: {
      chainId: 84532,
      contractPermissions: [
        {
          targetContract: "0x1111111111111111111111111111111111111111",
          allowedMethods: ["0xa9059cbb"],
        },
      ],
    },
    sessionPublicKey: "0x1234",
    ownerPublicArtifacts: undefined,
    counterfactualWalletAddress: null,
    funding: {
      status: "unverified",
      minimumRequiredWei: "500000000000000",
    },
    expiresAt: "2026-03-26T10:00:00.000Z",
    ...overrides,
  };
}

function buildWalletRequest(
  overrides: Partial<WalletRequest> = {},
): WalletRequest {
  return {
    walletId: "wal_test",
    status: "ready",
    scope: {
      chainId: 84532,
      contractPermissions: [
        {
          targetContract: "0x1111111111111111111111111111111111111111",
          allowedMethods: ["0xa9059cbb"],
        },
      ],
    },
    sessionPublicKey: "0x1234",
    counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
    funding: {
      status: "verified",
      minimumRequiredWei: "500000000000000",
      balanceWei: "600000000000000",
      checkedAt: "2026-03-25T12:00:00.000Z",
    },
    walletContext: {
      walletAddress: "0x2222222222222222222222222222222222222222",
      chainId: 84532,
      kernelVersion: "3.1",
      sessionPublicKey: "0x1234",
      owner: {
        credentialId: "credential-id",
        publicKey: "0x1234",
      },
      scope: {
        chainId: 84532,
        contractPermissions: [
          {
            targetContract: "0x1111111111111111111111111111111111111111",
            allowedMethods: ["0xa9059cbb"],
          },
        ],
      },
      policyDigest: "0x12345678",
      serializedPermissionAccount: "approval_123",
    },
    createdAt: "2026-03-25T11:00:00.000Z",
    updatedAt: "2026-03-25T12:00:00.000Z",
    expiresAt: "2026-03-26T10:00:00.000Z",
    ...overrides,
  };
}

describe("frontend app", () => {
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
          serializedPermissionAccount: string;
        }>
      >()
      .mockResolvedValue({
        owner: {
          credentialId: "credential-id",
          publicKey: "0x1234",
        },
        counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
        serializedPermissionAccount: "approval_123",
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

    expect(await screen.findByText(/provision this wallet/i)).toBeInTheDocument();
    expect(loadProvisioningRequest).toHaveBeenCalledWith({
      walletId: "wal_test",
      token: "token_123",
      backendUrl: "http://127.0.0.1:3000",
    });

    fireEvent.click(screen.getByRole("button", { name: /create a passkey/i }));

    await waitFor(() => {
      expect(createProvisioningArtifacts).toHaveBeenCalledWith({
        displayName: "Agent Wallet",
        scope: {
          chainId: 84532,
          contractPermissions: [
            {
              targetContract: "0x1111111111111111111111111111111111111111",
              allowedMethods: ["0xa9059cbb"],
            },
          ],
        },
        sessionPublicKey: "0x1234",
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
      serializedPermissionAccount: "approval_123",
    });

    expect(await screen.findByText(/wallet ready/i)).toBeInTheDocument();
    expect(screen.getByText(/0x2222/i)).toBeInTheDocument();
  });

  it("shows a clear error when the provisioning link is incomplete", () => {
    render(<App search="?walletId=wal_test" />);

    expect(screen.getByText(/invalid provisioning link/i)).toBeInTheDocument();
    expect(
      screen.getByText(/open the full link from the cli output/i),
    ).toBeInTheDocument();
  });

  it("polls funding after owner binding until the wallet is ready", async () => {
    let intervalCallback: (() => void) | undefined;
    const setIntervalSpy = vi
      .spyOn(window, "setInterval")
      .mockImplementation(((callback: TimerHandler) => {
        intervalCallback = callback as () => void;
        return 1;
      }) as typeof window.setInterval);
    const clearIntervalSpy = vi
      .spyOn(window, "clearInterval")
      .mockImplementation(() => {});

    const loadProvisioningRequest = vi
      .fn<() => Promise<ResolveProvisioningResponse>>()
      .mockResolvedValueOnce(buildProvisioningResponse())
      .mockResolvedValueOnce(
        buildProvisioningResponse({
          status: "ready",
          ownerPublicArtifacts: {
            credentialId: "credential-id",
            publicKey: "0x1234",
          },
          counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
          funding: {
            status: "verified",
            minimumRequiredWei: "500000000000000",
            balanceWei: "600000000000000",
            checkedAt: "2026-03-25T12:00:00.000Z",
          },
        }),
      );
    const createProvisioningArtifacts = vi
      .fn<
        () => Promise<{
          owner: { credentialId: string; publicKey: string };
          counterfactualWalletAddress: string;
          serializedPermissionAccount: string;
        }>
      >()
      .mockResolvedValue({
        owner: {
          credentialId: "credential-id",
          publicKey: "0x1234",
        },
        counterfactualWalletAddress: "0x2222222222222222222222222222222222222222",
        serializedPermissionAccount: "approval_123",
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
            checkedAt: "2026-03-25T11:59:00.000Z",
          },
          walletContext: {
            walletAddress: "0x2222222222222222222222222222222222222222",
            chainId: 84532,
            kernelVersion: "3.1",
            sessionPublicKey: "0x1234",
            owner: {
              credentialId: "credential-id",
              publicKey: "0x1234",
            },
            scope: {
              chainId: 84532,
              contractPermissions: [
                {
                  targetContract: "0x1111111111111111111111111111111111111111",
                  allowedMethods: ["0xa9059cbb"],
                },
              ],
            },
            policyDigest: "0x12345678",
            serializedPermissionAccount: "approval_123",
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

    fireEvent.click(await screen.findByRole("button", { name: /create a passkey/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/fund this wallet to continue activation/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/checking funding status automatically/i),
    ).toBeInTheDocument();

    expect(intervalCallback).toBeTypeOf("function");

    await act(async () => {
      intervalCallback?.();
    });

    await waitFor(() => {
      expect(refreshFunding).toHaveBeenCalledWith({
        walletId: "wal_test",
        backendUrl: "http://127.0.0.1:3000",
      });
    });

    expect(await screen.findByText(/wallet ready/i)).toBeInTheDocument();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});
