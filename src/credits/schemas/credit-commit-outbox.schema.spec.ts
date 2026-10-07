import {
  CreditCommitLedgerStatus,
  CreditCommitOutboxSchema,
} from './credit-commit-outbox.schema';

describe('CreditCommitOutboxSchema', () => {
  it('uses a regular collection with a unique event id', () => {
    expect(CreditCommitOutboxSchema.get('timeseries')).toBeUndefined();
    expect(CreditCommitOutboxSchema.get('collection')).toBe(
      'creditCommitOutbox',
    );
    expect(CreditCommitOutboxSchema.indexes()).toContainEqual([
      { eventId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });

  it('starts ledger delivery in a retryable pending state', () => {
    expect(CreditCommitOutboxSchema.path('ledgerStatus').options.default).toBe(
      CreditCommitLedgerStatus.PENDING,
    );
    expect(
      CreditCommitOutboxSchema.path('ledgerAttempts').options.default,
    ).toBe(0);
  });
});
