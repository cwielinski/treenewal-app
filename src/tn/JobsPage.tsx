import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  AttentionBar,
  Bar,
  Card,
  Divider,
  Eyebrow,
  Figure,
  Note,
  Pending,
  SectionTitle,
  TargetBand,
} from "./components";
import { useDashboardState } from "./dashboardState";
import { count, money, monthLabel, percent, rangeLabel, shortDate, weeks } from "./format";

/**
 * Jobs and Backlog.
 *
 * Backlog is sold work that has not been invoiced yet, read in weeks
 * against the 2.5 to 3 week target band. The city rows and the job mix
 * read the same closed job set as the Overview and the Map.
 */

type Point = { date: string; weeks: number | null };

function BacklogChart({
  series,
  low,
  high,
}: {
  series: Point[];
  low: number;
  high: number;
}) {
  const points = series.filter(point => point.weeks !== null) as {
    date: string;
    weeks: number;
  }[];
  if (points.length < 2) {
    return <Note>Not enough invoiced history yet to draw the line.</Note>;
  }

  const width = 560;
  const height = 150;
  const padLeft = 26;
  const padBottom = 18;
  const top = 8;
  const max = Math.max(high + 0.6, ...points.map(point => point.weeks));
  const x = (index: number) =>
    padLeft + (index / (points.length - 1)) * (width - padLeft - 8);
  const y = (value: number) =>
    top + (1 - value / max) * (height - top - padBottom);

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.weeks)}`)
    .join(" ");
  const last = points[points.length - 1];
  const mid = points[Math.max(0, Math.floor(points.length / 2))];

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label="Weeks of sold work on the books over the last twenty six weeks"
      >
        <rect
          x={padLeft}
          y={y(high)}
          width={width - padLeft - 8}
          height={Math.max(2, y(low) - y(high))}
          fill="var(--tn-sun-100)"
        />
        <line
          x1={padLeft}
          x2={width - 8}
          y1={y(low)}
          y2={y(low)}
          stroke="var(--tn-sun-300)"
          strokeWidth={1}
        />
        <line
          x1={padLeft}
          x2={width - 8}
          y1={y(high)}
          y2={y(high)}
          stroke="var(--tn-sun-300)"
          strokeWidth={1}
        />
        <path d={path} fill="none" stroke="var(--tn-leaf-600)" strokeWidth={2} />
        <circle cx={x(points.length - 1)} cy={y(last.weeks)} r={4} fill="var(--tn-leaf-600)" />
        {[0, max / 2, max].map(value => (
          <text
            key={value}
            x={2}
            y={y(value) + 4}
            fontSize={12}
            fill="var(--tn-fg-subtle)"
            fontFamily="var(--tn-font-sans)"
          >
            {value.toFixed(1)}
          </text>
        ))}
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          color: "var(--tn-fg-muted)",
          marginTop: 4,
        }}
      >
        <span>
          26 weeks ago, {points[0].weeks.toFixed(1)} wks
        </span>
        <span>13 weeks ago, {mid.weeks.toFixed(1)} wks</span>
        <span>This week, {last.weeks.toFixed(1)} wks</span>
      </div>
    </div>
  );
}

export function JobsPage() {
  const { period, line } = useDashboardState();
  const data = useQuery(api.jobsScreen.jobs, { period, line });

  if (data === undefined) {
    return <div style={{ padding: 24, color: "var(--tn-fg-muted)" }}>Loading.</div>;
  }

  const backlog = data.backlog;
  const marginPending = data.marginSource !== "quickbooks";

  const backlogSentence = (() => {
    if (backlog.weeks === null) {
      return "Backlog needs invoiced history to measure.";
    }
    const value = backlog.weeks;
    if (value < backlog.targetLow) {
      return `${(backlog.targetLow - value).toFixed(1)} weeks below the target band of ${backlog.targetLow} to ${backlog.targetHigh} weeks. ${money(backlog.openValue)} of sold work not yet invoiced.`;
    }
    if (value > backlog.targetHigh) {
      return `${(value - backlog.targetHigh).toFixed(1)} weeks above the target band of ${backlog.targetLow} to ${backlog.targetHigh} weeks. ${money(backlog.openValue)} of sold work not yet invoiced.`;
    }
    return `Inside the target band of ${backlog.targetLow} to ${backlog.targetHigh} weeks. ${money(backlog.openValue)} of sold work not yet invoiced.`;
  })();

  const lineSentence = (() => {
    const production = backlog.production.weeks;
    const phc = backlog.phc.weeks;
    if (production === null || phc === null) return null;
    const shorter = production <= phc ? "Production" : "Plant Health Care";
    const longer = production <= phc ? "Plant Health Care" : "Production";
    return `${longer} carries the longer queue. ${shorter} is the short line.`;
  })();

  const schedule = data.scheduleAhead ?? { months: [], unscheduledJobs: 0, unscheduledValue: 0 };
  const maxScheduleValue = Math.max(1, ...schedule.months.map((m: any) => m.value));
  const maxCityJobs = Math.max(1, ...data.cities.map((row: any) => row.jobs));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        padding: "14px 24px 20px 24px",
      }}
    >
      {marginPending && (
        <AttentionBar>
          Margin by service type is not shown. ArboStar does not carry job level
          labor and material cost, so margin comes from QuickBooks once that
          connection is restored.
        </AttentionBar>
      )}

      {/* ---- backlog */}
      <div className="tn-grid-two" style={{ animation: "tn-rise 420ms var(--tn-ease) both" }}>
        <Card style={{ gap: 10 }}>
          <Eyebrow>Sold work on the books</Eyebrow>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <Figure size={54}>{weeks(backlog.weeks)}</Figure>
            <div className="tn-eyebrow">weeks</div>
          </div>
          <TargetBand
            value={backlog.weeks}
            low={backlog.targetLow}
            high={backlog.targetHigh}
          />
          <Note>Target {backlog.targetLow} to {backlog.targetHigh} weeks</Note>
          <div style={{ fontSize: 14, color: "var(--tn-fg)" }}>{backlogSentence}</div>
          <Divider />
          <Eyebrow>The two lines are not in the same state</Eyebrow>
          <div style={{ display: "flex", gap: 24 }}>
            <div>
              <Note>Production</Note>
              <div className="tn-heading" style={{ fontSize: 22 }}>
                {weeks(backlog.production.weeks)} wks
              </div>
            </div>
            <div>
              <Note>Plant Health Care</Note>
              <div className="tn-heading" style={{ fontSize: 22 }}>
                {weeks(backlog.phc.weeks)} wks
              </div>
            </div>
          </div>
          {lineSentence && <Note>{lineSentence}</Note>}
        </Card>

        <Card style={{ gap: 10 }}>
          <Eyebrow>Weekly backlog, last twenty six weeks</Eyebrow>
          <BacklogChart
            series={backlog.series}
            low={backlog.targetLow}
            high={backlog.targetHigh}
          />
          <Note>
            Weeks on the books against the target band. Run rate is invoiced work
            over the last twenty six weeks, {money(backlog.weeklyRunRate)} a week.
          </Note>
          {backlog.runsOut && (
            <Note>Sold work runs out around {shortDate(backlog.runsOut)}.</Note>
          )}
        </Card>
      </div>

      {/* ---- schedule ahead. Built from the only dated field ArboStar has. */}
      <Card style={{ gap: 10 }}>
        <SectionTitle>The schedule ahead</SectionTitle>
        <Note>One crew pool. Capacity is not split by service line.</Note>
        {schedule.months.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {schedule.months.map((row: any) => (
              <div key={row.month} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                  <span style={{ fontWeight: 600 }}>{monthLabel(row.month)}</span>
                  <span style={{ color: "var(--tn-fg-muted)" }}>
                    {count(row.jobs)} · {money(row.value)}
                  </span>
                </div>
                <Bar ratio={row.value / maxScheduleValue} color="var(--tn-leaf-500)" height={6} />
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 14 }}>
            <Pending label="Awaiting a crew schedule feed" />
          </div>
        )}
        <Note>
          Plant Health Care work orders carry their treatment month in the job
          status, so that book of work is shown by month. Production work orders
          carry no scheduled date and no man hours, so {count(schedule.unscheduledJobs)}{" "}
          undated jobs worth {money(schedule.unscheduledValue)} sit outside this
          view and are counted in weeks of sold work above.
        </Note>
      </Card>

      {/* ---- demand and mix */}
      <div className="tn-grid-two">
        <Card style={{ gap: 10 }}>
          <SectionTitle>Where the work is coming from</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.cities.map((row: any) => (
              <div key={row.city} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                  <span style={{ fontWeight: 600 }}>{row.city}</span>
                  <span style={{ color: "var(--tn-fg-muted)" }}>
                    {count(row.jobs)} · {money(row.averageJobValue)} avg
                  </span>
                </div>
                <Bar ratio={row.jobs / maxCityJobs} color="var(--tn-leaf-500)" height={6} />
              </div>
            ))}
            {data.cities.length === 0 && <Note>No closed jobs in this period.</Note>}
          </div>
          <Note>
            Service areas only, one crew pool. {count(data.jobSet.jobsClosed)} jobs
            closed this period.
          </Note>
        </Card>

        <Card style={{ gap: 10 }}>
          <SectionTitle>Job mix and value</SectionTitle>
          <Note>Closed this period, by service type.</Note>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--tn-fg-muted)" }}>
                <th style={{ fontWeight: 600, padding: "4px 0" }}>Service type</th>
                <th style={{ fontWeight: 600, textAlign: "right", paddingLeft: 14 }}>Jobs</th>
                <th style={{ fontWeight: 600, textAlign: "right", paddingLeft: 14 }}>Revenue</th>
                <th className="tn-col-wide" style={{ fontWeight: 600, textAlign: "right" }}>
                  Avg job
                </th>
                <th className="tn-col-wide" style={{ fontWeight: 600, textAlign: "right" }}>
                  Margin
                </th>
              </tr>
            </thead>
            <tbody>
              {data.jobMix.map((row: any) => (
                <tr key={row.name} style={{ borderTop: "1px solid var(--tn-border)" }}>
                  <td style={{ padding: "6px 0" }}>{row.name}</td>
                  <td style={{ textAlign: "right", paddingLeft: 14 }}>{count(row.jobs)}</td>
                  <td style={{ textAlign: "right", paddingLeft: 14 }}>{money(row.revenue)}</td>
                  <td className="tn-col-wide" style={{ textAlign: "right" }}>
                    {money(row.averageJobValue)}
                  </td>
                  <td className="tn-col-wide" style={{ textAlign: "right", color: "var(--tn-fg-subtle)" }}>
                    {row.margin === null ? "Not yet" : percent(row.margin, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.jobMix.length === 0 && <Note>No closed jobs in this period.</Note>}
          <Note>
            Revenue is the line item value on the invoice, so the rows add to the
            closed job value of {money(data.jobSet.closedValue)}.
          </Note>
        </Card>
      </div>

      {/* ---- pipeline */}
      <div className="tn-grid-two">
        <Card style={{ gap: 10 }}>
          <SectionTitle>Open estimates</SectionTitle>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <Figure size={28}>{count(data.openEstimates.count)}</Figure>
            <div style={{ fontSize: 14, color: "var(--tn-fg-muted)" }}>
              open, {money(data.openEstimates.value)}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.openEstimates.buckets.map((bucket: any) => (
              <div key={bucket.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span>{bucket.label === "30+" ? "30+ days" : `${bucket.label} days`}</span>
                <span style={{ color: "var(--tn-fg-muted)" }}>
                  {money(bucket.value)} · {count(bucket.count)}
                </span>
              </div>
            ))}
          </div>
          <Divider />
          <Eyebrow>Proposal value won</Eyebrow>
          <Note>Dollars won over dollars proposed, {rangeLabel(data.range)}.</Note>
          <div style={{ display: "flex", gap: 24 }}>
            <div>
              <Note>Production</Note>
              <div className="tn-heading" style={{ fontSize: 22 }}>
                {percent(data.proposalValueWon.production)}
              </div>
            </div>
            <div>
              <Note>Plant Health Care</Note>
              <div className="tn-heading" style={{ fontSize: 22 }}>
                {percent(data.proposalValueWon.phc)}
              </div>
            </div>
          </div>
        </Card>

        <Card style={{ gap: 10 }}>
          <SectionTitle>Largest open estimates</SectionTitle>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--tn-fg-muted)" }}>
                <th style={{ fontWeight: 600, padding: "4px 0" }}>Estimate</th>
                <th style={{ fontWeight: 600 }}>Where</th>
                <th style={{ fontWeight: 600, textAlign: "right" }}>Value</th>
                <th style={{ fontWeight: 600, textAlign: "right" }}>Days</th>
              </tr>
            </thead>
            <tbody>
              {data.openEstimates.largest.map((row: any, index: number) => (
                <tr key={index} style={{ borderTop: "1px solid var(--tn-border)" }}>
                  <td style={{ padding: "6px 0" }}>{row.name}</td>
                  <td style={{ color: "var(--tn-fg-muted)" }}>{row.city}</td>
                  <td style={{ textAlign: "right" }}>{money(row.value)}</td>
                  <td style={{ textAlign: "right" }}>{count(row.days)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.openEstimates.largest.length === 0 && <Note>No open estimates.</Note>}
          <Note>
            These five carry{" "}
            {money(
              data.openEstimates.largest.reduce(
                (total: number, row: any) => total + row.value,
                0,
              ),
            )}
            .
          </Note>
        </Card>
      </div>

      <Note>
        Estimates and job records from ArboStar. A job counts as closed on its
        invoice date, which is the date QuickBooks bills it.
      </Note>
    </div>
  );
}
