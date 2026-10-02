export type ReservationsRequest = {
  month: string;
};

/**
 * Why a category has no reservation breakdown. When several apply, the first
 * one in this list is reported.
 */
export type ReservationUnavailableReason =
  | 'invalid-template'
  | 'missing-schedule'
  | 'ambiguous-schedule'
  | 'inactive-schedule'
  | 'duplicate-schedule'
  | 'unsupported-template';

export type ReservationClaim = {
  /** Schedule ID for schedule claims, `<categoryId>:<templateIndex>` for By claims. */
  key: string;
  kind: 'schedule' | 'by';
  label: string;
  /** `YYYY-MM-DD` */
  nextDate: string;
  /** Full amount of the cost, in minor units. */
  target: number;
  /** Display-rounded accrued amount, in minor units. */
  accrued: number;
};

export type ReadyReservationRow = {
  categoryId: string;
  state: 'ready';
  balance: number;
  reserved: number;
  allowance: number;
  allowanceTotal: number;
  spare: number;
  shortfall: number;
  claims: ReservationClaim[];
};

export type UnavailableReservationRow = {
  categoryId: string;
  state: 'unavailable';
  reason: ReservationUnavailableReason;
};

export type ReservationRow = ReadyReservationRow | UnavailableReservationRow;

export type ReservationsResult = {
  month: string;
  categories: ReservationRow[];
};
