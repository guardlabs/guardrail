import { ProvisioningLayout } from "./ProvisioningLayout.js";

const basics = [
  "No long-lived hot key shipped to the agent.",
  "The human stays the durable owner through a passkey.",
  "Runtime access stays policy-gated and deny-by-default.",
] as const;

export function MarketingHome() {
  const hero = (
    <div className="cw-home-hero">
      <div className="cw-brand-row">
        <p className="cw-eyebrow">Guard Labs</p>
        <span className="cw-hero-chip">Wallet guardrails for agents</span>
      </div>

      <div className="cw-home-hero-grid">
        <div className="cw-home-copy">
          <h1>Wallet guardrails for agents</h1>
          <p className="cw-lede">
            Guardrail is the Guard Labs product for giving agents onchain wallet
            access without shipping a hot key. The human stays the owner, and
            the runtime path stays policy-gated.
          </p>

          <div className="cw-home-actions">
            <a
              className="cw-primary-button cw-home-button"
              href="https://github.com/guardlabs/guardrail/blob/main/docs/README.md"
              rel="noreferrer"
              target="_blank"
            >
              Docs
            </a>
            <a
              className="cw-secondary-button"
              href="https://github.com/guardlabs/guardrail"
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
          <p className="cw-home-note">
            Run the CLI with <code>npx @guardlabs/guardrail-cli ...</code>. The
            official hosted frontend lives at <code>guardlabs.ai</code>. Start
            with the GitHub docs for installation, policy examples, the CLI
            flow, and the hosted deployment model. If you self-host the backend,
            self-host the frontend too.
          </p>
        </div>
      </div>
    </div>
  );

  const primary = (
    <section className="cw-home-single">
      <div className="cw-home-single-head">
        <p className="cw-kicker">Overview</p>
        <h2>Agents can only do what their policy allows</h2>
        <p className="cw-card-copy">
          Guardrail is built for agents that need wallet access, but should not
          be trusted with an unrestricted key they can export, reuse, or drain.
        </p>
      </div>

      <div className="cw-home-explainer">
        <p className="cw-home-explainer-copy">
          The agent does not hold a fully privileged wallet key. It can only ask
          to perform runtime actions that fit the wallet policy.
        </p>
        <p className="cw-home-explainer-copy">
          Guardrail enforces that policy on the backend and co-signs only the
          actions that are allowed. Anything outside the configured policy is
          denied.
        </p>
        <p className="cw-home-explainer-copy">
          The official hosted frontend is pinned to the official backend. Custom
          backend deployments should ship with their own frontend.
        </p>

        <ul className="cw-home-flow">
          <li>The human remains the durable wallet owner through a passkey.</li>
          <li>The agent can request runtime actions autonomously.</li>
          <li>
            The Guardrail backend co-signs only what the policy explicitly
            allows.
          </li>
        </ul>
      </div>
    </section>
  );

  return (
    <ProvisioningLayout hero={hero} primary={primary} variant="marketing" />
  );
}
