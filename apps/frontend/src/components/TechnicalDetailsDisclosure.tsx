import { useId, useState } from "react";
import type { ReactNode } from "react";

type TechnicalDetailsDisclosureProps = {
  summary: string;
  children: ReactNode;
};

export function TechnicalDetailsDisclosure({
  summary,
  children,
}: TechnicalDetailsDisclosureProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();

  return (
    <section className="cw-technical">
      <button
        aria-controls={panelId}
        aria-expanded={isOpen}
        className="cw-technical-toggle"
        onClick={() => {
          setIsOpen((currentValue) => !currentValue);
        }}
        type="button"
      >
        <span>{summary}</span>
        <span aria-hidden="true" className="cw-technical-indicator">
          {isOpen ? "Hide" : "Show"}
        </span>
      </button>

      {isOpen ? (
        <div className="cw-technical-panel" id={panelId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
