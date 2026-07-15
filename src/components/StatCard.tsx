interface StatCardProps {
  label: string;
  value: string | number;
  note?: string;
}

export function StatCard({ label, value, note }: StatCardProps) {
  return (
    <article className="stat-card">
      <span className="stat-card__label">{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </article>
  );
}
