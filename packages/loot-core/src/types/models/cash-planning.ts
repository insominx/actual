// All monetary values use the ledger's integer amount units. Rates retain fractions.
export type CashPlanningRequest = { startDate: string; endDate: string };

export type CashPlanningConfig = CashPlanningRequest & {
  categoryTargets: Record<string, number>;
  goal?: { balance: number; deadline?: string };
  forecastEndDate?: string;
};

export type CashPlanningCategory = {
  id: string;
  name: string | null;
  available: boolean;
  outflow: number;
  monthlyOutflow: number;
};

export type CashPlanningSummary = CashPlanningRequest & {
  asOf: string;
  balance: number;
  accounts: { id: string; name: string; closed: boolean; balance: number }[];
  months: number;
  transactionCount: number;
  income: number;
  outflow: number;
  externalMovement: number;
  monthlyIncome: number;
  monthlyOutflow: number;
  monthlyExternalMovement: number;
  categories: CashPlanningCategory[];
};

export type CashPlanningProjection = {
  monthlyOutflow: number;
  monthlySurplus: number;
  remaining: number | null;
  goalState: 'none' | 'reached' | 'reachable' | 'unreachable';
  completionDate: string | null;
  depletionDate: string | null;
  deadline: {
    requiredSurplus: number | null;
    maximumOutflow: number | null;
    surplusGap: number | null;
    balanceGap: number;
  } | null;
};
