/**
 * TreeNewal runs one crew pool and one profit and loss. The only split the
 * business makes is by service line: production work and plant health care.
 * Nothing here splits by city.
 *
 * ArboStar tags line items with a class that matches the QuickBooks class
 * list one for one (Production 900000000000826473, Plant Health
 * 900000000000826474, and so on), so the same rule holds on both sides.
 */
export type ServiceLine = "production" | "phc";

const PHC_CLASSES = ["plant health", "turf & shrub", "turf and shrub"];

/** Classes that are overhead, not delivered work. Ignored when classifying. */
const NON_WORK_CLASSES = ["admin", "sales & marketing", "no category", ""];

export function lineFromClassName(name: string | undefined): ServiceLine | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  if (NON_WORK_CLASSES.includes(n)) return undefined;
  if (PHC_CLASSES.some(c => n.includes(c))) return "phc";
  return "production";
}

/** Pick the line for a record from all of its line item classes. */
export function lineFromClassNames(names: (string | undefined)[]): ServiceLine | undefined {
  let sawProduction = false;
  let sawPhc = false;
  for (const name of names) {
    const line = lineFromClassName(name);
    if (line === "phc") sawPhc = true;
    if (line === "production") sawProduction = true;
  }
  // Production work carries the crew day, so a mixed job counts as production.
  if (sawProduction) return "production";
  if (sawPhc) return "phc";
  return undefined;
}

/** Fallback for work orders, whose status names carry the line explicitly. */
export function lineFromStatusName(status: string | undefined): ServiceLine | undefined {
  if (!status) return undefined;
  const s = status.toLowerCase();
  if (s.includes("phc") || s.includes("plant health")) return "phc";
  if (s.includes("production") || s.includes("stump") || s.includes("planting")) {
    return "production";
  }
  return undefined;
}

export function isFinishedStatus(status: string | undefined): boolean {
  if (!status) return false;
  return status.trim().toLowerCase() === "finished";
}

/**
 * A record whose line items are all overhead classes, with at least one
 * tagged Sales & Marketing, is an arborist consultation: lead generation
 * rather than delivered work. Those are kept out of average job value.
 */
export function isConsultation(names: (string | undefined)[]): boolean {
  if (lineFromClassNames(names) !== undefined) return false;
  return names.some(name => (name ?? "").trim().toLowerCase() === "sales & marketing");
}

/**
 * Open work that is neither dead nor parked. ArboStar parks next year's
 * plant health care rounds in statuses named for their month, which is
 * scheduled future work rather than a queue the crew is behind on.
 */
export function isDeadStatus(status: string | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s.includes("declined") || s.includes("cancel") || s.includes("lost") || s.includes("void");
}

const MONTH_NAMES = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sept", "sep", "oct", "nov", "dec",
];

export function isFutureDatedStatus(status: string | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  if (!/20\d\d/.test(s)) return false;
  return MONTH_NAMES.some(month => s.includes(month));
}

/** Work orders that count as backlog: live, unfinished, not parked ahead. */
export function isBacklogStatus(status: string | undefined): boolean {
  return !isDeadStatus(status) && !isFutureDatedStatus(status);
}

/**
 * ArboStar catalogue names carry a leading section code, for example
 * "6.13 Tree Pruning". The code is a catalogue address, not a service type,
 * so it is stripped for reporting.
 */
export function serviceTypeName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const name = raw.replace(/^[\d.]+\s*/, "").trim();
  if (name.length === 0) return undefined;
  return name;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Plant Health Care work orders are parked in a status that names the
 * treatment month, for example "PHC Sept 2026". That status is the only
 * scheduled date ArboStar exposes, so it is read as one.
 */
export function scheduledMonthFromStatus(status: string | undefined): string | undefined {
  if (!status) return undefined;
  const match = status.toLowerCase().match(/([a-z]{3})[a-z]*\.?\s+(20\d{2})/);
  if (!match) return undefined;
  const month = MONTHS[match[1]];
  if (!month) return undefined;
  return `${match[2]}-${String(month).padStart(2, "0")}`;
}

/**
 * Delivered value by service type for one invoice.
 *
 * ArboStar bills large jobs in parts, and a part invoice still carries the
 * whole job's line items, so raw line amounts overstate what was billed.
 * The lines are therefore scaled to the invoice value, which makes the job
 * mix add up to the closed job value by construction.
 */
export function deliveredTypes(invoice: {
  valueExTax: number;
  serviceTypes?: { name: string; line?: "production" | "phc"; amount: number }[];
}): { name: string; line?: "production" | "phc"; amount: number }[] {
  const lines = invoice.serviceTypes ?? [];
  if (lines.length === 0) return [];
  const lineSum = lines.reduce((total, line) => total + line.amount, 0);
  if (lineSum <= 0) return [];
  const scale = invoice.valueExTax / lineSum;
  return lines.map(line => ({ ...line, amount: line.amount * scale }));
}
