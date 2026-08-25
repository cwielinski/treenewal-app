import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * The freshness guard.
 *
 * Any figure that mixes QuickBooks with ArboStar is only as current as the
 * older of the two, so the as of date is stated rather than implied. Nobody
 * should plan off a half updated week without being told it is one.
 */

function stamp(timestamp: number | null | undefined): string | null {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}

export function useSourceFreshness() {
  const sources = useQuery(api.metrics.sourceStatus, {});
  if (!sources) return null;
  const find = (name: string) => sources.find(source => source.source === name) ?? null;
  const arbostar = find("arbostar");
  const quickbooks = find("quickbooks");
  const qbLive = quickbooks?.status === "ok";
  const arboAt = arbostar?.lastSuccessAt ?? null;
  const qbAt = quickbooks?.lastSuccessAt ?? null;
  // A combined figure can only be as current as the older of the two.
  const combinedAt =
    qbLive && arboAt !== null && qbAt !== null ? Math.min(arboAt, qbAt) : qbAt;
  return { arbostar, quickbooks, qbLive, arboAt, qbAt, combinedAt };
}

/**
 * The as of line. Rendered under any group of figures that draws on
 * QuickBooks, alone or combined with ArboStar.
 */
export function SourceFreshness({ combined = false }: { combined?: boolean }) {
  const freshness = useSourceFreshness();
  if (!freshness) return null;

  const { qbLive, arboAt, qbAt, combinedAt } = freshness;
  const arboStamp = stamp(arboAt);
  const qbStamp = stamp(qbAt);

  if (!qbLive) {
    return (
      <div style={{ fontSize: 12, color: "var(--tn-fg-muted)" }}>
        Jobs data as of {arboStamp ?? "not yet loaded"}. QuickBooks is not
        connected, so anything that needs it is marked rather than estimated.
      </div>
    );
  }

  const behind = arboAt !== null && qbAt !== null && qbAt < arboAt;

  return (
    <div style={{ fontSize: 12, color: "var(--tn-fg-muted)" }}>
      Jobs data as of {arboStamp ?? "not yet loaded"}. QuickBooks as of{" "}
      {qbStamp ?? "not yet loaded"}.
      {combined && behind
        ? ` Figures that combine the two hold to ${stamp(combinedAt)}, the older of the pair, so a part updated week is never read as a whole one.`
        : ""}
    </div>
  );
}
