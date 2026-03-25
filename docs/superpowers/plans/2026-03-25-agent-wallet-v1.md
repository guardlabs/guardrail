# Agent Wallet V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working `agent-wallet` slice: a CLI can create a wallet request for a scoped Web3 task, a browser frontend can bind a passkey owner and guide funding, an orchestrator backend can bridge the two with minimal persisted state, and the agent can later use its locally generated session key.

**Architecture:** Use a TypeScript monorepo with four units: a thin agent CLI, a Fastify orchestration backend backed by PostgreSQL, a React/Vite browser frontend for the human flow, and shared schema/client packages. Secrets stay outside the backend boundary: the CLI owns the session private key, the browser owns the passkey flow, and the backend stores only public request state and public artifacts.

**Tech Stack:** TypeScript, pnpm workspaces, Node.js, Fastify, PostgreSQL, Drizzle ORM, React, Vite, Vitest, Playwright, ZeroDev SDK / Kernel

---

## Planned File Structure

### Workspace and Tooling

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.editorconfig`
- Create: `.env.example`

### Shared Packages

- Create: `packages/shared/src/wallet-request.ts`
- Create: `packages/shared/src/status.ts`
- Create: `packages/shared/src/env.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/test/wallet-request.test.ts`
- Create: `packages/orchestrator-client/src/http.ts`
- Create: `packages/orchestrator-client/src/index.ts`
- Create: `packages/orchestrator-client/package.json`
- Create: `packages/orchestrator-client/test/http.test.ts`
- Create: `packages/wallet-core/src/session-key.ts`
- Create: `packages/wallet-core/src/funding.ts`
- Create: `packages/wallet-core/src/zerodev.ts`
- Create: `packages/wallet-core/src/index.ts`
- Create: `packages/wallet-core/package.json`
- Create: `packages/wallet-core/test/session-key.test.ts`

### Backend

- Create: `apps/orchestrator/package.json`
- Create: `apps/orchestrator/tsconfig.json`
- Create: `apps/orchestrator/src/app.ts`
- Create: `apps/orchestrator/src/server.ts`
- Create: `apps/orchestrator/src/routes/health.ts`
- Create: `apps/orchestrator/src/routes/wallet-requests.ts`
- Create: `apps/orchestrator/src/routes/provisioning.ts`
- Create: `apps/orchestrator/src/services/wallet-request-service.ts`
- Create: `apps/orchestrator/src/services/funding-service.ts`
- Create: `apps/orchestrator/src/db/schema.ts`
- Create: `apps/orchestrator/src/db/client.ts`
- Create: `apps/orchestrator/src/db/migrations/0001_init.sql`
- Create: `apps/orchestrator/test/wallet-requests.test.ts`
- Create: `apps/orchestrator/test/provisioning.test.ts`

### Frontend

- Create: `apps/frontend/package.json`
- Create: `apps/frontend/tsconfig.json`
- Create: `apps/frontend/vite.config.ts`
- Create: `apps/frontend/index.html`
- Create: `apps/frontend/src/main.tsx`
- Create: `apps/frontend/src/App.tsx`
- Create: `apps/frontend/src/lib/api.ts`
- Create: `apps/frontend/src/lib/passkey.ts`
- Create: `apps/frontend/src/routes/request-page.tsx`
- Create: `apps/frontend/src/routes/complete-page.tsx`
- Create: `apps/frontend/src/components/funding-card.tsx`
- Create: `apps/frontend/src/components/status-panel.tsx`
- Create: `apps/frontend/src/test/request-page.test.tsx`
- Create: `apps/frontend/e2e/provisioning.spec.ts`

### CLI

- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/src/index.ts`
- Create: `apps/cli/src/commands/create-wallet.ts`
- Create: `apps/cli/src/commands/poll-wallet.ts`
- Create: `apps/cli/src/commands/show-session.ts`
- Create: `apps/cli/src/lib/config.ts`
- Create: `apps/cli/src/lib/local-store.ts`
- Create: `apps/cli/src/lib/output.ts`
- Create: `apps/cli/test/create-wallet.test.ts`
- Create: `apps/cli/test/poll-wallet.test.ts`

## Assumptions To Keep Fixed During Implementation

- Use one monorepo rather than separate repositories.
- Store only public request state in PostgreSQL.
- Default orchestrator is configurable through environment variables.
- The CLI local store may use a simple JSON file in V1.
- The frontend human flow is request-id driven: URL contains backend base URL plus request id.
- Exact ZeroDev activation calls may be stubbed behind `packages/wallet-core` until the first working integration test is wired.

## Task 1: Scaffold the Monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.editorconfig`
- Create: `.env.example`

- [ ] **Step 1: Write the failing workspace smoke test**

```ts
import { describe, expect, it } from "vitest";

describe("workspace", () => {
  it("loads the root package metadata", async () => {
    const pkg = await import("../package.json");
    expect(pkg.name).toBe("agent-wallet");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run workspace.test.ts`
Expected: FAIL because workspace tooling and the test file do not exist yet.

- [ ] **Step 3: Add the minimal workspace files**

```json
{
  "name": "agent-wallet",
  "private": true,
  "packageManager": "pnpm@10",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  }
}
```

- [ ] **Step 4: Run the smoke test and install commands**

Run: `pnpm install && pnpm test`
Expected: PASS for the workspace smoke test and no unresolved workspace errors.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .editorconfig .env.example
git commit -m "chore: scaffold agent-wallet workspace"
```

## Task 2: Define Shared Domain Types and Validation

**Files:**
- Create: `packages/shared/src/status.ts`
- Create: `packages/shared/src/wallet-request.ts`
- Create: `packages/shared/src/env.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Test: `packages/shared/test/wallet-request.test.ts`

- [ ] **Step 1: Write the failing domain validation tests**

```ts
import { describe, expect, it } from "vitest";
import { createWalletRequestInputSchema } from "../src/wallet-request";

describe("createWalletRequestInputSchema", () => {
  it("accepts chain, contract, allowed methods, and session public key", () => {
    const result = createWalletRequestInputSchema.safeParse({
      chain: "base",
      targetContract: "0x1234567890123456789012345678901234567890",
      allowedMethods: ["transfer(address,uint256)"],
      sessionPublicKey: "0x04abcd"
    });

    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @agent-wallet/shared test`
Expected: FAIL because the shared package and schemas do not exist.

- [ ] **Step 3: Implement the schema and types**

```ts
import { z } from "zod";

export const walletRequestStatusSchema = z.enum([
  "created",
  "link_opened",
  "owner_bound",
  "funded",
  "ready",
  "activated",
  "failed"
]);

export const createWalletRequestInputSchema = z.object({
  chain: z.string().min(1),
  targetContract: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  allowedMethods: z.array(z.string().min(1)).min(1),
  sessionPublicKey: z.string().min(1)
});
```

- [ ] **Step 4: Run package tests**

Run: `pnpm --filter @agent-wallet/shared test`
Expected: PASS with schema validation covering success and failure cases.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat: add shared wallet request schemas"
```

## Task 3: Build Wallet-Core Helpers for Local Secrets and Chain Reads

**Files:**
- Create: `packages/wallet-core/src/session-key.ts`
- Create: `packages/wallet-core/src/funding.ts`
- Create: `packages/wallet-core/src/zerodev.ts`
- Create: `packages/wallet-core/src/index.ts`
- Create: `packages/wallet-core/package.json`
- Test: `packages/wallet-core/test/session-key.test.ts`

- [ ] **Step 1: Write the failing crypto and funding tests**

```ts
import { describe, expect, it } from "vitest";
import { generateSessionKeypair } from "../src/session-key";

describe("generateSessionKeypair", () => {
  it("returns a public key and a private key", async () => {
    const pair = await generateSessionKeypair();
    expect(pair.publicKey).toMatch(/^0x/);
    expect(pair.privateKey).toMatch(/^0x/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @agent-wallet/wallet-core test`
Expected: FAIL because wallet-core helpers do not exist yet.

- [ ] **Step 3: Implement minimal helpers**

```ts
export async function generateSessionKeypair() {
  const account = generatePrivateKey();
  return {
    privateKey: account,
    publicKey: privateKeyToAccount(account).publicKey
  };
}
```

- [ ] **Step 4: Add a funding check helper and rerun tests**

Run: `pnpm --filter @agent-wallet/wallet-core test`
Expected: PASS for session-key generation and a stubbed funding-read test.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-core
git commit -m "feat: add wallet core helpers"
```

## Task 4: Implement the Orchestrator Backend Request API

**Files:**
- Create: `apps/orchestrator/src/app.ts`
- Create: `apps/orchestrator/src/server.ts`
- Create: `apps/orchestrator/src/routes/health.ts`
- Create: `apps/orchestrator/src/routes/wallet-requests.ts`
- Create: `apps/orchestrator/src/services/wallet-request-service.ts`
- Create: `apps/orchestrator/src/db/schema.ts`
- Create: `apps/orchestrator/src/db/client.ts`
- Create: `apps/orchestrator/src/db/migrations/0001_init.sql`
- Test: `apps/orchestrator/test/wallet-requests.test.ts`

- [ ] **Step 1: Write the failing request-creation API test**

```ts
import { describe, expect, it } from "vitest";

describe("POST /wallet-requests", () => {
  it("creates a wallet request and returns a request id plus frontend URL", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/wallet-requests",
      payload: {
        chain: "base",
        targetContract: "0x1234567890123456789012345678901234567890",
        allowedMethods: ["transfer(address,uint256)"],
        sessionPublicKey: "0x04abcd"
      }
    });

    expect(response.statusCode).toBe(201);
  });
});
```

- [ ] **Step 2: Run the backend test to verify it fails**

Run: `pnpm --filter @agent-wallet/orchestrator test`
Expected: FAIL because the backend app and route do not exist.

- [ ] **Step 3: Implement the schema, migration, and create route**

```ts
app.post("/wallet-requests", async (request, reply) => {
  const input = createWalletRequestInputSchema.parse(request.body);
  const created = await walletRequestService.create(input);

  return reply.code(201).send({
    requestId: created.id,
    frontendUrl: `${env.FRONTEND_BASE_URL}/request/${created.id}?backend=${encodeURIComponent(env.PUBLIC_API_BASE_URL)}`
  });
});
```

- [ ] **Step 4: Run the backend tests and migration**

Run: `pnpm --filter @agent-wallet/orchestrator test`
Expected: PASS for create and fetch endpoints with a local test database.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator packages/shared
git commit -m "feat: add wallet request orchestration api"
```

## Task 5: Implement the Browser Provisioning Flow

**Files:**
- Create: `apps/frontend/src/main.tsx`
- Create: `apps/frontend/src/App.tsx`
- Create: `apps/frontend/src/lib/api.ts`
- Create: `apps/frontend/src/lib/passkey.ts`
- Create: `apps/frontend/src/routes/request-page.tsx`
- Create: `apps/frontend/src/routes/complete-page.tsx`
- Create: `apps/frontend/src/components/funding-card.tsx`
- Create: `apps/frontend/src/components/status-panel.tsx`
- Test: `apps/frontend/src/test/request-page.test.tsx`
- Test: `apps/frontend/e2e/provisioning.spec.ts`

- [ ] **Step 1: Write the failing browser flow tests**

```tsx
import { render, screen } from "@testing-library/react";
import { RequestPage } from "../routes/request-page";

it("renders the request scope and funding instructions", async () => {
  render(<RequestPage />);
  expect(await screen.findByText(/fund this wallet/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the frontend tests to verify they fail**

Run: `pnpm --filter @agent-wallet/frontend test`
Expected: FAIL because the route and app shell do not exist.

- [ ] **Step 3: Implement the request page and completion submit**

```tsx
export function RequestPage() {
  const request = useWalletRequest();

  return (
    <>
      <StatusPanel status={request.status} />
      <FundingCard address={request.counterfactualWalletAddress} chain={request.chain} />
      <button onClick={bindPasskeyOwner}>Create passkey</button>
    </>
  );
}
```

- [ ] **Step 4: Run unit and browser tests**

Run: `pnpm --filter @agent-wallet/frontend test && pnpm --filter @agent-wallet/frontend e2e`
Expected: PASS for rendering, API integration mocks, and the happy-path browser flow.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend packages/orchestrator-client packages/shared
git commit -m "feat: add provisioning frontend"
```

## Task 6: Implement CLI Create and Poll Commands

**Files:**
- Create: `apps/cli/src/index.ts`
- Create: `apps/cli/src/commands/create-wallet.ts`
- Create: `apps/cli/src/commands/poll-wallet.ts`
- Create: `apps/cli/src/lib/config.ts`
- Create: `apps/cli/src/lib/local-store.ts`
- Create: `apps/cli/src/lib/output.ts`
- Test: `apps/cli/test/create-wallet.test.ts`
- Test: `apps/cli/test/poll-wallet.test.ts`

- [ ] **Step 1: Write the failing CLI tests**

```ts
import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/run-cli";

describe("create-wallet", () => {
  it("prints a request id and frontend url while storing the session secret locally", async () => {
    const result = await runCli([
      "create-wallet",
      "--chain", "base",
      "--contract", "0x1234567890123456789012345678901234567890",
      "--method", "transfer(address,uint256)"
    ]);

    expect(result.stdout).toContain("request_id");
    expect(result.stdout).toContain("frontend_url");
  });
});
```

- [ ] **Step 2: Run the CLI tests to verify they fail**

Run: `pnpm --filter @agent-wallet/cli test`
Expected: FAIL because the CLI entrypoint and local secret store do not exist.

- [ ] **Step 3: Implement the commands**

```ts
program
  .command("create-wallet")
  .requiredOption("--chain <chain>")
  .requiredOption("--contract <address>")
  .requiredOption("--method <signature...>")
  .action(createWalletCommand);
```

- [ ] **Step 4: Run the CLI tests and verify the local secret store**

Run: `pnpm --filter @agent-wallet/cli test`
Expected: PASS for request creation, persisted local secret material, and polling output transitions.

- [ ] **Step 5: Commit**

```bash
git add apps/cli packages/orchestrator-client packages/wallet-core
git commit -m "feat: add agent wallet cli"
```

## Task 7: Finalize Provisioning and Activation Hooks

**Files:**
- Modify: `apps/orchestrator/src/routes/provisioning.ts`
- Modify: `apps/orchestrator/src/services/wallet-request-service.ts`
- Modify: `packages/wallet-core/src/zerodev.ts`
- Modify: `apps/frontend/src/lib/passkey.ts`
- Test: `apps/orchestrator/test/provisioning.test.ts`
- Test: `packages/wallet-core/test/session-key.test.ts`

- [ ] **Step 1: Write the failing provisioning-finalization tests**

```ts
it("marks a request ready once owner artifacts exist and funding is sufficient", async () => {
  const result = await walletRequestService.finalizeReadyState(requestId);
  expect(result.status).toBe("ready");
});
```

- [ ] **Step 2: Run the affected tests to verify they fail**

Run: `pnpm --filter @agent-wallet/orchestrator test provisioning`
Expected: FAIL because ready-state finalization and funding revalidation are not implemented.

- [ ] **Step 3: Implement ready-state transition and ZeroDev adapter seam**

```ts
export async function finalizeReadyState(id: string) {
  const request = await repository.getById(id);
  assertOwnerArtifactsPresent(request);
  await assertFundingSufficient(request.chain, request.counterfactualWalletAddress);
  return repository.markReady(id);
}
```

- [ ] **Step 4: Run backend and wallet-core tests**

Run: `pnpm --filter @agent-wallet/orchestrator test && pnpm --filter @agent-wallet/wallet-core test`
Expected: PASS with deterministic stubs around the exact ZeroDev activation call shape.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator packages/wallet-core apps/frontend
git commit -m "feat: finalize wallet provisioning readiness"
```

## Task 8: Prove Portability and Management Independence

**Files:**
- Create: `docs/compatibility/orchestrator-api.md`
- Create: `apps/frontend/src/routes/manage-page.tsx`
- Create: `apps/frontend/src/test/manage-page.test.tsx`
- Modify: `apps/frontend/src/App.tsx`
- Test: `apps/frontend/e2e/provisioning.spec.ts`

- [ ] **Step 1: Write the failing management-view test**

```tsx
it("renders wallet management instructions without depending on the provisioning backend", async () => {
  render(<ManagePage />);
  expect(await screen.findByText(/manage your wallet/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the management tests to verify they fail**

Run: `pnpm --filter @agent-wallet/frontend test manage-page`
Expected: FAIL because the management route and compatibility doc do not exist.

- [ ] **Step 3: Implement the management page and compatibility contract doc**

```tsx
export function ManagePage() {
  return (
    <main>
      <h1>Manage your wallet</h1>
      <p>Reconnect with your passkey and a compatible provider.</p>
    </main>
  );
}
```

- [ ] **Step 4: Run frontend tests and review the compatibility doc**

Run: `pnpm --filter @agent-wallet/frontend test && pnpm --filter @agent-wallet/frontend e2e`
Expected: PASS, with documentation describing the minimum backend API contract for third-party hosts.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend docs/compatibility/orchestrator-api.md
git commit -m "feat: document portability and add management entrypoint"
```

## Task 9: End-to-End Verification and Developer Docs

**Files:**
- Create: `README.md`
- Modify: `.env.example`
- Modify: `apps/orchestrator/test/provisioning.test.ts`
- Modify: `apps/cli/test/poll-wallet.test.ts`
- Modify: `apps/frontend/e2e/provisioning.spec.ts`

- [ ] **Step 1: Write the failing end-to-end happy-path checklist**

```md
- create wallet request from CLI
- open provisioning page in browser
- submit public owner artifacts
- poll until ready
- assert local session secret still exists only in CLI storage
```

- [ ] **Step 2: Run the full test suite to capture current failures**

Run: `pnpm test`
Expected: FAIL or partial PASS until the full happy path is wired together.

- [ ] **Step 3: Fill the remaining gaps and write setup docs**

```md
pnpm install
pnpm db:migrate
pnpm dev
```

- [ ] **Step 4: Run the full verification suite**

Run: `pnpm test && pnpm build`
Expected: PASS across shared, CLI, backend, frontend, and end-to-end happy-path coverage.

- [ ] **Step 5: Commit**

```bash
git add README.md .env.example apps packages docs
git commit -m "chore: verify agent wallet v1 end to end"
```
