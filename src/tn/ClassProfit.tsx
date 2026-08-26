import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Card, Note, SectionTitle } from "./components";
import { useDashboardState } from "./dashboardState";
import { money } from "./format";

/**
 * Profit by type of work, from the QuickBooks class on each line.
 *
 * The toggle is the whole point of the section. Direct costs only answers
 * "does the crew make money on this work". With overhead allocated answers
 * "does this work carry its share of the office". They give different
 * answers and Wes wants both.
 */

function marginText(value: number | null): string {
  if (value === null) return "No revenue";
  return `${value.toFixed(1)}%`;
}

export function ClassProfit() {
  const { period } = useDashboardState();
  const [allocate, setAllocate] = useState(false);
  const data = useQuery(api.classMargin.byClass, {
    period,
    allocateOverhead: allocate,
  });


  return (
    <Card style={{ gap: 10, padding: "14px 16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <SectionTitle>Profit by type of work</SectionTitle>
        <div style={{ display: "flex", gap: 6 }}>
          <ToggleButton
            active={!allocate}
            onClick={() => setAllocate(false)}
            label="Direct costs only"
          />
          <ToggleButton
            active={allocate}
            onClick={() => setAllocate(true)}
            label="With overhead"
          />
        </div>
      </div>

      {data === undefined ? (
        <Note>Loading.</Note>
      ) : data.rows.length === 0 ? (
        <Note>
          No class figures for this period yet. They are built on the twice
          daily refresh.
        </Note>
      ) : (
        <>
          <div
            className={`tn-label tn-class-row${allocate ? " tn-class-row-oh" : ""}`}
            style={{ paddingBottom: 4 }}
          >
            <div>Class</div>
            <div style={{ textAlign: "right" }}>Revenue</div>
            <div style={{ textAlign: "right" }}>Direct cost</div>
            {allocate && <div style={{ textAlign: "right" }}>Overhead</div>}
            <div style={{ textAlign: "right" }}>Profit</div>
            <div style={{ textAlign: "right" }}>Margin</div>
          </div>

          {data.rows.map(row => (
            <div
              key={row.className}
              className={`tn-class-row${allocate ? " tn-class-row-oh" : ""}`}
              style={{
                padding: "8px 0",
                borderTop: "1px solid var(--tn-border)",
                fontSize: 13,
                color: row.isUnassigned ? "var(--tn-fg-subtle)" : undefined,
              }}
            >
              <div style={{ fontWeight: 600 }} data-label="Class">
                {row.className}
              </div>
              <div style={{ textAlign: "right" }} data-label="Revenue">
                {money(row.revenue)}
              </div>
              <div style={{ textAlign: "right" }} data-label="Direct cost">
                {money(row.directCost)}
              </div>
              {allocate && (
                <div style={{ textAlign: "right" }} data-label="Overhead">
                  {money(row.allocatedOverhead ?? 0)}
                </div>
              )}
              <div
                style={{ textAlign: "right", fontWeight: 700 }}
                data-label="Profit"
              >
                {money(row.profit)}
              </div>
              <div
                data-label="Margin"
                style={{
                  textAlign: "right",
                  fontWeight: 700,
                  fontSize:
                    row.revenue <= 0 || (row.marginPct ?? 0) < -100 ? 12 : undefined,
                  color:
                    row.marginPct !== null && row.marginPct < 0
                      ? "var(--tn-bark-500)"
                      : undefined,
                }}
              >
                {row.revenue <= 0 || (row.marginPct ?? 0) < -100
                  ? "Not meaningful"
                  : marginText(row.marginPct)}
              </div>
            </div>
          ))}

          <Note>
            {allocate
              ? `Overhead of ${money(
                  data.overhead ?? 0,
                )} is spread across the classes by share of revenue. That is an assumption, not a measurement: QuickBooks does not tag office costs to a class. Owner guaranteed payments are left out, since they are draws rather than a cost the work has to carry.`
              : "Direct cost is what QuickBooks holds in cost of goods sold for that class, which is crew wages, materials, subcontractors and equipment on the job. Office and sales costs are not included."}
          </Note>
          <Note>
            Rows add up to the revenue and gross profit at the top of this
            screen. Work QuickBooks does not tag to a class is shown on its own
            row rather than spread across the others.
          </Note>
          {!data.complete && (
            <Note>
              Part of this period has not been built yet, so the figures are
              incomplete.
            </Note>
          )}
        </>
      )}
    </Card>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tn-label"
      style={{
        padding: "5px 12px",
        borderRadius: 999,
        border: "1px solid var(--tn-border)",
        background: active ? "var(--tn-ink)" : "transparent",
        color: active ? "var(--tn-cream)" : "var(--tn-fg-muted)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
