// India GST (ADR §7): 18% on the amount after discounts. Same state as our
// registered entity: CGST 9% + SGST 9%. Any other state: IGST 18%. If either
// state isn't known yet, one "GST 18%" line (the amount is the same).
import { applyBps } from '../pricing/pricing';

export type TaxLineType = 'CGST' | 'SGST' | 'IGST' | 'GST';

export interface TaxLine {
  type: TaxLineType;
  rateBps: number;
  amountMinor: number;
}

export function indiaGst(
  taxableMinor: number,
  customerStateCode: string | null | undefined,
  supplierStateCode: string | null | undefined,
): { amountMinor: number; lines: TaxLine[] } {
  let lines: TaxLine[];
  if (!customerStateCode || !supplierStateCode) {
    lines = [
      { type: 'GST', rateBps: 1800, amountMinor: applyBps(taxableMinor, 1800) },
    ];
  } else if (customerStateCode === supplierStateCode) {
    const half = applyBps(taxableMinor, 900);
    lines = [
      { type: 'CGST', rateBps: 900, amountMinor: half },
      { type: 'SGST', rateBps: 900, amountMinor: half },
    ];
  } else {
    lines = [
      {
        type: 'IGST',
        rateBps: 1800,
        amountMinor: applyBps(taxableMinor, 1800),
      },
    ];
  }
  return {
    amountMinor: lines.reduce((sum, l) => sum + l.amountMinor, 0),
    lines,
  };
}

/** Our GST registration state, from BILLING_SUPPLIER_STATE_CODE. */
export const supplierStateCode = (): string | null =>
  process.env.BILLING_SUPPLIER_STATE_CODE?.trim() || null;
