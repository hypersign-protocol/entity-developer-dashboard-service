// Jest stand-in for `hypersign-edv-client`.
//
// The real package pulls in @digitalbazaar/minimal-cipher, which loads its
// code through the `esm` loader. That loader bypasses Jest's module registry,
// so @peculiar/asn1-schema gets loaded twice and crashes with
// "Cannot get schema for 'ObjectIdentifier' target" before any test runs.
// Specs that need real EDV behaviour should mock this class explicitly.
export class HypersignEdvClientEd25519VerificationKey2020 {
  constructor() {
    throw new Error(
      'hypersign-edv-client is stubbed in Jest; mock it in the spec that needs it',
    );
  }
}
