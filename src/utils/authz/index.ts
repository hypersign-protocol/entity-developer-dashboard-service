import {
  DeliverTxResponse,
  SigningStargateClient,
  StdFee,
} from '@cosmjs/stargate';
import { BasicAllowance } from 'cosmjs-types/cosmos/feegrant/v1beta1/feegrant';
import {
  MsgGrantAllowance,
  MsgRevokeAllowance,
} from 'cosmjs-types/cosmos/feegrant/v1beta1/tx';
import {
  MsgExec,
  MsgGrant,
  MsgRevoke,
} from 'cosmjs-types/cosmos/authz/v1beta1/tx';
import { GenericAuthorization } from 'cosmjs-types/cosmos/authz/v1beta1/authz';
import { Timestamp } from 'cosmjs-types/google/protobuf/timestamp';
import * as Long from 'long';
import { Coin } from 'cosmjs-types/cosmos/base/v1beta1/coin';

export const MSG_CREATE_DID_TYPEURL = '/hypersign.ssi.v1.MsgRegisterDID';
export const MSG_UPDATE_DID_TYPEURL = '/hypersign.ssi.v1.MsgUpdateDID';
export const MSG_REGISTER_CREDENTIAL_STATUS =
  '/hypersign.ssi.v1.MsgRegisterCredentialStatus';
export const MSG_REGISTER_CREDENTIAL_SCHEMA =
  '/hypersign.ssi.v1.MsgRegisterCredentialSchema';
export const MSG_UPDATE_CREDENTIAL_STATUS =
  '/hypersign.ssi.v1.MsgUpdateCredentialStatus';

function getExpirationDateInSeconds(periodInYears: number): Long {
  const timeNowUnixTimestamp = Math.floor(Date.now() / 1000); // Get the current unix timestamp
  const timeFutureUnixTimestamp: Long = Long.fromNumber(
    timeNowUnixTimestamp + 365 * 24 * 60 * 60 * periodInYears,
  );

  return timeFutureUnixTimestamp;
}
export async function generateAuthzGrantTxnMessage(
  granteeAddress: string,
  granterAddress: string,
  grantMsgTypeUrl: string,
) {
  const authGrantMsg: MsgGrant = {
    granter: granterAddress,
    grantee: granteeAddress,
    grant: {
      authorization: {
        typeUrl: '/cosmos.authz.v1beta1.GenericAuthorization',
        value: GenericAuthorization.encode(
          GenericAuthorization.fromPartial({
            msg: grantMsgTypeUrl,
          }),
        ).finish(),
      },
      expiration: Timestamp.fromPartial({
        seconds: getExpirationDateInSeconds(1),
      }),
    },
  };
  const txMsg = {
    typeUrl: '/cosmos.authz.v1beta1.MsgGrant',
    value: authGrantMsg,
  };

  const fee: StdFee = {
    amount: [
      {
        denom: 'uhid',
        amount: '20000',
      },
    ],
    gas: '500000',
  };

  return {
    txMsg,
    fee,
  };
}

export async function generatePerformFeegrantAllowanceTxn(
  granteeAddress: string,
  granterAddress: string,
  feeAllowanceInUhid: string,
) {
  const feeAllowanceAmount = feeAllowanceInUhid.split('u')[0];
  const feeAllowanceDenom = 'u' + feeAllowanceInUhid.split('u')[1];

  if (feeAllowanceDenom !== 'uhid') {
    throw new Error(
      "denom for feeAllowanceInUhid must be 'uhid', got " + feeAllowanceDenom,
    );
  }

  const grantAllowanceMsg: MsgGrantAllowance = {
    grantee: granteeAddress,
    granter: granterAddress,
    allowance: {
      typeUrl: '/cosmos.feegrant.v1beta1.BasicAllowance',
      value: BasicAllowance.encode(
        BasicAllowance.fromPartial({
          spendLimit: [
            Coin.fromPartial({
              denom: feeAllowanceDenom,
              amount: feeAllowanceAmount,
            }),
          ],
          expiration: Timestamp.fromPartial({
            seconds: getExpirationDateInSeconds(1),
          }),
        }),
      ).finish(),
    },
  };

  const txMsg = {
    typeUrl: '/cosmos.feegrant.v1beta1.MsgGrantAllowance',
    value: grantAllowanceMsg,
  };

  const fee: StdFee = {
    amount: [
      {
        denom: 'uhid',
        amount: '1000',
      },
    ],
    gas: '500000',
  };

  return {
    txMsg,
    fee,
  };
}
