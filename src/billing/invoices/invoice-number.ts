// Invoice numbering (ADR §8.3): a gap-free sequence per series.
//   India:  HS/IN/2026-27/000123, reset every 1 April (Indian financial year, IST)
//   Global: HS/GL/2026/000123, per calendar year (UTC)

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Indian financial year of a moment, in IST: '2026-27' runs 1 Apr 2026 – 31 Mar 2027. */
export function indianFinancialYear(at: Date): string {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? year : year - 1; // April = month 3
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export interface InvoiceSeries {
  series: 'IN' | 'GL';
  period: string; // '2026-27' or '2026'
  financialYear: string | null; // India only
  counterId: string; // BillingCounter _id, e.g. 'INV/IN/2026-27'
}

export function invoiceSeries(
  region: 'IN' | 'GLOBAL',
  at: Date,
): InvoiceSeries {
  if (region === 'IN') {
    const fy = indianFinancialYear(at);
    return {
      series: 'IN',
      period: fy,
      financialYear: fy,
      counterId: `INV/IN/${fy}`,
    };
  }
  const year = String(at.getUTCFullYear());
  return {
    series: 'GL',
    period: year,
    financialYear: null,
    counterId: `INV/GL/${year}`,
  };
}

export const formatInvoiceNumber = (
  prefix: string,
  series: InvoiceSeries,
  seq: number,
) =>
  `${prefix}/${series.series}/${series.period}/${String(seq).padStart(6, '0')}`;
