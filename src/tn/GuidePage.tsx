import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { Card, Divider, Eyebrow, Note, SectionTitle } from "./components";

/**
 * How these figures are calculated.
 *
 * Every number on every screen, what it is made of, which source it comes
 * from and which of the three header controls change it. Written in plain
 * language so it can be read without knowing the data model.
 */

type Row = {
  figure: string;
  source: "ArboStar" | "QuickBooks" | "Leads sheet" | "ArboStar and QuickBooks";
  made: ReactNode;
  controls: string;
};

const SOURCE_NOTE: Record<string, string> = {
  ArboStar: "ArboStar, the job software",
  QuickBooks: "QuickBooks",
  "Leads sheet": "the marketing leads spreadsheet",
  "ArboStar and QuickBooks": "ArboStar and QuickBooks together",
};

function Table({ rows }: { rows: Row[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map((row, index) => (
        <div key={row.figure}>
          {index > 0 && <Divider />}
          <div
            className="tn-guide-row"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 1fr 150px",
              gap: 16,
              padding: "12px 0",
              alignItems: "start",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--tn-fg)" }}>
              {row.figure}
            </div>
            <div style={{ fontSize: 14, color: "var(--tn-fg)", lineHeight: 1.5 }}>
              {row.made}
              <div style={{ marginTop: 4, fontSize: 12, color: "var(--tn-fg-muted)" }}>
                Source: {SOURCE_NOTE[row.source]}
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--tn-fg-muted)", lineHeight: 1.5 }}>
              {row.controls}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Screen({ title, intro, rows }: { title: string; intro: string; rows: Row[] }) {
  return (
    <Card style={{ gap: 10, padding: "16px 20px" }}>
      <SectionTitle>{title}</SectionTitle>
      <Note>{intro}</Note>
      <div style={{ height: 4 }} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "200px 1fr 150px",
          gap: 16,
          paddingBottom: 6,
        }}
        className="tn-guide-row"
      >
        <Eyebrow>Figure</Eyebrow>
        <Eyebrow>What it is made of</Eyebrow>
        <Eyebrow>Changed by</Eyebrow>
      </div>
      <Table rows={rows} />
    </Card>
  );
}

const ALL_THREE = "Period, service line, government";
const PERIOD_LINE = "Period, service line";

export function GuidePage() {
  const sources = useQuery(api.metrics.sourceStatus, {});
  const quickbooks = sources?.find(source => source.source === "quickbooks");
  const qbLive = quickbooks?.status === "ok";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 20 }}>
      <Card style={{ gap: 10, padding: "16px 20px" }}>
        <SectionTitle>How these figures are calculated</SectionTitle>
        <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--tn-fg)" }}>
          <p style={{ margin: "0 0 10px" }}>
            Every screen reads from one copy of the data held inside this app,
            refreshed at 5am and 6pm Central and whenever anyone presses the
            refresh button in the header. Nothing is calculated live against
            ArboStar or QuickBooks while you are looking at it, so the figures do
            not move under you mid read. The time in the header is when that copy
            was last filled.
          </p>
          <p style={{ margin: "0 0 10px" }}>
            Three controls in the header change what is counted, and they apply to
            every figure on the screen you are on. <strong>Period</strong> sets the
            date window. <strong>Service line</strong> limits to production or plant
            health care work. <strong>Government</strong> includes, excludes, or shows
            only government customers.
          </p>
          <p style={{ margin: 0 }}>
            TreeNewal is read as one business with one crew pool and one profit and
            loss. Cities are never used to split revenue, margin, payroll or
            capacity. They appear only as a demand view, in the list of where work
            is coming from and on the map.
          </p>
        </div>
      </Card>

      <Card style={{ gap: 10, padding: "16px 20px" }}>
        <SectionTitle>Four rules that decide what counts</SectionTitle>
        <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--tn-fg)" }}>
          <p style={{ margin: "0 0 10px" }}>
            <strong>A job counts on its invoice date.</strong> Not when it was sold,
            not when the crew finished. The invoice date is what QuickBooks bills on,
            so revenue here and revenue there land in the same month.
          </p>
          <p style={{ margin: "0 0 10px" }}>
            <strong>Arborist consultations are reported separately.</strong> They are
            lead generation rather than delivered work, so leaving them inside average
            job value would drag it down. They are counted and shown on their own.
          </p>
          <p style={{ margin: "0 0 10px" }}>
            <strong>Customer type comes from the client record in ArboStar</strong>,
            which marks each customer residential, commercial or government. One
            caveat worth knowing: government work billed through a general contractor
            is recorded against the contractor, so it reads as commercial.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Open estimates drop off after 180 days</strong> for everyone except
            government, where an award can legitimately sit for two years. Nothing is
            deleted, it just stops counting as open pipeline.
          </p>
        </div>
      </Card>

      <Card style={{ gap: 10, padding: "16px 20px" }}>
        <SectionTitle>Two rates people mix up</SectionTitle>
        <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--tn-fg)" }}>
          <p style={{ margin: "0 0 10px" }}>
            <strong>Proposal value won</strong> is dollars won divided by dollars
            proposed. It answers how much of what you quoted turned into work.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Close rate</strong> is jobs sold divided by estimates issued. It
            answers how often you win, regardless of size. The two move differently
            when big jobs go one way and small jobs go the other, so they never share
            a label anywhere on the dashboard.
          </p>
        </div>
      </Card>

      <Screen
        title="Overview"
        intro="The state of the business in one screen."
        rows={[
          {
            figure: "Revenue closed",
            source: "ArboStar",
            made: "Invoices dated inside the period, before tax, consultations excluded.",
            controls: ALL_THREE,
          },
          {
            figure: "Average job value",
            source: "ArboStar",
            made: "Revenue closed divided by the number of those invoices. This is the same job set the city rows and the map read, so all three reconcile.",
            controls: ALL_THREE,
          },
          {
            figure: "Proposal value won",
            source: "ArboStar",
            made: "Dollars on sold estimates divided by dollars on all estimates issued in the period.",
            controls: PERIOD_LINE,
          },
          {
            figure: "Close rate",
            source: "ArboStar",
            made: "Estimates sold divided by estimates issued in the period. Counts, not dollars.",
            controls: PERIOD_LINE,
          },
          {
            figure: "Backlog in weeks",
            source: "ArboStar",
            made: "Scheduled and sold work not yet invoiced, divided by the recent weekly run rate. Shown against the 2.5 to 3 week target band.",
            controls: "Service line, government",
          },
          {
            figure: "Gross margin",
            source: "QuickBooks",
            made: "The gross profit line QuickBooks publishes on the profit and loss, which is revenue less cost of goods sold, divided by revenue. Read from the report rather than recomputed, so it matches what the accountant sees.",
            controls: PERIOD_LINE,
          },
          {
            figure: "Where the work is coming from",
            source: "ArboStar",
            made: "The same closed invoices grouped by the city on the job address. A demand view only. It is never used to split margin or capacity.",
            controls: ALL_THREE,
          },
        ]}
      />

      <Screen
        title="Jobs and backlog"
        intro="What is sold, what is scheduled and what is still open."
        rows={[
          {
            figure: "Backlog in weeks",
            source: "ArboStar",
            made: "Sold work not yet invoiced, divided by the weekly run rate, which is revenue closed over the recent trailing weeks. Above the band means work is waiting, below means the crews will run out.",
            controls: "Service line, government",
          },
          {
            figure: "Open estimates",
            source: "ArboStar",
            made: "Estimates issued, not sold, not lost, and less than 180 days old. Government estimates have no age cutoff.",
            controls: ALL_THREE,
          },
          {
            figure: "Jobs closed",
            source: "ArboStar",
            made: "Count of invoices dated in the period, consultations excluded.",
            controls: ALL_THREE,
          },
          {
            figure: "Who the work is for",
            source: "ArboStar",
            made: "The same closed jobs split residential, commercial and government by the customer record.",
            controls: ALL_THREE,
          },
          {
            figure: "Arborist consultations",
            source: "ArboStar",
            made: "Counted on their own, and kept out of average job value and jobs closed.",
            controls: ALL_THREE,
          },
        ]}
      />

      <Screen
        title="Job map"
        intro="Where the work physically is. A demand view, not a financial breakout."
        rows={[
          {
            figure: "Pins",
            source: "ArboStar",
            made: "One pin per closed job in the period, placed on the job address. Colour is the service line, and the legend also splits residential, commercial and government.",
            controls: ALL_THREE,
          },
          {
            figure: "Inside and outside the service area",
            source: "ArboStar",
            made: "The same job set as the pins, split by whether the address falls inside the marketing service area. The totals match the Jobs screen exactly.",
            controls: ALL_THREE,
          },
        ]}
      />

      <Screen
        title="Cash"
        intro="Money in, money out and who owes you. Receivables come from invoices and are live. The rest waits on QuickBooks."
        rows={[
          {
            figure: "Receivables",
            source: "ArboStar",
            made: "Every invoice with a balance still owing, aged from its invoice date. A long tail of small balances is normal and is why the headline can look worse than it is.",
            controls: "Government",
          },
          {
            figure: "Average days to payment",
            source: "ArboStar",
            made: "For settled invoices, the days between invoice date and payment, averaged by month.",
            controls: "Government",
          },
          {
            figure: "Cash on hand",
            source: "QuickBooks",
            made: "The bank balance QuickBooks holds, not the book balance.",
            controls: "None",
          },
          {
            figure: "Payroll",
            source: "QuickBooks",
            made: "Crew wages inside cost of goods sold plus payroll in overhead. Subcontractors are labor but not employees, so they count as job cost and stay out of the payroll ratio. Owner guaranteed payments are not in it either.",
            controls: "Period",
          },
          {
            figure: "Operating expenses and debt service",
            source: "QuickBooks",
            made: "Total expenses below the gross profit line, and interest and loan costs within them, as classed in QuickBooks.",
            controls: "Period",
          },
        ]}
      />

      <Screen
        title="Marketing"
        intro="Spend comes from the leads spreadsheet. Volume comes from ArboStar. Channel attribution is deliberately not shown."
        rows={[
          {
            figure: "Spend, cost per lead, cost per sale",
            source: "Leads sheet",
            made: "Read straight from the spreadsheet, month by month. A blank month is excluded whole rather than counted as zero, so an unfilled month reads as not available rather than as free.",
            controls: "Period",
          },
          {
            figure: "Return on ad spend",
            source: "Leads sheet",
            made: "Paid media revenue divided by paid media spend. Only paid. Organic and referral work is never counted in it.",
            controls: "Period",
          },
          {
            figure: "Funnel counts",
            source: "ArboStar",
            made: "Leads, estimates issued, jobs sold and the two rates between them. Volume, not attribution, so it does not depend on anyone remembering how they found you.",
            controls: PERIOD_LINE,
          },
          {
            figure: "Channel attribution",
            source: "ArboStar",
            made: "Not shown. The source field in ArboStar is whatever the customer says when they call, it does not agree with the call tracking, and a wrong number that looks authoritative is worse than no number. Getting it back properly means tracking the click rather than asking the customer.",
            controls: "Not shown",
          },
        ]}
      />

      <Card style={{ gap: 10, padding: "16px 20px" }}>
        <SectionTitle>When a figure says not available</SectionTitle>
        <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--tn-fg)" }}>
          <p style={{ margin: "0 0 10px" }}>
            Nothing here is estimated to fill a gap. If the underlying data is
            missing the screen says so rather than showing a plausible number.
          </p>
          <p style={{ margin: "0 0 10px" }}>
            <strong>Awaiting QuickBooks</strong> means that figure needs the
            QuickBooks connection, which is currently{" "}
            {qbLive ? "connected" : "not connected"}.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Not available</strong> means the period has no data to compute
            it from, most often a month not yet filled in the leads spreadsheet.
          </p>
        </div>
      </Card>
    </div>
  );
}
