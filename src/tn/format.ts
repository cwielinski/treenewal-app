/** Number and date formatting. Plain and calm, matching the mockups. */

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Not available";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function moneyShort(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Not available";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Not available";
  return value.toLocaleString("en-US");
}

export function percent(value: number | null | undefined, places = 1): string {
  if (value === null || value === undefined) return "Not available";
  return `${value.toFixed(places)}%`;
}

export function weeks(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Not available";
  return value.toFixed(1);
}

export function shortDate(iso: string): string {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function rangeLabel(range: { start: string; end: string }): string {
  return `${shortDate(range.start)} to ${shortDate(range.end)}`;
}

export function clockTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "not yet";
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}

export function lineName(line: string | null | undefined): string {
  if (line === "phc") return "Plant Health Care";
  if (line === "production") return "Production";
  return "Not classified";
}

/** "2026-09" reads as "Sep 2026". */
export function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${names[Number(m) - 1] ?? month} ${year}`;
}
