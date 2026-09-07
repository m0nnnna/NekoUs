import { describe, expect, it } from 'vitest';
import { isCryptoStoreDeviceMismatch } from './client';

describe('isCryptoStoreDeviceMismatch', () => {
  it('recognizes the Rust crypto engine\'s stale-device-store error', () => {
    const err = new Error(
      "the account in the store doesn't match the account in the constructor: expected @test6:chat.frennet.xyz:PWPGCVNQSP, got @test6:chat.frennet.xyz:MWNWJSUIWJ"
    );
    expect(isCryptoStoreDeviceMismatch(err)).toBe(true);
  });

  it('is case-insensitive (the exact casing isn\'t a stable contract from a WASM error string)', () => {
    expect(isCryptoStoreDeviceMismatch(new Error('Account In The Store Doesn\'t Match the constructor'))).toBe(true);
  });

  it('does not misclassify an unrelated error as this recoverable case', () => {
    expect(isCryptoStoreDeviceMismatch(new Error('Network request failed'))).toBe(false);
    expect(isCryptoStoreDeviceMismatch(new Error('M_UNKNOWN_TOKEN'))).toBe(false);
  });

  it('handles a thrown non-Error value safely', () => {
    expect(isCryptoStoreDeviceMismatch('a plain string')).toBe(false);
    expect(isCryptoStoreDeviceMismatch(undefined)).toBe(false);
  });
});
