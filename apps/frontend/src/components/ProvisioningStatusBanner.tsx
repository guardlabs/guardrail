type ProvisioningStatusBannerProps = {
  eyebrow: string;
  title: string;
  body: string;
  status: "created" | "owner_bound" | "ready" | "failed";
  statusLabel: string;
  tone: "progress" | "ready" | "attention";
};

export function ProvisioningStatusBanner({
  eyebrow,
  title,
  body,
  status,
  statusLabel,
  tone,
}: ProvisioningStatusBannerProps) {
  return (
    <header className={`cw-status cw-status-${tone}`}>
      <p className="cw-kicker">{eyebrow}</p>
      <div className="cw-status-head">
        <h2>{title}</h2>
        <span className={`cw-status-pill cw-status-pill-${status}`}>{statusLabel}</span>
      </div>
      <p>{body}</p>
    </header>
  );
}
