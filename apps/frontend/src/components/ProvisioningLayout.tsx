import type { ReactNode } from "react";

type ProvisioningLayoutProps = {
  hero: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  variant?: "provisioning" | "marketing";
};

export function ProvisioningLayout({
  hero,
  primary,
  secondary,
  variant = "provisioning",
}: ProvisioningLayoutProps) {
  return (
    <main className="cw-shell">
      <div className={`cw-page cw-page-${variant}`}>
        <section className={`cw-hero cw-hero-${variant}`}>{hero}</section>
        <section className={`cw-workspace cw-workspace-${variant}`}>
          <div className={`cw-primary cw-primary-${variant}`}>{primary}</div>
          {secondary ? <aside className="cw-secondary">{secondary}</aside> : null}
        </section>
      </div>
    </main>
  );
}
