/**
 * Money is stored as whole minor units (for example cents) plus a three-letter currency.
 * Totals are kept per currency; nothing is converted unless the company turns that on.
 */
export interface Money {
  amountMinor: number;
  currency: string;
}

/** Most currencies have 2 decimals; a few have 0 or 3. */
export function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function formatMoney(m: Money, locale = 'en-GB'): string {
  const digits = minorDigits(m.currency);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency, currencyDisplay: 'code', maximumFractionDigits: digits }).format(
      m.amountMinor / 10 ** digits,
    );
  } catch {
    return `${m.currency} ${(m.amountMinor / 10 ** digits).toFixed(digits)}`;
  }
}

/** Adds amounts per currency. Returns one entry per currency, largest first. */
export function totalsByCurrency(items: Money[]): Money[] {
  const map = new Map<string, number>();
  for (const i of items) map.set(i.currency, (map.get(i.currency) ?? 0) + i.amountMinor);
  return [...map.entries()].map(([currency, amountMinor]) => ({ currency, amountMinor })).sort((a, b) => b.amountMinor - a.amountMinor);
}
