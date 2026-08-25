import { useQuery } from "convex/react";
import { useState } from "react";
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
import { SourceFreshness } from "./Freshness";
import { useDashboardState } from "./dashboardState";
import { count, lineName, money, percent, rangeLabel, shortDate, weeks } from "./format";

/**
 * Executive Overview.
 *
 * Figures that come from ArboStar are live. Figures that come from
 * QuickBooks show an awaiting state until that connection is restored,
 * rather than a placeholder that reads like a real number.
 */
export function OverviewPage() {
  const { period, line } = useDashboardState();
  const data = useQuery(api.metrics.overview, { period, line });
  const [drillOpen, setDrillOpen] = useState(false);

  if (data === undefined) {
    return (
      <div style={{ padding: 24, color: "var(--tn-fg-muted)" }}>Loading.</div>
    );
  }

  const finance = data.finance ?? null;
  const qbLive = data.sources?.quickbooks?.status === "ok";
  const jobs = data.jobSet;
  const pipeline = data.pipeline;
  const backlog = data.backlog;
  const production = data.serviceLines.production;
  const phc = data.serviceLines.phc;

  const totalLineValue = production.jobValue + phc.jobValue;
  const productionShare = totalLineValue > 0 ? production.jobValue / totalLineValue : 0;

  const backlogStatus = (() => {
    if (backlog.weeks === null) return "Backlog needs a completed job history to measure.";
    const value = backlog.weeks;
    if (value < backlog.targetLow) {
      const gap = (backlog.targetLow - value).toFixed(1);
      return `${gap} weeks below the target band of ${backlog.targetLow} to ${backlog.targetHigh} weeks.${backlog.shortestLine ? ` ${backlog.shortestLine} is the short line.` : ""}`;
    }
    if (value > backlog.targetHigh) {
      const gap = (value - backlog.targetHigh).toFixed(1);
      return `${gap} weeks above the target band of ${backlog.targetLow} to ${backlog.targetHigh} weeks.`;
    }
    return `Inside the target band of ${backlog.targetLow} to ${backlog.targetHigh} weeks.`;
  })();

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 20,
        padding: "14px 24px 20px 24px",
      }}
    >
      {!qbLive && (
        <AttentionBar>
          QuickBooks is not connected, so revenue, gross profit, cash collected,
          payroll, expenses and receivables are not shown. Jobs, pipeline and
          backlog are live from ArboStar.
        </AttentionBar>
      )}

      {/* ---- headline figures */}
      <div className="tn-grid-kpi" style={{ animation: "tn-rise 420ms var(--tn-ease) both" }}>
        <Card style={{ gap: 4, padding: "9px 14px" }}>
          <Eyebrow>Revenue</Eyebrow>
          {finance?.revenue !== null && finance?.revenue !== undefined ? (
            <>
              <Figure>{money(finance.revenue)}</Figure>
              <Note>Invoiced {rangeLabel(data.range)}</Note>
            </>
          ) : (
            <>
              <Figure size={22}>
                <Pending />
              </Figure>
              <Note>From QuickBooks, invoiced {rangeLabel(data.range)}</Note>
            </>
          )}
        </Card>

        <Card style={{ gap: 4, padding: "9px 14px" }}>
          <Eyebrow>Gross profit</Eyebrow>
          {finance?.grossProfit !== null && finance?.grossProfit !== undefined ? (
            <>
              <Figure>{money(finance.grossProfit)}</Figure>
              <Note>
                {finance.revenue
                  ? `${((finance.grossProfit / finance.revenue) * 100).toFixed(1)}% gross margin`
                  : "Gross margin needs revenue"}
              </Note>
            </>
          ) : (
            <>
              <Figure size={22}>
                <Pending />
              </Figure>
              <Note>From QuickBooks, company wide</Note>
            </>
          )}
        </Card>

        <Card style={{ gap: 4, padding: "9px 14px" }}>
          <Eyebrow>Cash collected</Eyebrow>
          {finance?.cashCollected !== null && finance?.cashCollected !== undefined ? (
            <>
              <Figure>{money(finance.cashCollected)}</Figure>
              <Note>Collections on a cash basis</Note>
            </>
          ) : (
            <>
              <Figure size={22}>
                <Pending />
              </Figure>
              <Note>From QuickBooks, cash basis</Note>
            </>
          )}
        </Card>

        <Card style={{ gap: 4, padding: "9px 14px" }}>
          <Eyebrow>Average job value</Eyebrow>
          <button
            type="button"
            onClick={() => setDrillOpen(true)}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <Figure>{jobs.averageJobValue === null ? "No jobs" : money(jobs.averageJobValue)}</Figure>
          </button>
          <Note>
            {count(jobs.jobsClosed)} jobs invoiced, open drill-down
          </Note>
          {jobs.consultations.count > 0 && (
            <Note>
              Plus {count(jobs.consultations.count)} arborist consultations worth{" "}
              {money(jobs.consultations.value)}, counted as lead generation and
              kept out of this average.
            </Note>
          )}
        </Card>

        <Card style={{ gap: 3, padding: "8px 14px" }}>
          <div className="tn-eyebrow" style={{ whiteSpace: "nowrap" }}>
            Work on the books
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <Figure>{weeks(backlog.weeks)}</Figure>
            <div
              className="tn-figure"
              style={{ fontSize: 16, fontWeight: 800, color: "var(--tn-fg-subtle)" }}
            >
              WEEKS
            </div>
          </div>
          <TargetBand
            value={backlog.weeks}
            low={backlog.targetLow}
            high={backlog.targetHigh}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              fontSize: 12,
              color: "var(--tn-sun-700)",
            }}
          >
            Target {backlog.targetLow} to {backlog.targetHigh} weeks
          </div>
          <Note>{backlogStatus}</Note>
        </Card>
      </div>

      {/* ---- service lines and pipeline */}
      <div className="tn-grid-two">
        <Card style={{ gap: 7, padding: "14px 16px" }}>
          <div
            style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}
          >
            <SectionTitle>Revenue by service line</SectionTitle>
            <span className="tn-label" style={{ color: "var(--tn-fg-link)" }}>
              All jobs
            </span>
          </div>
          {!qbLive && (
            <Note>
              Showing invoiced value from ArboStar. QuickBooks revenue and
              margin replace these figures once that connection is restored.
            </Note>
          )}

          <ServiceLineRow
            title="Production"
            subtitle="removal, trimming, stump"
            value={production.jobValue}
            share={productionShare}
            color="rgba(12,10,5,0.32)"
            backlogWeeks={production.backlogWeeks}
            jobsClosed={production.jobsClosed}
            marginAvailable={qbLive}
          />
          <Divider />
          <ServiceLineRow
            title="Plant Health Care"
            value={phc.jobValue}
            share={1 - productionShare}
            color="var(--tn-leaf-500)"
            accent
            backlogWeeks={phc.backlogWeeks}
            jobsClosed={phc.jobsClosed}
            marginAvailable={qbLive}
          />

          <Note>
            Weeks on the books read live open work orders against the invoiced
            run rate of the last twenty six weeks. Declined work and plant health
            care rounds booked for a future month are excluded, since neither is
            a queue the crew is behind on.
          </Note>
          <Note>
            {totalLineValue > 0
              ? `Plant Health Care is ${((phc.jobValue / totalLineValue) * 100).toFixed(0)}% of invoiced value this period. Gross profit by line follows once the QuickBooks classes are mapped to the two service lines.`
              : "No closed jobs in this period yet."}
          </Note>
        </Card>

        <Card style={{ gap: 10, padding: "14px 16px" }}>
          <div
            style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}
          >
            <SectionTitle>Pipeline</SectionTitle>
            <span className="tn-label" style={{ color: "var(--tn-fg-link)" }}>
              All estimates
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "10px 16px",
            }}
          >
            <Stat label="Estimates issued" value={count(pipeline.estimatesIssued)} />
            <Stat label="Value proposed" value={money(pipeline.valueProposed)} />
            <Stat label="Jobs sold" value={count(pipeline.jobsSold)} />
            <Stat label="Value sold" value={money(pipeline.valueSold)} />
          </div>

          <Divider />

          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <div className="tn-label" style={{ color: "var(--tn-leaf-700)" }}>
              Proposal value won
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
              {percent(pipeline.proposalValueWon)}
            </div>
            <div className="tn-label">Close rate</div>
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
              {percent(pipeline.closeRate)}
            </div>
          </div>
          <Note>
            Proposal value won is dollars won over dollars proposed. Close rate is
            jobs sold over estimates issued.
          </Note>

          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <RateRow
              label="Production"
              value={pipeline.proposalValueWonProduction}
              color="rgba(12,10,5,0.32)"
            />
            <RateRow
              label="Plant Health Care"
              value={pipeline.proposalValueWonPhc}
              color="var(--tn-leaf-500)"
              accent
            />
          </div>

          <Note>{money(pipeline.openValueProposed)} proposed and still open.</Note>
        </Card>
      </div>

      {/* ---- cash and obligations */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <div
            className="tn-heading"
            style={{ fontSize: 16, letterSpacing: "0.02em" }}
          >
            Cash and obligations
          </div>
          <div style={{ fontSize: 12, color: "var(--tn-fg-subtle)" }}>
            Company wide. Receivables, payroll and expenses are not split by service line.
          </div>
        </div>

        <div className="tn-grid-cash">
          <Card style={{ gap: 6 }}>
            <Eyebrow>Outstanding receivables</Eyebrow>
            {finance?.receivablesCurrent !== null && finance?.receivablesCurrent !== undefined ? (
              <AgingRows finance={finance} />
            ) : (
              <>
                <Figure size={26}>{money(data.receivables.total)}</Figure>
                <Note>
                  Across {count(data.receivables.count)} open invoices, from
                  ArboStar. The QuickBooks aging replaces this once connected.
                </Note>
              </>
            )}
          </Card>

          <Card style={{ gap: 6 }}>
            <Eyebrow>Payroll as a share of revenue</Eyebrow>
            {finance?.payroll && finance?.revenue ? (
              <>
                <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>
                  {((finance.payroll / finance.revenue) * 100).toFixed(1)}%
                </div>
                <Note>
                  {money(finance.fieldLabor)} crew wages in cost of goods sold
                  and {money(finance.overheadPayroll)} payroll in overhead.
                  {finance.subcontractorLabor
                    ? ` Subcontractors, ${money(finance.subcontractorLabor)}, are counted as job cost and left out of this ratio.`
                    : ""}
                </Note>
              </>
            ) : (
              <Pending label="Awaiting QuickBooks connection" />
            )}
          </Card>

          <Card style={{ gap: 6 }}>
            <Eyebrow>Operating expenses</Eyebrow>
            {finance?.operatingExpenses !== null && finance?.operatingExpenses !== undefined ? (
              <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>
                {money(finance.operatingExpenses)}
              </div>
            ) : (
              <Pending label="Awaiting QuickBooks connection" />
            )}
          </Card>

          <Card style={{ gap: 6 }}>
            <Eyebrow>Marketing return</Eyebrow>
            {data.marketingReturn.returnOnSpend === null ? (
              <Pending label="Awaiting this month in the leads sheet" />
            ) : (
              <>
                <Figure size={26}>{data.marketingReturn.returnOnSpend}x</Figure>
                <Note>
                  {money(data.marketingReturn.revenue)} from paid media on{" "}
                  {money(data.marketingReturn.spend)} of paid spend.
                </Note>
              </>
            )}
            <Note>
              Return on ad spend uses paid media revenue over paid spend only.
              Total tracked revenue is shown separately on the Marketing screen.
            </Note>
          </Card>
        </div>
      </div>

      <div style={{ fontSize: 12, color: "var(--tn-fg-subtle)" }}>
        Jobs and estimates from ArboStar. Cash, payroll and expenses from
        QuickBooks. Collections on a cash basis. Marketing spend and return
        come from the TreeNewal leads sheet, not from lead source at intake.
        Tap Average job value to open the job drill-down.
      </div>

      <SourceFreshness combined />

      {drillOpen && <JobDrill data={data} onClose={() => setDrillOpen(false)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div className="tn-label">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function RateRow({
  label,
  value,
  color,
  accent,
}: {
  label: string;
  value: number | null;
  color: string;
  accent?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 120, fontSize: 13, color: "var(--tn-fg-muted)" }}>{label}</div>
      <div style={{ flex: 1 }}>
        <Bar ratio={(value ?? 0) / 100} color={color} height={7} />
      </div>
      <div
        style={{
          width: 56,
          textAlign: "right",
          fontSize: 14,
          fontWeight: 700,
          color: accent ? "var(--tn-leaf-700)" : "var(--tn-fg)",
        }}
      >
        {percent(value)}
      </div>
    </div>
  );
}

function ServiceLineRow({
  title,
  subtitle,
  value,
  share,
  color,
  accent,
  backlogWeeks,
  jobsClosed,
  marginAvailable,
}: {
  title: string;
  subtitle?: string;
  value: number;
  share: number;
  color: string;
  accent?: boolean;
  backlogWeeks: number | null;
  jobsClosed: number;
  marginAvailable: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>
          {title}{" "}
          {subtitle && (
            <span style={{ fontWeight: 400, color: "var(--tn-fg-subtle)" }}>{subtitle}</span>
          )}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{money(value)}</div>
      </div>
      <Bar ratio={share} color={color} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            className="tn-label"
            style={{ color: accent ? "var(--tn-leaf-700)" : "var(--tn-fg-subtle)" }}
          >
            Margin
          </div>
          {marginAvailable ? (
            <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>Not yet mapped</div>
          ) : (
            <Pending label="Awaiting QuickBooks" />
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="tn-label">On the books</div>
          <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>
            {weeks(backlogWeeks)}{" "}
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--tn-fg-muted)" }}>
              weeks
            </span>
          </div>
        </div>
      </div>
      <Note>{count(jobsClosed)} jobs invoiced this period.</Note>
    </div>
  );
}

function AgingRows({
  finance,
}: {
  finance: {
    receivablesCurrent: number | null;
    receivables1to30: number | null;
    receivables31to60: number | null;
    receivables60plus: number | null;
  };
}) {
  const rows = [
    { label: "Current", value: finance.receivablesCurrent, accent: true },
    { label: "1 to 30 days", value: finance.receivables1to30 },
    { label: "31 to 60 days", value: finance.receivables31to60 },
    { label: "60 plus days", value: finance.receivables60plus, warn: true },
  ];
  const total = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{money(total)}</div>
      {rows.map(row => (
        <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 96, fontSize: 13, color: "var(--tn-fg-muted)" }}>
            {row.label}
          </div>
          <div style={{ flex: 1 }}>
            <Bar
              ratio={total > 0 ? (row.value ?? 0) / total : 0}
              height={10}
              color={
                row.warn
                  ? "var(--tn-sun-500)"
                  : row.accent
                    ? "var(--tn-leaf-500)"
                    : "rgba(12,10,5,0.32)"
              }
            />
          </div>
          <div style={{ width: 84, textAlign: "right", fontSize: 14, fontWeight: 700 }}>
            {money(row.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

function JobDrill({
  data,
  onClose,
}: {
  data: any;
  onClose: () => void;
}) {
  const jobs = data.jobSet;
  return (
    <div
      style={{
        position: "fixed",
        zIndex: 30,
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(640px, 100vw)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--tn-bg-elevated)",
        borderLeft: "1px solid var(--tn-border)",
        boxShadow: "var(--tn-shadow-lg)",
      }}
    >
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 20,
          padding: "18px 24px 14px 24px",
          borderBottom: "1px solid var(--tn-border)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Eyebrow>Average job value</Eyebrow>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <div className="tn-figure" style={{ fontSize: 32 }}>
              {jobs.averageJobValue === null ? "No jobs" : money(jobs.averageJobValue)}
            </div>
            <div style={{ fontSize: 13, color: "var(--tn-fg-muted)" }}>
              across {count(jobs.jobsClosed)} jobs invoiced, {rangeLabel(data.range)}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            flex: "0 0 auto",
            padding: 0,
            background: "transparent",
            border: "1px solid var(--tn-border)",
            borderRadius: 999,
            color: "var(--tn-bark-500)",
            cursor: "pointer",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          padding: "16px 24px 20px 24px",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
          <Stat label="Median job" value={money(jobs.medianJobValue)} />
          <Stat label="Largest job" value={money(jobs.largestJobValue)} />
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div className="tn-label" style={{ paddingBottom: 8 }}>
            Most recent first
          </div>
          <div
            className="tn-label"
            style={{
              display: "grid",
              gridTemplateColumns: "64px 1fr 1fr 92px",
              gap: 12,
              paddingBottom: 6,
            }}
          >
            <div>Date</div>
            <div>Location</div>
            <div>Service line</div>
            <div style={{ textAlign: "right" }}>Value</div>
          </div>
          {jobs.recent.map(
            (
              job: { date: string; city: string; serviceLine: string | null; value: number },
              index: number,
            ) => (
              <div
                key={`${job.date}-${index}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "64px 1fr 1fr 92px",
                  gap: 12,
                  alignItems: "center",
                  padding: "9px 0",
                  borderTop: "1px solid var(--tn-border)",
                  fontSize: 13,
                }}
              >
                <div style={{ color: "var(--tn-fg-muted)" }}>{shortDate(job.date)}</div>
                <div style={{ color: "var(--tn-fg-muted)" }}>{job.city || "Not recorded"}</div>
                <div style={{ fontWeight: 600 }}>{lineName(job.serviceLine)}</div>
                <div style={{ textAlign: "right", fontWeight: 700 }}>{money(job.value)}</div>
              </div>
            ),
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: 12,
              fontSize: 12,
              color: "var(--tn-fg-subtle)",
            }}
          >
            <span>
              {Math.min(12, jobs.jobsClosed)} of {count(jobs.jobsClosed)} jobs
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
