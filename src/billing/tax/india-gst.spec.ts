import { indiaGst } from './india-gst';

describe('indiaGst', () => {
  it('charges IGST 18% across states', () => {
    expect(indiaGst(172431, '27', '29')).toEqual({
      amountMinor: 31038,
      lines: [{ type: 'IGST', rateBps: 1800, amountMinor: 31038 }],
    });
  });

  it('splits CGST + SGST within our state', () => {
    expect(indiaGst(172431, '29', '29')).toEqual({
      amountMinor: 31038,
      lines: [
        { type: 'CGST', rateBps: 900, amountMinor: 15519 },
        { type: 'SGST', rateBps: 900, amountMinor: 15519 },
      ],
    });
  });

  it('uses one GST line while a state is unknown', () => {
    expect(indiaGst(4000000, null, '29').lines).toEqual([
      { type: 'GST', rateBps: 1800, amountMinor: 720000 },
    ]);
    expect(indiaGst(4000000, '29', null).lines[0].type).toBe('GST');
  });

  it('charges nothing on zero', () => {
    expect(indiaGst(0, '27', '29').amountMinor).toBe(0);
  });
});
