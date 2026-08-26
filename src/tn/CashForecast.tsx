import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card, Note, SectionTitle } from "./components";
import { money } from "./format";

/**
 * Thirteen week cash forecast.
 *
 * The reader question is simple: does the balance dip, and when. So the
 * lowest week is stated first and the table below it shows the working.
 */

function weekLabel(start: string): string {
  const [, month, day] = start.split("-").map(Number);
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${names[month - 1]} ${day}`;
}

export function CashForecast() {
  const data = useQuery(api.cashForecast.forecast, {});

  if (data === undefined) {
    return (
      <Card>
        <SectionTitle>Thirteen week cash forecast</SectionTitle>
        <Note>Loading.</Note>
      </Card>
    );
  }

  const weekly =
    data.costs.payroll +
    data.costs.jobCost +
    data.costs.operating +
    data.costs.debtService;

  return (
    <Card style={{ gap: 10, padding: "14px 16px" }}>
      <SectionTitle>Thirteen week cash forecast</SectionTitle>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 16,
        }}
      >
        <Headline
          label="Cash today"
          value={data.openingCash === null ? "No data" : money(data.openingCash)}
          note="Bank balance plus undeposited funds."
        />
        <Headline
          label="Lowest week"
          value={
            data.lowestBalance === null ? "No data" : money(data.lowestBalance)
          }
          note={
            data.lowestWeek === null
              ? "Needs the QuickBooks bank balance."
              : `Week of ${weekLabel(data.lowestWeek)}, on this run rate.`
          }
        />
        <Headline
          label="Money out each week"
          value={money(Math.round(weekly))}
          note={`Payroll ${money(data.costs.payroll)}, job cost ${money(
            data.costs.jobCost,
          )}, operating ${money(data.costs.operating)}, debt ${money(
            data.costs.debtService,
          )}.`}
        />
        <Headline
          label="Invoicing each week"
          value={money(data.weeklyInvoicing)}
          note={`Average of the last twenty six weeks, tilted by how each month has run for the last two years. Slowest week ahead ${money(
            data.seasonalLow,
          )}.`}
        />
      </div>

      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 520 }}>
          <div className="tn-label tn-forecast-row" style={{ paddingBottom: 4 }}>
            <div>Week of</div>
            <div style={{ textAlign: "right" }}>From receivables</div>
            <div style={{ textAlign: "right" }}>From new work</div>
            <div style={{ textAlign: "right" }}>Money out</div>
            <div style={{ textAlign: "right" }}>Net</div>
            <div style={{ textAlign: "right" }}>Cash after</div>
          </div>
          {data.weeks.map(week => (
            <div
              key={week.start}
              className="tn-forecast-row"
              style={{
                padding: "7px 0",
                borderTop: "1px solid var(--tn-border)",
                fontSize: 14,
              }}
            >
              <div style={{ fontWeight: 600 }} data-label="Week of">
                {weekLabel(week.start)}
              </div>
              <div style={{ textAlign: "right" }} data-label="From receivables">
                {money(week.fromReceivables)}
              </div>
              <div style={{ textAlign: "right" }} data-label="From new work">
                {money(week.fromNewWork)}
              </div>
              <div style={{ textAlign: "right" }} data-label="Money out">
                {money(week.moneyOut)}
              </div>
              <div
                style={{
                  textAlign: "right",
                  color: week.net < 0 ? "var(--tn-fg-subtle)" : undefined,
                }}
                data-label="Net"
              >
                {money(week.net)}
              </div>
              <div
                style={{ textAlign: "right", fontWeight: 700 }}
                data-label="Cash after"
              >
                {week.closing === null ? "No data" : money(week.closing)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Note>
        Collections are the open receivable of {money(data.openReceivable)} aged
        against the payment timing of the last twelve months, plus the work the
        crews are expected to invoice at the recent rate, collected on the same
        timing.
      </Note>
      <Note>
        Money out is a steady weekly rate from the trailing twelve months in
        QuickBooks. Payroll lands fortnightly and bills land unevenly, so read
        the shape of the quarter rather than any single week. Nothing here is a
        budget or a plan, it is what the last year would do again.
      </Note>
    </Card>
  );
}

function Headline({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div className="tn-label" style={{ color: "var(--tn-fg-subtle)" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <Note>{note}</Note>
    </div>
  );
}
