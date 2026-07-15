import type { PlayerStatus } from "../types/survivor";

export function StatusPill({ status }: { status: PlayerStatus }) {
  return <span className={`status-pill status-pill--${status}`}>{status}</span>;
}
