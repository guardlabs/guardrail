import { PROJECT_DEFAULT_BACKEND_URL } from "@agent-wallet/shared";

const resolvedBackendUrl =
  __DEFAULT_BACKEND_URL__ ?? PROJECT_DEFAULT_BACKEND_URL;

export function App() {
  return (
    <main
      style={{
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        margin: "0 auto",
        maxWidth: "720px",
        padding: "48px 24px 80px",
        lineHeight: 1.5,
      }}
    >
      <p
        style={{
          color: "#5b6470",
          fontSize: "0.875rem",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        Agent Wallet
      </p>
      <h1
        style={{
          fontSize: "clamp(2rem, 5vw, 3.5rem)",
          lineHeight: 1.05,
          margin: "0 0 12px",
        }}
      >
        Provisioning flow frontend
      </h1>
      <p
        style={{
          color: "#334155",
          fontSize: "1.05rem",
          margin: "0 0 32px",
        }}
      >
        Static React + Vite app. The provisioning UI will bind the owner
        passkey, surface the counterfactual wallet address, and guide funding.
      </p>

      <section
        style={{
          border: "1px solid #cbd5e1",
          borderRadius: "16px",
          padding: "20px",
          background: "#f8fafc",
        }}
      >
        <h2
          style={{
            fontSize: "1.1rem",
            margin: "0 0 8px",
          }}
        >
          Backend target
        </h2>
        <code
          style={{
            display: "block",
            overflowWrap: "anywhere",
            color: "#0f172a",
          }}
        >
          {resolvedBackendUrl}
        </code>
      </section>
    </main>
  );
}
