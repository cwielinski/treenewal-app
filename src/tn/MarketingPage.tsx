import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  AttentionBar,
  Bar,
  Card,
  Eyebrow,
  Figure,
  Note,
  SectionTitle,
} from "./components";
import { useDashboardState } from "./dashboardState";
import { count, money, monthLabel, percent } from "./format";

/**
 * Marketing.
 *
 * Attribution follows the lead source recorded at intake, first contact
 * rather than every touch, and the footnote says so on screen. Spend and
 * every cost ratio need Google Ads and read as pending until it is
 * connected. Total tracked revenue is shown on its own and is never
 * divided by ad spend.
 */

function FunnelStep({
  label,
  value,
  ratio,
}: {
  label: string;
  value: number;
  ratio: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <Figure size={26}>{count(value)}</Figure>
        <Note>{label}</Note>
      </div>
      <Bar ratio={ratio} color="var(--tn-leaf-500)" height={10} />
    </div>
  );
}

export function MarketingPage() {
  const { period, line } = useDashboardState();
  const data = useQuery(api.marketingScreen.marketing, { period, line });

  if (data === undefined) {
    return (
      <div style={{ padding: 24 }}>
        <Note>Loading marketing.</Note>
      </div>
    );
  }

  const funnel = data.funnel;
  const widest = Math.max(1, funnel.leads, funnel.estimates, funnel.sold);
  const maxTrend = Math.max(1, ...data.trend.map((point: any) => point.revenue));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 20 }}>
      <Note>
        Spend, leads, sales and every cost ratio come from the TreeNewal leads
        sheet. Job counts and revenue come from ArboStar and the invoice
        record. Lead source as recorded at intake is not shown, because
        customers often do not know how they found the company and the field
        does not agree with call tracking.
      </Note>

      {data.spend.missingMonths.length > 0 && (
        <AttentionBar>
          The leads sheet has no figures yet for{" "}
          {data.spend.missingMonths.map(monthLabel).join(", ")}, so spend and the
          cost ratios below cover only the months that are filled in.
        </AttentionBar>
      )}

      <div className="tn-grid-cash">
        <Card>
          <Eyebrow>Spend</Eyebrow>
          <Figure size={30}>{money(data.spend.total.cost)}</Figure>
          <Note>
            Paid Ads {money(data.spend.paid.cost)} and SEO {money(data.spend.seo.cost)}
          </Note>
        </Card>
        <Card>
          <Eyebrow>Cost per lead</Eyebrow>
          <Figure size={30}>{money(data.spend.total.costPerLead)}</Figure>
          <Note>
            {count(data.spend.total.leads)} leads recorded in the sheet
          </Note>
        </Card>
        <Card>
          <Eyebrow>Cost per sale</Eyebrow>
          <Figure size={30}>{money(data.spend.total.costPerSale)}</Figure>
          <Note>Spend over jobs sold from paid sources</Note>
        </Card>
        <Card>
          <Eyebrow>Return on spend</Eyebrow>
          <Figure size={30}>
            {data.spend.paid.returnOnSpend === null
              ? "No data"
              : `${data.spend.paid.returnOnSpend}x`}
          </Figure>
          <Note>Paid media revenue divided by paid spend</Note>
        </Card>
      </div>

      <div className="tn-grid-two">
        <Card style={{ gap: 10 }}>
          <SectionTitle>Paid Ads</SectionTitle>
          <Note>Google Ads and Local Services Ads combined, from the leads sheet.</Note>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
            <div>
              <Figure size={24}>{money(data.spend.paid.cost)}</Figure>
              <Note>Spend</Note>
            </div>
            <div>
              <Figure size={24}>{count(data.spend.paid.leads)}</Figure>
              <Note>Leads</Note>
            </div>
            <div>
              <Figure size={24}>{count(data.spend.paid.sales)}</Figure>
              <Note>Sold</Note>
            </div>
            <div>
              <Figure size={24}>{money(data.spend.paid.costPerLead)}</Figure>
              <Note>Cost per lead</Note>
            </div>
            <div>
              <Figure size={24}>{money(data.spend.paid.costPerSale)}</Figure>
              <Note>Cost per sale</Note>
            </div>
            <div>
              <Figure size={24}>{money(data.spend.paid.revenue)}</Figure>
              <Note>Revenue from paid media</Note>
            </div>
          </div>
        </Card>

        <Card style={{ gap: 10 }}>
          <SectionTitle>SEO</SectionTitle>
          <Note>Carries a cost of its own, so it is read the same way.</Note>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
            <div>
              <Figure size={24}>{money(data.spend.seo.cost)}</Figure>
              <Note>Spend</Note>
            </div>
            <div>
              <Figure size={24}>{count(data.spend.seo.leads)}</Figure>
              <Note>Leads</Note>
            </div>
            <div>
              <Figure size={24}>{count(data.spend.seo.sales)}</Figure>
              <Note>Sold</Note>
            </div>
            <div>
              <Figure size={24}>{money(data.spend.seo.costPerLead)}</Figure>
              <Note>Cost per lead</Note>
            </div>
            <div>
              <Figure size={24}>{money(data.spend.seo.costPerSale)}</Figure>
              <Note>Cost per sale</Note>
            </div>
            <div>
              <Figure size={24}>
                {data.spend.seo.returnOnSpend === null
                  ? "No data"
                  : `${data.spend.seo.returnOnSpend}x`}
              </Figure>
              <Note>Return on spend</Note>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <Eyebrow>Total tracked revenue</Eyebrow>
        <Figure size={30}>{money(data.totalRevenue)}</Figure>
        <Note>
          All sources, closed this period, from invoices. Shown on its own and never
          divided by ad spend.
        </Note>
      </Card>

      <div className="tn-grid-two">
        <Card style={{ gap: 14 }}>
          <SectionTitle>Funnel</SectionTitle>
          <FunnelStep label="Leads" value={funnel.leads} ratio={funnel.leads / widest} />
          <Note>Lead to estimate {percent(funnel.leadToEstimate, 1)}</Note>
          <FunnelStep
            label="Estimates"
            value={funnel.estimates}
            ratio={funnel.estimates / widest}
          />
          <Note>Close rate {percent(funnel.closeRate, 1)}</Note>
          <FunnelStep
            label="Sold jobs"
            value={funnel.sold}
            ratio={funnel.sold / widest}
          />
          <Note>
            Lead to sale rate {percent(funnel.leadToSale, 1)}. Blended average job
            value {money(data.averageJobValue.blended)} across{" "}
            {count(data.averageJobValue.jobs)} closed jobs.
          </Note>
          <Note>
            Close rate is jobs sold over estimates issued. Proposal value won, which
            is dollars won over dollars proposed, sits on the Jobs screen.
          </Note>
        </Card>

        <Card style={{ gap: 10 }}>
          <SectionTitle>Average job value</SectionTitle>
          <Figure size={30}>{money(data.averageJobValue.blended)}</Figure>
          <Note>
            Across {count(data.averageJobValue.jobs)} jobs closed in the period.
            The same job set as the Jobs screen and the map.
          </Note>
        </Card>
      </div>

      <Card style={{ gap: 10 }}>
        <SectionTitle>Trailing twelve months</SectionTitle>
        <Note>All revenue closed, by month.</Note>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 120 }}>
          {data.trend.map((point: any) => (
            <div
              key={point.month}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: `${Math.max(2, (point.revenue / maxTrend) * 92)}px`,
                  background: "var(--tn-leaf-500)",
                  borderRadius: 4,
                }}
              />
              <div style={{ fontSize: 12, color: "var(--tn-fg-subtle)" }}>
                {monthLabel(point.month).slice(0, 3)}
              </div>
            </div>
          ))}
        </div>
        <Note>
          {monthLabel(data.trend[0].month)} · {money(data.trend[0].revenue)} ·{" "}
          {monthLabel(data.trend[data.trend.length - 1].month)} ·{" "}
          {money(data.trend[data.trend.length - 1].revenue)}
        </Note>
      </Card>

      <Note>
        Spend, cost per lead and cost per sale come from the TreeNewal leads
        sheet, which is monthly, so period figures cover whole months. The
        funnel counts and revenue come from ArboStar and the invoice record,{" "}
        {count(data.leadsSynced)} leads mirrored.
      </Note>
    </div>
  );
}
