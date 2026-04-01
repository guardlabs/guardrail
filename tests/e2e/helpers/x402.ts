import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  getSupportedChainById,
  x402PaymentPayloadSchema,
  x402PaymentRequiredSchema,
  x402SettlementResponseSchema,
} from "@conduit/shared";
import {
  createPublicClient,
  createWalletClient,
  http,
  maxUint256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";

const usdcAbi = [
  {
    type: "function",
    stateMutability: "view",
    name: "masterMinter",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "configureMinter",
    inputs: [
      { name: "minter", type: "address" },
      { name: "minterAllowedAmount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "mint",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "transferWithAuthorization",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "transferWithAuthorization",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

function encodeBase64Json(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

async function callAnvilRpc(rpcUrl: string, method: string, params: unknown[]) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC ${method} failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as {
    result?: unknown;
    error?: { message?: string };
  };

  if (payload.error) {
    throw new Error(
      `RPC ${method} failed: ${payload.error.message ?? "unknown error"}.`,
    );
  }

  return payload.result;
}

export function decodePaymentRequiredHeader(raw: string) {
  return x402PaymentRequiredSchema.parse(
    JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8")),
  );
}

export function decodePaymentSignatureHeader(raw: string) {
  return x402PaymentPayloadSchema.parse(
    JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8")),
  );
}

export function decodePaymentResponseHeader(raw: string) {
  return x402SettlementResponseSchema.parse(
    JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8")),
  );
}

async function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
  headers: Record<string, string>,
) {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

export async function mintOfficialUsdcOnAnvil(input: {
  rpcUrl: string;
  recipient: Address;
  amount: bigint;
  facilitatorPrivateKey: Hex;
}) {
  const supportedChain = getSupportedChainById(84532);

  if (!supportedChain) {
    throw new Error("Base Sepolia must be configured for x402 e2e minting.");
  }

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(input.rpcUrl),
  });
  const facilitatorAccount = privateKeyToAccount(input.facilitatorPrivateKey);
  const facilitatorClient = createWalletClient({
    chain: baseSepolia,
    account: facilitatorAccount,
    transport: http(input.rpcUrl),
  });
  const masterMinter = await publicClient.readContract({
    address: supportedChain.officialUsdcAddress as Address,
    abi: usdcAbi,
    functionName: "masterMinter",
  });

  await callAnvilRpc(input.rpcUrl, "anvil_setBalance", [
    masterMinter,
    "0x56BC75E2D63100000",
  ]);
  await callAnvilRpc(input.rpcUrl, "anvil_impersonateAccount", [masterMinter]);

  try {
    const masterMinterClient = createWalletClient({
      chain: baseSepolia,
      account: masterMinter,
      transport: http(input.rpcUrl),
    });
    const configureHash = await masterMinterClient.writeContract({
      address: supportedChain.officialUsdcAddress as Address,
      abi: usdcAbi,
      functionName: "configureMinter",
      args: [facilitatorAccount.address, maxUint256],
    });

    await publicClient.waitForTransactionReceipt({
      hash: configureHash,
    });
  } finally {
    await callAnvilRpc(input.rpcUrl, "anvil_stopImpersonatingAccount", [
      masterMinter,
    ]);
  }

  const mintHash = await facilitatorClient.writeContract({
    address: supportedChain.officialUsdcAddress as Address,
    abi: usdcAbi,
    functionName: "mint",
    args: [input.recipient, input.amount],
  });

  await publicClient.waitForTransactionReceipt({
    hash: mintHash,
  });

  return {
    asset: supportedChain.officialUsdcAddress as Address,
    transactionHash: mintHash,
  };
}

export async function getOfficialUsdcBalance(input: {
  rpcUrl: string;
  address: Address;
}) {
  const supportedChain = getSupportedChainById(84532);

  if (!supportedChain) {
    throw new Error(
      "Base Sepolia must be configured for x402 e2e balance checks.",
    );
  }

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(input.rpcUrl),
  });

  return publicClient.readContract({
    address: supportedChain.officialUsdcAddress as Address,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [input.address],
  });
}

async function settleTransferWithAuthorization(input: {
  publicClient: ReturnType<typeof createPublicClient>;
  merchantClient: ReturnType<typeof createWalletClient>;
  merchantAddress: Address;
  asset: Address;
  authorization: ReturnType<
    typeof x402PaymentPayloadSchema.parse
  >["payload"]["authorization"];
  signature: Hex;
}) {
  if (input.signature.length === 132) {
    throw new Error("eoa_signature_not_supported");
  }

  const baseArgs = [
    input.authorization.from as Address,
    input.authorization.to as Address,
    BigInt(input.authorization.value),
    BigInt(input.authorization.validAfter),
    BigInt(input.authorization.validBefore),
    input.authorization.nonce as Hex,
  ] as const;

  const bytesSimulation = await input.publicClient.simulateContract({
    account: input.merchantAddress,
    address: input.asset,
    abi: usdcAbi,
    functionName: "transferWithAuthorization",
    args: [...baseArgs, input.signature],
  });
  const transactionHash = await input.merchantClient.writeContract(
    bytesSimulation.request,
  );

  await input.publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });

  return transactionHash;
}

export async function startX402ExactEip3009Server(input: {
  port: number;
  rpcUrl: string;
  merchantPrivateKey: Hex;
  amount: bigint;
  expectedPayer?: Address;
}) {
  const supportedChain = getSupportedChainById(84532);

  if (!supportedChain) {
    throw new Error("Base Sepolia must be configured for x402 e2e server.");
  }

  const merchantAccount = privateKeyToAccount(input.merchantPrivateKey);
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(input.rpcUrl),
  });
  const merchantClient = createWalletClient({
    chain: baseSepolia,
    account: merchantAccount,
    transport: http(input.rpcUrl),
  });
  const protectedPath = "/x402/premium-data";
  const baseUrl = `http://127.0.0.1:${input.port}`;
  const resource = {
    url: `${baseUrl}${protectedPath}`,
    description: "Premium x402 E2E payload",
    mimeType: "application/json",
  };
  const accepted = {
    scheme: "exact" as const,
    network: "eip155:84532",
    amount: input.amount.toString(),
    asset: supportedChain.officialUsdcAddress,
    payTo: merchantAccount.address,
    maxTimeoutSeconds: 60,
    extra: {
      assetTransferMethod: "eip3009" as const,
      name: "USDC",
      version: "2",
    },
  };
  const paymentRequired = {
    x402Version: 2 as const,
    error: "PAYMENT-SIGNATURE header is required",
    resource,
    accepts: [accepted],
  };
  const settlementLog: Array<{
    payer: Address;
    transactionHash: Hex;
    amount: bigint;
  }> = [];

  async function respondPaymentRequired(response: ServerResponse) {
    await sendJson(
      response,
      402,
      {
        error: paymentRequired.error,
      },
      {
        [PAYMENT_REQUIRED_HEADER]: encodeBase64Json(paymentRequired),
      },
    );
  }

  async function respondPaymentFailure(
    response: ServerResponse,
    payer: Address | undefined,
    reason: string,
  ) {
    await sendJson(
      response,
      402,
      {
        error: reason,
      },
      {
        [PAYMENT_REQUIRED_HEADER]: encodeBase64Json(paymentRequired),
        [PAYMENT_RESPONSE_HEADER]: encodeBase64Json({
          success: false,
          errorReason: reason,
          payer,
          transaction: "0x",
          network: accepted.network,
        }),
      },
    );
  }

  async function handleProtectedRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    if (request.method !== "GET" || request.url !== protectedPath) {
      await sendJson(response, 404, { error: "Not found" }, {});
      return;
    }

    const paymentHeader = request.headers["payment-signature"];

    if (!paymentHeader || Array.isArray(paymentHeader)) {
      await respondPaymentRequired(response);
      return;
    }

    let payer: Address | undefined;

    try {
      const paymentPayload = decodePaymentSignatureHeader(paymentHeader);
      const authorization = paymentPayload.payload.authorization;
      payer = authorization.from as Address;

      if (paymentPayload.x402Version !== 2) {
        throw new Error("unsupported_x402_version");
      }

      if (
        JSON.stringify(paymentPayload.accepted) !== JSON.stringify(accepted)
      ) {
        throw new Error("payment_requirement_mismatch");
      }

      if (paymentPayload.resource?.url !== resource.url) {
        throw new Error("resource_mismatch");
      }

      if (input.expectedPayer && authorization.from !== input.expectedPayer) {
        throw new Error("unexpected_payer");
      }

      if (authorization.to !== accepted.payTo) {
        throw new Error("pay_to_mismatch");
      }

      if (authorization.value !== accepted.amount) {
        throw new Error("amount_mismatch");
      }

      const nowSeconds = Math.floor(Date.now() / 1000);

      if (BigInt(authorization.validAfter) > BigInt(nowSeconds)) {
        throw new Error("authorization_not_active");
      }

      if (BigInt(authorization.validBefore) < BigInt(nowSeconds)) {
        throw new Error("authorization_expired");
      }

      const balance = await publicClient.readContract({
        address: accepted.asset as Address,
        abi: usdcAbi,
        functionName: "balanceOf",
        args: [authorization.from as Address],
      });

      if (balance < BigInt(accepted.amount)) {
        throw new Error("insufficient_funds");
      }

      const settlementHash = await settleTransferWithAuthorization({
        publicClient,
        merchantClient,
        merchantAddress: merchantAccount.address,
        asset: accepted.asset as Address,
        authorization,
        signature: paymentPayload.payload.signature as Hex,
      });
      settlementLog.push({
        payer: authorization.from as Address,
        transactionHash: settlementHash,
        amount: BigInt(authorization.value),
      });

      await sendJson(
        response,
        200,
        {
          ok: true,
          resource: "premium-data",
        },
        {
          [PAYMENT_RESPONSE_HEADER]: encodeBase64Json({
            success: true,
            payer: authorization.from,
            transaction: settlementHash,
            network: accepted.network,
            amount: authorization.value,
          }),
        },
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "payment_failed";
      await respondPaymentFailure(response, payer, reason);
    }
  }

  const server = createServer((request, response) => {
    void handleProtectedRequest(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    merchantAddress: merchantAccount.address,
    paymentAmount: input.amount,
    paymentRequired,
    protectedUrl: resource.url,
    settlements: settlementLog,
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}
