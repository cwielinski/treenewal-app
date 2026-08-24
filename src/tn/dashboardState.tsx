import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * The period selector and the service line filter drive every figure on
 * every screen, so they live above the screens and persist between visits.
 */
export const PERIODS = [
  { key: "mtd", label: "Month to date" },
  { key: "last_month", label: "Last month" },
  { key: "qtd", label: "Quarter to date" },
  { key: "ytd", label: "Year to date" },
  { key: "ttm", label: "Trailing twelve months" },
] as const;

export type PeriodKey = (typeof PERIODS)[number]["key"];

export const LINES = [
  { key: "all", label: "All work" },
  { key: "production", label: "Production" },
  { key: "phc", label: "Plant Health Care" },
] as const;

export type LineKey = (typeof LINES)[number]["key"];

type DashboardState = {
  period: PeriodKey;
  line: LineKey;
  setPeriod: (period: PeriodKey) => void;
  setLine: (line: LineKey) => void;
};

const STORAGE_KEY = "tn-dashboard-controls";

const DashboardContext = createContext<DashboardState | null>(null);

function readStored(): { period?: PeriodKey; line?: LineKey } {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function DashboardStateProvider({ children }: { children: ReactNode }) {
  const stored = useMemo(readStored, []);
  const [period, setPeriod] = useState<PeriodKey>(stored.period ?? "mtd");
  const [line, setLine] = useState<LineKey>(stored.line ?? "all");

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ period, line }));
    } catch {
      // A blocked storage write must never break the dashboard.
    }
  }, [period, line]);

  const value = useMemo(
    () => ({ period, line, setPeriod, setLine }),
    [period, line],
  );

  return (
    <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
  );
}

export function useDashboardState(): DashboardState {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("useDashboardState used outside its provider");
  return value;
}

export function periodLabel(key: PeriodKey): string {
  return PERIODS.find(period => period.key === key)?.label ?? "";
}
