import { useQuery } from "convex/react";
import { useAction } from "convex/react";
import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { api } from "../../convex/_generated/api";
import { clockTime } from "./format";
import {
  DashboardStateProvider,
  LINES,
  SEGMENTS,
  type SegmentKey,
  type LineKey,
  PERIODS,
  type PeriodKey,
  useDashboardState,
} from "./dashboardState";

/**
 * Navigation is the five text links in the header, matching the mockups.
 * On small screens the same five become a bottom tab bar and the two
 * controls move to a row above it.
 */
const NAV = [
  { to: "/overview", label: "Overview", screen: "overview" as const },
  { to: "/jobs", label: "Jobs", screen: "jobs" as const },
  { to: "/map", label: "Map", screen: "map" as const },
  { to: "/cash", label: "Cash", screen: "cash" as const },
  { to: "/marketing", label: "Marketing", screen: "marketing" as const },
];

function RefreshButton() {
  const refresh = useAction(api.refresh.refreshNow);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      title="Refresh"
      aria-label="Refresh"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await refresh({});
        } finally {
          setTimeout(() => setBusy(false), 2000);
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        padding: 0,
        background: "transparent",
        border: "1px solid var(--tn-border)",
        borderRadius: 999,
        color: "var(--tn-fg-muted)",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.5 : 1,
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
      </svg>
    </button>
  );
}

/**
 * The calculations guide. A quiet link rather than a sixth nav item, so the
 * five screen links in the header stay as specified.
 */
function GuideLink() {
  const location = useLocation();
  const active = location.pathname.startsWith("/guide");
  return (
    <NavLink
      to="/guide"
      title="How these figures are calculated"
      aria-label="How these figures are calculated"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: 999,
        border: "1px solid var(--tn-border)",
        color: active ? "var(--tn-leaf-600)" : "var(--tn-fg-muted)",
        textDecoration: "none",
        fontFamily: "var(--tn-font-sans)",
        fontSize: 12,
        fontWeight: 700,
        flex: "0 0 auto",
      }}
    >
      ?
    </NavLink>
  );
}

function PeriodSelect({ className }: { className?: string }) {
  const { period, setPeriod } = useDashboardState();
  return (
    <select
      className={`tn-select ${className ?? ""}`}
      aria-label="Period"
      value={period}
      onChange={event => setPeriod(event.target.value as PeriodKey)}
    >
      {PERIODS.map(option => (
        <option key={option.key} value={option.key}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function LineSegmented() {
  const { line, setLine } = useDashboardState();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: 3,
        background: "var(--tn-bark-100)",
        border: "1px solid var(--tn-border)",
        borderRadius: 999,
      }}
    >
      {LINES.map(option => {
        const active = option.key === line;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => setLine(option.key)}
            style={{
              whiteSpace: "nowrap",
              fontFamily: "var(--tn-font-sans)",
              fontSize: 12,
              fontWeight: active ? 700 : 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: active ? "var(--tn-fg)" : "var(--tn-fg-muted)",
              background: active ? "var(--tn-bg-elevated)" : "transparent",
              border: "none",
              boxShadow: active ? "var(--tn-shadow-sm)" : "none",
              padding: "7px 12px",
              borderRadius: 999,
              cursor: "pointer",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function LineSelect() {
  const { line, setLine } = useDashboardState();
  return (
    <select
      className="tn-select"
      aria-label="Service line"
      style={{ flex: 1, minWidth: 0, height: 44 }}
      value={line}
      onChange={event => setLine(event.target.value as LineKey)}
    >
      {LINES.map(option => (
        <option key={option.key} value={option.key}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function SegmentSelect({ className, mobile }: { className?: string; mobile?: boolean }) {
  const { segment, setSegment } = useDashboardState();
  return (
    <select
      className={`tn-select ${className ?? ""}`}
      aria-label="Government work"
      style={mobile ? { flex: 1, minWidth: 0, height: 44 } : undefined}
      value={segment}
      onChange={event => setSegment(event.target.value as SegmentKey)}
    >
      {SEGMENTS.map(option => (
        <option key={option.key} value={option.key}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function useLastRefresh(): number | null {
  const sources = useQuery(api.metrics.sourceStatus, {});
  if (!sources) return null;
  const times = sources
    .map(source => source.lastSuccessAt)
    .filter((value): value is number => value !== null);
  return times.length > 0 ? Math.max(...times) : null;
}

export function DashboardShell() {
  return (
    <DashboardStateProvider>
      <ShellInner />
    </DashboardStateProvider>
  );
}

function ShellInner() {
  const access = useQuery(api.access.myAccess, {});
  const lastRefresh = useLastRefresh();
  const location = useLocation();

  const visibleNav = NAV.filter(item => access?.screens?.[item.screen]);
  // Access settings are owner only, and sit after the five screen links.
  const showAccess = access?.role === "owner";

  return (
    <div
      className="tn-app"
      style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}
    >
      {/* Desktop header */}
      <header
        className="tn-header-desktop"
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 20,
          height: 56,
          padding: "0 24px",
          background: "var(--tn-bg)",
          borderBottom: "1px solid var(--tn-border)",
        }}
      >
        <img
          src="/logo-full.png"
          alt="TreeNewal"
          style={{ height: 38, width: "auto", display: "block", flex: "0 0 auto" }}
        />
        <nav
          style={{
            display: "flex",
            alignItems: "center",
            gap: 22,
            marginRight: "auto",
            flex: "0 0 auto",
          }}
        >
          {visibleNav.map(item => {
            const active = location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: 56,
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                  color: active ? "var(--tn-leaf-600)" : "var(--tn-fg)",
                  opacity: active ? 1 : 0.5,
                }}
              >
                <span
                  style={{
                    paddingBottom: 4,
                    borderBottom: active
                      ? "2px solid var(--tn-leaf-500)"
                      : "2px solid transparent",
                  }}
                >
                  {item.label}
                </span>
              </NavLink>
            );
          })}
          {showAccess && (
            <NavLink
              to="/access"
              style={{
                display: "flex",
                alignItems: "center",
                height: 56,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                textDecoration: "none",
                whiteSpace: "nowrap",
                color: location.pathname.startsWith("/access")
                  ? "var(--tn-leaf-600)"
                  : "var(--tn-fg)",
                opacity: location.pathname.startsWith("/access") ? 1 : 0.5,
              }}
            >
              <span
                style={{
                  paddingBottom: 4,
                  borderBottom: location.pathname.startsWith("/access")
                    ? "2px solid var(--tn-leaf-500)"
                    : "2px solid transparent",
                }}
              >
                Access
              </span>
            </NavLink>
          )}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flex: "0 0 auto" }}>
          <LineSegmented />
          <PeriodSelect />
          <SegmentSelect />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12,
              color: "var(--tn-fg-subtle)",
            }}
          >
            <GuideLink />
            <span style={{ whiteSpace: "nowrap" }}>
              Updated {clockTime(lastRefresh)}
            </span>
            <RefreshButton />
          </div>
        </div>
      </header>

      {/* Mobile header */}
      <header
        className="tn-header-mobile"
        style={{
          flex: "0 0 auto",
          display: "none",
          alignItems: "center",
          justifyContent: "space-between",
          height: 56,
          padding: "0 16px",
          background: "var(--tn-bg)",
          borderBottom: "1px solid var(--tn-border)",
        }}
      >
        <img
          src="/logo-full.png"
          alt="TreeNewal"
          style={{ height: 32, width: "auto", display: "block" }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: "var(--tn-fg-subtle)",
          }}
        >
          <GuideLink />
          <span style={{ whiteSpace: "nowrap" }}>Updated {clockTime(lastRefresh)}</span>
          <RefreshButton />
        </div>
      </header>

      <main className="tn-main" style={{ flex: 1, minHeight: 0 }}>
        <Outlet />
      </main>

      {/* Mobile controls and tab bar */}
      <div
        className="tn-mobile-controls"
        style={{
          display: "none",
          gap: 10,
          padding: "12px 16px",
          background: "var(--tn-bg)",
          borderTop: "1px solid var(--tn-border)",
        }}
      >
        <PeriodSelect className="tn-select-mobile" />
        <LineSelect />
        <SegmentSelect mobile />
      </div>
      <nav
        className="tn-tabbar"
        style={{
          display: "none",
          alignItems: "stretch",
          height: 56,
          background: "var(--tn-bg)",
          borderTop: "1px solid var(--tn-border)",
        }}
      >
        {visibleNav.map(item => {
          const active = location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                textDecoration: "none",
                color: active ? "var(--tn-leaf-600)" : "var(--tn-fg)",
                opacity: active ? 1 : 0.5,
              }}
            >
              {item.label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
