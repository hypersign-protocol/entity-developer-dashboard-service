import { CreditLedgerSchema } from './credit-ledger.schema';

describe('CreditLedgerSchema indexes', () => {
  const schemaIndexes = CreditLedgerSchema.indexes() as unknown as Array<
    [Record<string, number>, Record<string, unknown>]
  >;
  const indexes = schemaIndexes.map(([fields]) => fields);

  it.each([
    { 'metadata.serviceId': 1, timestamp: -1 },
    { planId: 1, timestamp: -1 },
    { 'metadata.serviceId': 1, planId: 1, timestamp: -1 },
    { 'metadata.serviceId': 1, eventType: 1, timestamp: -1 },
  ])('supports the query pattern %o', (expectedIndex) => {
    expect(indexes).toContainEqual(expectedIndex);
  });

  it('keeps event id unique for ledger idempotency', () => {
    expect(schemaIndexes).toContainEqual([
      { eventId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });

  it('stores explicit event fields without a generic payload object', () => {
    expect(CreditLedgerSchema.path('payload')).toBeUndefined();
  });
});
