import { CreditType } from '@hypersign-protocol/credit-middleware';
import { SERVICE_TYPES } from '../supported-service/services/iServiceList';
import { dashboardPlanId } from './credit-wallet';

describe('dashboardPlanId', () => {
  it.each([CreditType.API_CREDIT, CreditType.BLOCKCHAIN_TXN_CREDIT])(
    'removes the SSI %s wallet suffix',
    (creditType) => {
      expect(
        dashboardPlanId(
          `6a8ed366d8732357af0ff9c4.${creditType}`,
          SERVICE_TYPES.SSI_API,
          creditType,
        ),
      ).toBe('6a8ed366d8732357af0ff9c4');
    },
  );

  it('infers a known SSI suffix for rejected command ledger records', () => {
    expect(
      dashboardPlanId(
        '6a8ed366d8732357af0ff9c4.BLOCKCHAIN_TXN_CREDIT',
        SERVICE_TYPES.SSI_API,
      ),
    ).toBe('6a8ed366d8732357af0ff9c4');
  });
});
