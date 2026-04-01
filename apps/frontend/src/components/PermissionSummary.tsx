export function PermissionSummary({ items }: { items: string[] }) {
  return (
    <section aria-label="Wallet permissions" className="cw-permissions">
      <p className="cw-kicker">Policy</p>
      <h2>What the agent can do</h2>
      <ul className="cw-permission-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
