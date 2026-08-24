import type { CSSProperties, ReactNode } from "react";

/** Shared pieces of the TreeNewal dashboard, built from the handoff tokens. */

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      className="tn-card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "12px 16px",
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="tn-eyebrow">{children}</div>;
}

export function Figure({
  children,
  size = 36,
}: {
  children: ReactNode;
  size?: number;
}) {
  return (
    <div className="tn-figure" style={{ fontSize: size }}>
      {children}
    </div>
  );
}

/** A value that QuickBooks has not supplied yet. Never a made up number. */
export function Pending({ label = "Awaiting QuickBooks" }: { label?: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: "var(--tn-font-sans)",
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: 0,
        textTransform: "none",
        color: "var(--tn-fg-subtle)",
      }}
    >
      {label}
    </span>
  );
}

export function Bar({
  ratio,
  color,
  height = 8,
  track = "var(--tn-bark-100)",
}: {
  ratio: number;
  color: string;
  height?: number;
  track?: string;
}) {
  const width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  return (
    <div
      style={{
        height,
        borderRadius: 999,
        background: track,
        overflow: "hidden",
      }}
    >
      <div style={{ width, height: "100%", borderRadius: 999, background: color }} />
    </div>
  );
}

export function Divider() {
  return <div style={{ height: 1, background: "var(--tn-border)" }} />;
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 12, color: "var(--tn-fg-muted)" }}>{children}</div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="tn-heading" style={{ fontSize: 20 }}>
      {children}
    </div>
  );
}

export function AttentionBar({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px",
        background: "var(--tn-sun-100)",
        border: "1px solid var(--tn-sun-300)",
        borderRadius: "var(--tn-radius-md)",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: "var(--tn-sun-500)",
          flex: "0 0 auto",
        }}
      />
      <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "var(--tn-fg)" }}>
        {children}
      </div>
      {action}
    </div>
  );
}

/** The backlog target band, always in weeks against 2.5 to 3 weeks. */
export function TargetBand({
  value,
  low,
  high,
  max = 4,
}: {
  value: number | null;
  low: number;
  high: number;
  max?: number;
}) {
  const pct = (weeks: number) => `${Math.max(0, Math.min(1, weeks / max)) * 100}%`;
  const inBand = value !== null && value >= low && value <= high;
  return (
    <div style={{ position: "relative", height: 14 }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 5,
          height: 4,
          borderRadius: 999,
          background: "var(--tn-bark-100)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: pct(low),
          width: `${((high - low) / max) * 100}%`,
          top: 5,
          height: 4,
          borderRadius: 999,
          background: "var(--tn-sun-300)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: pct(low),
          top: 1,
          width: 2,
          height: 12,
          background: "var(--tn-sun-500)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: pct(high),
          top: 1,
          width: 2,
          height: 12,
          background: "var(--tn-sun-500)",
        }}
      />
      {value !== null && (
        <div
          style={{
            position: "absolute",
            left: pct(value),
            top: 0,
            width: 14,
            height: 14,
            marginLeft: -7,
            borderRadius: 999,
            background: inBand ? "var(--tn-leaf-500)" : "var(--tn-danger)",
            border: "2px solid var(--tn-bg-elevated)",
          }}
        />
      )}
    </div>
  );
}
