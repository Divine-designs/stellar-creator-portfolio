import { StrKey } from "@stellar/stellar-sdk";

/**
 * Result of validating a Stellar wallet address submitted by a user.
 * Deny-by-default: anything that is not a well-formed Ed25519 public key
 * (G-address) is rejected rather than cleaned up.
 */
export type WalletAddressValidationResult =
  | { ok: true; address: string }
  | { ok: false; error: string };

/**
 * Validate that `input` is a Stellar Ed25519 public key (G-address).
 *
 * This checks the StrKey encoding and checksum via
 * `StrKey.isValidEd25519PublicKey`, so typo'd or malformed addresses are
 * rejected before they are persisted (which would otherwise send payouts
 * nowhere).
 */
export function validateWalletAddress(
  input: unknown,
): WalletAddressValidationResult {
  if (typeof input !== "string") {
    return { ok: false, error: "Wallet address must be a string" };
  }

  const address = input.trim();

  if (address.length === 0) {
    return { ok: false, error: "Wallet address is required" };
  }

  if (!StrKey.isValidEd25519PublicKey(address)) {
    return {
      ok: false,
      error: "Invalid Stellar wallet address: expected a valid G-address",
    };
  }

  return { ok: true, address };
}
