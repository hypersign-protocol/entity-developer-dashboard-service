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

  it('indexes event id for idempotency lookups', () => {
    expect(schemaIndexes).toContainEqual([
      { eventId: 1 },
      expect.not.objectContaining({ unique: true }),
    ]);
  });

  it('uses timestamp and metadata as the time-series fields', () => {
    expect(CreditLedgerSchema.get('timeseries')).toEqual({
      timeField: 'timestamp',
      metaField: 'metadata',
      granularity: 'seconds',
    });
  });

  it('stores explicit event fields without a generic payload object', () => {
    expect(CreditLedgerSchema.path('payload')).toBeUndefined();
  });
});
