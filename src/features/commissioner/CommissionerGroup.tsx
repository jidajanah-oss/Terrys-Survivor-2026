import type { ReactNode } from "react";

export function CommissionerGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="commissioner-group">
      <summary>{title}<span aria-hidden="true" className="commissioner-group__indicator">+</span></summary>
      <div className="commissioner-group__content">{children}</div>
    </details>
  );
}
