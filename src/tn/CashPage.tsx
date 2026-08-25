import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  AttentionBar,
  Bar,
  Card,
  Eyebrow,
  Figure,
  Note,
  Pending,
  SectionTitle,
} from "./components";
import { SourceFreshness } from "./Freshness";
import { useDashboardState } from "./dashboardState";
import { count, money, monthLabel, rangeLabel, shortDate } from "./format";

/**
 * Cash.
 *
 * Receivables and payment behaviour are real, read from the invoice mirror.
 * Cash on hand, cash out, payroll, bills and debt service are QuickBooks
 * figures and read "Awaiting QuickBooks" until that connection is restored.
 */

type Point = { month: string; days: number | null };

function DaysToPaymentChart({ series }: { series: Point[] }) {
  const points = series.filter(point => point.days !== null) as {
    month: string;
    days: number;
  }[];
  if (points.length < 2) {
    return <Note>Not enough settled invoices yet to draw the line.</Note>;
  }

  const width = 520;
  const height = 130;
  const padLeft = 30;
  const padBottom = 16;
  const top = 8;
  const max = Math.max(...points.map(point => point.days)) * 1.15;
  const x = (index: number) =>
    padLeft + (index / (points.length - 1)) * (width - padLeft - 8);
  const y = (value: number) => top + (1 - value / max) * (height - top - padBottom);
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.days)}`)
    .join(" ");
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label="Average days to payment over the last twelve months"
      >
        <line
          x1={padLeft}
          x2={width - 8}
          y1={height - padBottom}
          y2={height - padBottom}
          stroke="var(--tn-border)"
        />
        <path d={path} fill="none" stroke="var(--tn-leaf-500)" strokeWidth={2} />
        <circle cx={x(points.length - 1)} cy={y(last.days)} r={4} fill="var(--tn-leaf-500)" />
        <text x={2} y={y(max * 0.92)} fontSize={12} fill="var(--tn-fg-subtle)">
          {Math.round(max)}
        </text>
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Note>
          {monthLabel(first.month)} · {first.days} days
        </Note>
        <Note>
          {monthLabel(last.month)} · {last.days} days
        </Note>
      </div>
    </div>
  );
}

export function CashPage() {
  const { period, line, segment } = useDashboardState();
  const data = useQuery(api.cashScreen.cash, { period, line, segment });

  if (data === undefined) {
    return (
      <div style={{ padding: 24 }}>
        <Note>Loading cash.</Note>
      </div>
    );
  }

  const waiting = data.quickbooks.status !== "ok";
  const receivables = data.receivables;
  const maxBucket = Math.max(1, ...receivables.buckets.map((b: any) => b.value));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 20 }}>
      {waiting && (
        <AttentionBar>
          Cash on hand, cash out, payroll, bills coming due and debt service come
          from QuickBooks, which is not connected. Everything drawn from invoices
          is live.
        </AttentionBar>
      )}

      <div className="tn-grid-cash">
        <Card>
          <Eyebrow>Cash position</Eyebrow>
          <Figure size={30}>
            {waiting ? <Pending /> : money(data.quickbooks.cashOnHand)}
          </Figure>
          <Note>Cash on hand</Note>
        </Card>
        <Card>
          <Eyebrow>Collected this period</Eyebrow>
          <Figure size={30}>{money(data.collected)}</Figure>
          <Note>Payments received against invoices, {rangeLabel(data.range)}</Note>
        </Card>
        <Card>
          <Eyebrow>Cash out this period</Eyebrow>
          <Figure size={30}>
            {waiting ? <Pending /> : money(data.quickbooks.cashOut)}
          </Figure>
          <Note>Payroll, operating expenses and debt service</Note>
        </Card>
        <Card>
          <Eyebrow>Owed to us</Eyebrow>
          <Figure size={30}>{money(receivables.total)}</Figure>
          <Note>Across {count(receivables.count)} open invoices</Note>
        </Card>
      </div>

      <div className="tn-grid-two">
        <Card style={{ gap: 12 }}>
          <SectionTitle>Owed to us</SectionTitle>
          <Note>
            {money(receivables.total)} across {count(receivables.count)} open invoices, aged by days past due, on {data.termsDays} day terms.
          </Note>
          {receivables.buckets.map((bucket: any) => (
            <div key={bucket.label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span style={{ fontWeight: 600 }}>{bucket.label}</span>
                <span>
                  {count(bucket.count)} invoices · {money(bucket.value)}
                </span>
              </div>
              <Bar
                ratio={bucket.value / maxBucket}
                color={
                  bucket.label === "Over 60 days"
                    ? "var(--tn-danger)"
                    : "var(--tn-leaf-500)"
                }
              />
            </div>
          ))}

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--tn-fg-muted)" }}>
                <th style={{ fontWeight: 600, padding: "4px 0" }}>Customer</th>
                <th style={{ fontWeight: 600, textAlign: "right", paddingLeft: 14 }}>
                  Amount
                </th>
                <th style={{ fontWeight: 600, textAlign: "right", paddingLeft: 14 }}>
                  Days
                </th>
                <th className="tn-col-wide" style={{ fontWeight: 600, textAlign: "right", paddingLeft: 14 }}>
                  Service line
                </th>
                <th className="tn-col-wide" style={{ fontWeight: 600, textAlign: "right", paddingLeft: 14 }}>
                  Invoiced
                </th>
              </tr>
            </thead>
            <tbody>
              {receivables.topOverdue.map((row: any) => (
                <tr key={row.number} style={{ borderTop: "1px solid var(--tn-border)" }}>
                  <td style={{ padding: "6px 0" }}>{row.client}</td>
                  <td style={{ textAlign: "right", paddingLeft: 14 }}>
                    {money(row.amount)}
                  </td>
                  <td style={{ textAlign: "right", paddingLeft: 14 }}>{row.days}</td>
                  <td className="tn-col-wide" style={{ textAlign: "right", paddingLeft: 14 }}>
                    {row.serviceLine === "phc" ? "Plant Health Care" : "Production"}
                  </td>
                  <td className="tn-col-wide" style={{ textAlign: "right", paddingLeft: 14 }}>
                    {shortDate(row.invoiced)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {receivables.moreOverdue.count > 0 && (
            <Note>
              {count(receivables.moreOverdue.count)} more invoices over 30 days ·{" "}
              {money(receivables.moreOverdue.value)}
            </Note>
          )}
          {receivables.residual.count > 0 && (
            <Note>
              {count(receivables.residual.count)} of these are balances under $
              {receivables.residual.limit}, {money(receivables.residual.value)} in
              total. That is rounding residue in ArboStar rather than money to
              chase.
            </Note>
          )}
          {receivables.topOverdue.length === 0 && (
            <Note>Nothing is more than 30 days overdue.</Note>
          )}
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <Eyebrow>What we owe</Eyebrow>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
              <div>
                <Figure size={24}>
                  {waiting ? <Pending /> : money(data.quickbooks.payroll)}
                </Figure>
                <Note>Payroll this period</Note>
              </div>
              <div>
                <Figure size={24}>
                  {waiting ? <Pending /> : money(data.quickbooks.operatingExpenses)}
                </Figure>
                <Note>Operating expenses this period</Note>
              </div>
              <div>
                <Figure size={24}>
                  {waiting ? <Pending /> : money(data.quickbooks.debtService)}
                </Figure>
                <Note>Debt service, the acquisition loan</Note>
              </div>
            </div>
          </Card>

          <Card style={{ gap: 8 }}>
            <Eyebrow>Average days to payment</Eyebrow>
            <Figure size={30}>
              {data.payment.latest === null ? "No data" : `${data.payment.latest} days`}
            </Figure>
            <Note>This month, twelve month history below.</Note>
            <DaysToPaymentChart series={data.payment.daysToPayment} />
          </Card>

          <Card>
            <Eyebrow>Paid within terms</Eyebrow>
            <Figure size={30}>
              {data.payment.paidWithinTermsShare === null
                ? "No data"
                : `${data.payment.paidWithinTermsShare}%`}
            </Figure>
            <Note>
              Of the {count(data.payment.paidInPeriod)} invoices settled this period,
              paid within {data.termsDays} days of the invoice date.
            </Note>
          </Card>
        </div>
      </div>

      <Card>
        <SectionTitle>Thirteen week cash forecast</SectionTitle>
        <Note>
          Scheduled work, expected collection timing and recurring costs. Both
          sides are now available, collections from invoice history and costs
          from QuickBooks. Being built next.
        </Note>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Note>
          Receivables, collections and payment timing come from ArboStar invoices and
          their payments. Cash on hand, payroll, operating expenses and debt service
          come from QuickBooks.
        </Note>
        <SourceFreshness combined />
      </div>
    </div>
  );
}
