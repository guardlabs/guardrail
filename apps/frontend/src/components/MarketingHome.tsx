import { ProvisioningLayout } from "./ProvisioningLayout.js";

const quickstartSteps = [
  {
    label: "Create",
    command: "npx @your-scope/conduit-wallet create --chain-id 84532",
    detail: "Creates the wallet request and returns a provisioning link for the human owner.",
  },
  {
    label: "Await",
    command: "npx @your-scope/conduit-wallet await wal_xxx",
    detail: "Waits until the wallet is fully ready for runtime use.",
  },
  {
    label: "Use",
    command:
      "npx @your-scope/conduit-wallet call wal_xxx --to 0x1111111111111111111111111111111111111111 --data 0xa9059cbb --value-wei 0",
    detail: "Runs the ready wallet from the CLI within the configured policy.",
  },
] as const;

const basics = [
  "Human stays the owner through a passkey.",
  "Agent runtime access is policy-gated.",
  "Built for task-scoped autonomous workflows.",
] as const;

export function MarketingHome() {
  const hero = (
    <div className="cw-home-hero">
      <div className="cw-brand-row">
        <p className="cw-eyebrow">Conduit Wallet</p>
        <span className="cw-hero-chip">Secure wallet rails for autonomous agents</span>
      </div>

      <div className="cw-home-hero-grid">
        <div className="cw-home-copy">
          <h1>Secure wallet rails for autonomous agents</h1>
          <p className="cw-lede">
            Conduit Wallet lets agents use onchain wallets without shipping a hot
            key, while the human remains the owner through a passkey.
          </p>

          <div className="cw-home-actions">
            <a className="cw-primary-button cw-home-button" href="#quickstart">
              Quickstart
            </a>
            <a
              className="cw-secondary-button"
              href="https://github.com/nmalzieu/conduit"
              rel="noreferrer"
              target="_blank"
            >
              GitHub
            </a>
          </div>
        </div>

        <div className="cw-home-summary">
          <p className="cw-kicker">Basics</p>
          <ul className="cw-home-bullet-list">
            {basics.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );

  const primary = (
    <section className="cw-home-single" id="quickstart">
      <div className="cw-home-single-head">
        <p className="cw-kicker">Quickstart</p>
        <h2>Install, provision, use</h2>
        <p className="cw-card-copy">
          The CLI is the main entry point. The hosted frontend is only for human
          passkey provisioning.
        </p>
      </div>

      <div className="cw-home-command-stack">
        {quickstartSteps.map((step) => (
          <article className="cw-home-command-card" key={step.label}>
            <p className="cw-kicker">{step.label}</p>
            <pre className="cw-code-block">
              <code>{step.command}</code>
            </pre>
            <p>{step.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );

  return <ProvisioningLayout hero={hero} primary={primary} variant="marketing" />;
}
