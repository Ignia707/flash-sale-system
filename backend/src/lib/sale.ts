// The sale window: before startsAt nobody may buy. No startsAt means always open.

export interface Sale {
  startsAt?: Date;
  now: () => number; // replaceable clock, so tests don't have to wait
}

export const hasStarted = (sale: Sale): boolean =>
  !sale.startsAt || sale.now() >= sale.startsAt.getTime();
