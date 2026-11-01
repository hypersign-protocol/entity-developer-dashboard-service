import {
  formatInvoiceNumber,
  indianFinancialYear,
  invoiceSeries,
} from './invoice-number';

describe('invoice numbering', () => {
  it('uses the Indian financial year in IST', () => {
    expect(indianFinancialYear(new Date('2026-11-01T09:00:00Z'))).toBe(
      '2026-27',
    );
    expect(indianFinancialYear(new Date('2027-03-31T18:00:00Z'))).toBe(
      '2026-27',
    ); // 23:30 IST
    expect(indianFinancialYear(new Date('2027-03-31T18:30:00Z'))).toBe(
      '2027-28',
    ); // 00:00 IST, 1 Apr
    expect(indianFinancialYear(new Date('2026-01-15T00:00:00Z'))).toBe(
      '2025-26',
    );
    expect(indianFinancialYear(new Date('2099-06-01T00:00:00Z'))).toBe(
      '2099-00',
    );
  });

  it('formats India and Global numbers', () => {
    const at = new Date('2026-11-01T09:00:00Z');
    expect(formatInvoiceNumber('HS', invoiceSeries('IN', at), 123)).toBe(
      'HS/IN/2026-27/000123',
    );
    expect(formatInvoiceNumber('HS', invoiceSeries('GLOBAL', at), 1)).toBe(
      'HS/GL/2026/000001',
    );
    expect(invoiceSeries('IN', at).counterId).toBe('INV/IN/2026-27');
    expect(invoiceSeries('GLOBAL', at)).toMatchObject({
      counterId: 'INV/GL/2026',
      financialYear: null,
    });
  });
});
