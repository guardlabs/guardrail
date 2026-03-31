# Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a reusable light-mode frontend system for Conduit Wallet and ship the redesigned provisioning page as the reference implementation.

**Architecture:** Keep the current Vite/React app and provisioning flow logic intact, but split presentation into focused content helpers and UI components. Introduce a shared visual token layer in the global stylesheet, translate technical wallet state into plain-language summaries, and refactor `App.tsx` into a structured-product screen with secondary technical disclosures.

**Tech Stack:** React 19, Vite 6, TypeScript 5, plain CSS, Vitest, Testing Library

---

## File Structure

### Existing files to modify

- `apps/frontend/src/App.tsx`
  Responsibility: keep orchestration for query parsing, loading, passkey submission, and funding refresh while delegating rendering to extracted helpers/components.
- `apps/frontend/src/App.test.tsx`
  Responsibility: verify the new information hierarchy and provisioning states at the screen level.
- `apps/frontend/src/styles.css`
  Responsibility: define the redesigned visual tokens, layout primitives, and component styles for the new shared shell.

### New files to create

- `apps/frontend/src/content/provisioningContent.ts`
  Responsibility: translate provisioning status, funding state, and wallet policy into plain-language UI copy.
- `apps/frontend/src/content/provisioningContent.test.ts`
  Responsibility: lock down copy translation rules and plain-language summaries.
- `apps/frontend/src/components/ProvisioningLayout.tsx`
  Responsibility: render the high-level two-zone layout used by the redesigned provisioning screen.
- `apps/frontend/src/components/ProvisioningStatusBanner.tsx`
  Responsibility: render the primary state banner with one dominant message and next-step framing.
- `apps/frontend/src/components/PermissionSummary.tsx`
  Responsibility: render the operator-facing “what this wallet can do” section.
- `apps/frontend/src/components/TechnicalDetailsDisclosure.tsx`
  Responsibility: render advanced details in a collapsed-by-default disclosure block.

The plan intentionally does not add routing or implement the homepage, wallets hub, or wallet admin pages yet. Those surfaces inherit this system later.

## Task 1: Lock Down Plain-Language Content Rules

**Files:**
- Create: `apps/frontend/src/content/provisioningContent.ts`
- Create: `apps/frontend/src/content/provisioningContent.test.ts`
- Modify: `apps/frontend/src/App.tsx`

- [ ] **Step 1: Write the failing content tests**

Add focused tests for the future helper API:

```ts
import { describe, expect, it } from "vitest";
import { getProvisioningContentModel } from "./provisioningContent.js";

describe("getProvisioningContentModel", () => {
  it("translates policy and status into non-technical copy", () => {
    const model = getProvisioningContentModel({
      status: "created",
      fundingStatus: "unverified",
      policy: {
        contractAllowlist: [
          { contractAddress: "0x4444444444444444444444444444444444444444", allowedSelectors: ["0xa9059cbb"] },
        ],
        usdcPolicy: {
          period: "daily",
          maxAmountMinor: "1500000",
          allowedOperations: ["transfer", "permit"],
        },
      },
    });

    expect(model.statusTitle).toBe("Secure this wallet");
    expect(model.permissionItems).toContain("This wallet can use USDC within a set limit.");
    expect(model.permissionItems).toContain("Anything outside these rules stays blocked.");
  });
});
```

Run: `pnpm --filter @conduit/frontend test -- provisioningContent.test.ts`
Expected: FAIL with module not found or missing export.

- [ ] **Step 2: Implement the content model helper**

Create a small pure helper API that returns one object for the screen:

```ts
export function getProvisioningContentModel(input: {
  status: "created" | "owner_bound" | "ready";
  fundingStatus: "unverified" | "insufficient" | "verified";
  policy: WalletPolicy;
}) {
  return {
    statusTitle: "Secure this wallet",
    statusBody: "Create a passkey on this device to keep admin control of this wallet.",
    permissionItems: [
      "This wallet can use USDC within a set limit.",
      "Anything outside these rules stays blocked.",
      "Your passkey remains the admin control.",
    ],
  };
}
```

Keep formatting helpers here too, including the current funding-label logic if it is only presentation copy.

- [ ] **Step 3: Switch `App.tsx` to use the helper for user-facing text**

Replace inline display strings that are derived from status and policy with calls to the new content model:

```ts
const contentModel = request
  ? getProvisioningContentModel({
      status,
      fundingStatus: funding?.status ?? "unverified",
      policy: request.policy,
    })
  : null;
```

Keep request orchestration where it is. Do not redesign layout yet in this task.

- [ ] **Step 4: Run the targeted tests**

Run: `pnpm --filter @conduit/frontend test -- provisioningContent.test.ts App.test.tsx`
Expected: PASS for the new content helper tests, with existing screen tests updated only as needed for changed copy.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/content/provisioningContent.ts \
  apps/frontend/src/content/provisioningContent.test.ts \
  apps/frontend/src/App.tsx \
  apps/frontend/src/App.test.tsx
git commit -m "feat: add plain-language provisioning content model"
```

## Task 2: Introduce Shared Visual Tokens And Screen Shell

**Files:**
- Create: `apps/frontend/src/components/ProvisioningLayout.tsx`
- Modify: `apps/frontend/src/styles.css`
- Modify: `apps/frontend/src/App.tsx`
- Test: `apps/frontend/src/App.test.tsx`

- [ ] **Step 1: Write the failing layout assertions**

Extend the screen test to assert the new structural landmarks and disclosure defaults:

```ts
it("renders the redesigned provisioning hierarchy", async () => {
  render(<App search="?walletId=wal_test&token=token_123&backendUrl=http://127.0.0.1:3000" api={...} passkeyClient={...} />);

  expect(await screen.findByRole("heading", { name: /secure this wallet/i })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: /wallet permissions/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /technical details/i })).toHaveAttribute("aria-expanded", "false");
});
```

Run: `pnpm --filter @conduit/frontend test -- App.test.tsx`
Expected: FAIL because the new landmarks and disclosure do not exist yet.

- [ ] **Step 2: Create the layout component**

Extract the top-level provisioning layout so `App.tsx` stops owning all markup:

```tsx
type ProvisioningLayoutProps = {
  hero: React.ReactNode;
  primary: React.ReactNode;
  secondary: React.ReactNode;
};

export function ProvisioningLayout({ hero, primary, secondary }: ProvisioningLayoutProps) {
  return (
    <main className="cw-shell">
      <section className="cw-hero">{hero}</section>
      <section className="cw-workspace">
        <div className="cw-primary">{primary}</div>
        <aside className="cw-secondary">{secondary}</aside>
      </section>
    </main>
  );
}
```

Keep it presentational only.

- [ ] **Step 3: Add the shared token layer to `styles.css`**

Refactor the stylesheet around named tokens and layout primitives rather than one-off panels:

```css
:root {
  --cw-bg: oklch(97% 0.01 120);
  --cw-surface: oklch(99% 0.005 120);
  --cw-surface-muted: oklch(95% 0.01 120);
  --cw-ink: oklch(22% 0.02 145);
  --cw-accent: oklch(30% 0.05 155);
  --cw-border: oklch(86% 0.01 145);
  --cw-radius: 20px;
}

.cw-shell { ... }
.cw-hero { ... }
.cw-workspace { ... }
.cw-primary { ... }
.cw-secondary { ... }
```

Keep the product light, restrained, and mostly border/spacing-driven. Remove grid overlays and decorative effects that fight the new direction.

- [ ] **Step 4: Wire `App.tsx` into the new shell**

Replace the existing `hero-panel` and `workspace` markup with `ProvisioningLayout` and the new class names, while preserving current behavior.

Run: `pnpm --filter @conduit/frontend test -- App.test.tsx`
Expected: PASS with the new hierarchy assertions.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/ProvisioningLayout.tsx \
  apps/frontend/src/styles.css \
  apps/frontend/src/App.tsx \
  apps/frontend/src/App.test.tsx
git commit -m "feat: add shared provisioning shell and visual tokens"
```

## Task 3: Extract State Banner And Primary Action Panel

**Files:**
- Create: `apps/frontend/src/components/ProvisioningStatusBanner.tsx`
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/styles.css`
- Test: `apps/frontend/src/App.test.tsx`

- [ ] **Step 1: Write the failing state-banner tests**

Add screen-level assertions for each primary screen state:

```ts
it("shows one dominant next action when funding is required", async () => {
  render(<App ... />);

  expect(await screen.findByText(/fund this wallet to continue/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /technical details/i })).toBeInTheDocument();
});
```

Also assert that ready state copy explains the result rather than only repeating technical status names.

Run: `pnpm --filter @conduit/frontend test -- App.test.tsx`
Expected: FAIL on the new operator-facing phrasing.

- [ ] **Step 2: Implement the banner component**

Create a focused banner that accepts already-derived content:

```tsx
export function ProvisioningStatusBanner(props: {
  eyebrow: string;
  title: string;
  body: string;
  tone: "progress" | "ready" | "attention";
}) {
  return (
    <header className={`cw-status cw-status-${props.tone}`}>
      <p className="cw-kicker">{props.eyebrow}</p>
      <h1>{props.title}</h1>
      <p>{props.body}</p>
    </header>
  );
}
```

- [ ] **Step 3: Refactor the primary action area**

Restructure the main content in `App.tsx` so the order is:

1. status banner
2. one primary action
3. reassurance copy
4. wallet address if available
5. funding guidance if needed

Use the content model from Task 1 to keep copy deterministic.

- [ ] **Step 4: Run the screen tests**

Run: `pnpm --filter @conduit/frontend test -- App.test.tsx`
Expected: PASS with coverage for created, owner-bound, and ready states.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/ProvisioningStatusBanner.tsx \
  apps/frontend/src/App.tsx \
  apps/frontend/src/styles.css \
  apps/frontend/src/App.test.tsx
git commit -m "feat: redesign provisioning state banner and action flow"
```

## Task 4: Build The Permission Summary And Technical Disclosure

**Files:**
- Create: `apps/frontend/src/components/PermissionSummary.tsx`
- Create: `apps/frontend/src/components/TechnicalDetailsDisclosure.tsx`
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/styles.css`
- Test: `apps/frontend/src/App.test.tsx`

- [ ] **Step 1: Write failing tests for plain-language permissions and collapsed details**

Add explicit assertions:

```ts
it("shows wallet permissions in plain language and hides raw signer data by default", async () => {
  render(<App ... />);

  expect(await screen.findByRole("region", { name: /wallet permissions/i })).toBeInTheDocument();
  expect(screen.getByText(/your passkey remains the admin control/i)).toBeInTheDocument();
  expect(screen.queryByText(/backend signer/i)).not.toBeInTheDocument();
});
```

Then expand the disclosure and assert the advanced fields appear.

Run: `pnpm --filter @conduit/frontend test -- App.test.tsx`
Expected: FAIL because raw technical data is still visible by default.

- [ ] **Step 2: Implement the permission summary component**

Render operator-facing summary items from the content model:

```tsx
export function PermissionSummary({ items }: { items: string[] }) {
  return (
    <section aria-label="Wallet permissions" className="cw-permissions">
      <h2>What this wallet can do</h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Implement the technical disclosure component**

Move chain, threshold, signer addresses, and minimum funding into a collapsed disclosure:

```tsx
export function TechnicalDetailsDisclosure(props: {
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <details className="cw-technical">
      <summary>{props.summary}</summary>
      <div>{props.children}</div>
    </details>
  );
}
```

If native `<details>` proves awkward in tests, switch to a controlled button/disclosure pattern and assert `aria-expanded`.

- [ ] **Step 4: Run the screen tests**

Run: `pnpm --filter @conduit/frontend test -- App.test.tsx`
Expected: PASS with raw technical data hidden until disclosure interaction.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/PermissionSummary.tsx \
  apps/frontend/src/components/TechnicalDetailsDisclosure.tsx \
  apps/frontend/src/App.tsx \
  apps/frontend/src/styles.css \
  apps/frontend/src/App.test.tsx
git commit -m "feat: add permission summary and technical disclosure"
```

## Task 5: Final Verification And Cleanup

**Files:**
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/styles.css`
- Modify: `apps/frontend/src/App.test.tsx`
- Modify: `README.md` only if local frontend development or user-visible flow text changed materially during implementation

- [ ] **Step 1: Add any missing regression tests**

Cover the remaining critical states called out in the spec:

```ts
it("shows a recoverable backend error without dropping the screen structure", async () => {
  // make publishOwnerArtifacts reject and assert the error appears near the primary action
});
```

Run: `pnpm --filter @conduit/frontend test -- App.test.tsx`
Expected: FAIL until the error placement and wording are final.

- [ ] **Step 2: Tighten copy, spacing, and responsive behavior**

Use the existing CSS and extracted components to make sure:

- mobile stacks main and secondary content cleanly
- buttons and disclosures are keyboard-visible
- reduced-motion styles exist for any transitions
- no leftover legacy classes remain unused

- [ ] **Step 3: Run the full frontend verification set**

Run:

```bash
pnpm --filter @conduit/frontend test
pnpm --filter @conduit/frontend typecheck
pnpm --filter @conduit/frontend build
```

Expected:

- tests pass
- `tsc` exits 0
- Vite build exits 0

- [ ] **Step 4: Update README only if needed**

If the implementation changes local frontend usage or user-visible workflow wording enough to matter externally, update the relevant `README.md` section in the same change. Otherwise leave it unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/App.tsx \
  apps/frontend/src/styles.css \
  apps/frontend/src/App.test.tsx \
  README.md
git commit -m "feat: finalize redesigned provisioning frontend"
```

## Review Notes

Before executing this plan, sanity-check these constraints:

- keep the scope on the shared system primitives plus provisioning page
- do not add routing yet
- do not change backend/frontend API contracts
- do not surface raw chain and signer metadata in the primary information layer
- keep the page truthful about permissions, funding, and control boundaries
