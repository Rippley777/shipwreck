import { Anchor, FolderGit2, ShieldCheck } from "lucide-react";
export function PageTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">WORKSPACE INTELLIGENCE</div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
    </div>
  );
}

export function Stat({
  title,
  value,
  icon,
  detail,
  className = "",
  trend,
  values = [0, 0],
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  detail: React.ReactNode;
  className?: string;
  trend?: string;
  values?: number[];
}) {
  return (
    <div className="stat-card">
      <div className="stat-title">
        {title}
        <span>{icon}</span>
      </div>
      <div className="stat-value-row">
        <strong className={className}>{value}</strong>
        {trend && (
          <Trend
            color={
              trend === "red"
                ? "var(--red)"
                : trend === "amber"
                  ? "var(--amber)"
                  : "var(--mint)"
            }
            values={values}
          />
        )}
      </div>
      <div className="stat-detail">{detail}</div>
    </div>
  );
}

export function LayersIcon() {
  return <FolderGit2 size={21} />;
}

export function RadarGraphic() {
  return (
    <div className="radar-art" aria-hidden="true">
      <div className="radar-ring r1" />
      <div className="radar-ring r2" />
      <div className="radar-ring r3" />
      <div className="radar-ring r4" />
      <div className="radar-cross horizontal" />
      <div className="radar-cross vertical" />
      <div className="radar-sweep" />
      <span className="radar-center">
        <ShieldCheck size={26} />
      </span>
      <i className="blip b1" />
      <i className="blip b2" />
      <i className="blip b3" />
      <span className="radar-label">SYSTEMS IN SIGHT</span>
    </div>
  );
}

export function Trend({
  color = "var(--mint)",
  values,
}: {
  color?: string;
  values: number[];
}) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const points = values
    .map(
      (v, i) =>
        `${(i * 100) / Math.max(1, values.length - 1)},${28 - ((v - min) / Math.max(1, max - min)) * 24}`,
    )
    .join(" ");
  return (
    <svg
      className="sparkline"
      viewBox="0 0 100 32"
      role="img"
      aria-label={`Previous and current scan totals: ${values.join(", ")}`}
    >
      <title>{values.join(" → ")}</title>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M0 31H100" stroke="var(--border)" strokeDasharray="3 4" />
    </svg>
  );
}

export function Status({ status }: { status?: string }) {
  return (
    <span
      className={
        "status " +
        (status === "Shipworthy"
          ? "green"
          : status === "Launch Blocked"
            ? "red"
            : "amber")
      }
    >
      <span />
      {status || "Not scanned"}
    </span>
  );
}

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={"brand " + (small ? "brand-small" : "")}>
      <span className="brand-icon">
        <Anchor size={small ? 18 : 23} strokeWidth={2.3} />
      </span>
      {!small && (
        <>
          SHIPWRECK<span className="brand-dot">.</span>
        </>
      )}
    </div>
  );
}
