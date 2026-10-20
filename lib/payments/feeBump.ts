/**
 * Fee-bump (paymaster) relay logic.
 *
 * Backs `POST /api/relay/sponsor`.  Receives a user-signed transaction
 * envelope, wraps it in a `FeeBumpTransaction` whose fee source is the
 * platform account, signs the wrapper with the platform fee key (fetched via
 * KMS — never a raw secret held in the request path) and submits it to
 * Horizon.  The user's original signatures are untouched and the platform
 * absorbs the network fee, so the "gasless" UX is real rather than aspirational.
 *
 * Kept free of HTTP concerns so it can be unit-tested directly.
 */

import {
  FeeBumpTransaction,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { getSecret } from '@/server/services/kms';

/** Error carrying the HTTP status the thin route handler should surface. */
export class SponsorError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'SponsorError';
  }
}

export interface SponsoredResult {
  /** Hash of the outer fee-bump transaction. */
  hash: string;
  /** Hash of the inner, user-signed transaction. */
  innerHash: string;
  /** Ledger sequence in which it was included. */
  ledger: number;
  /** Total fee (stroops) actually charged by the network. */
  feeCharged: string;
}

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';

/**
 * Hard ceiling (stroops) on the total fee the platform will absorb for a
 * single sponsored transaction.  Inner transactions whose own fee already
 * exceeds this are rejected rather than silently billed to the platform.
 */
export const MAX_SPONSORED_FEE = BigInt(
  process.env.STELLAR_MAX_SPONSORED_FEE ?? 100_000, // 0.01 XLM
);

function networkPassphrase(): string {
  return process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
}

/**
 * Parse a user-signed envelope XDR and wrap it in a platform-funded fee-bump.
 *
 * Rejects (via {@link SponsorError}) when:
 *  - the fee account is not configured (503),
 *  - the XDR does not decode for the configured network (400),
 *  - the envelope is already a fee-bump (400, double-wrapping is meaningless),
 *  - the inner fee exceeds {@link MAX_SPONSORED_FEE} (402).
 *
 * Soroban note: fee-bumping a Soroban transaction works, but the inner tx's
 * resource fee must already be set by a prior simulation — the relay only
 * bumps the inclusion fee and does not re-simulate.
 */
export async function buildFeeBump(xdrEnvelope: string): Promise<FeeBumpTransaction> {
  const passphrase = networkPassphrase();
  const feeSource = process.env.STELLAR_FEE_ACCOUNT;
  if (!feeSource) {
    throw new SponsorError('Paymaster relay is not configured', 503);
  }

  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(xdrEnvelope, passphrase) as
      | Transaction
      | FeeBumpTransaction;
  } catch {
    throw new SponsorError('Invalid transaction XDR', 400);
  }

  if (parsed instanceof FeeBumpTransaction) {
    throw new SponsorError('Transaction is already fee-bumped', 400);
  }

  const inner = parsed as Transaction;
  const innerFee = BigInt(inner.fee);
  if (innerFee > MAX_SPONSORED_FEE) {
    throw new SponsorError('Transaction fee exceeds the sponsored maximum', 402);
  }

  // buildFeeBumpTransaction expects a *per-operation* base fee that must be at
  // least the inner tx's inclusion fee and the network minimum (100 stroops).
  // The resulting outer fee is baseFee × (innerOps + 1) + innerResourceFee, so
  // rejecting inner fees above the cap bounds what the platform can be billed.
  const innerOps = BigInt(inner.operations.length || 1);
  const perOpBase = (innerFee + innerOps - 1n) / innerOps; // ceil(innerFee / ops)
  const baseFee = (perOpBase < 100n ? 100n : perOpBase).toString();

  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    feeSource,
    baseFee,
    inner,
    passphrase,
  );

  // Sign only the outer envelope — the inner tx keeps the user's signatures.
  const feeSecret = await getSecret('STELLAR_FEE_ACCOUNT_SECRET');
  feeBump.sign(Keypair.fromSecret(feeSecret));

  return feeBump;
}

/**
 * Build the fee-bump and submit it to Horizon, returning the hashes the
 * paymaster client surfaces to the UI.
 */
export async function sponsorTransaction(xdrEnvelope: string): Promise<SponsoredResult> {
  const feeBump = await buildFeeBump(xdrEnvelope);
  const horizonUrl = process.env.STELLAR_HORIZON_URL ?? DEFAULT_HORIZON_URL;

  const res = await fetch(`${horizonUrl}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ tx: feeBump.toXDR() }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    hash?: string;
    ledger?: number;
    fee_charged?: string;
    title?: string;
  };

  if (!res.ok) {
    throw new SponsorError(body.title ?? 'Submission failed', res.status);
  }

  return {
    hash: body.hash ?? feeBump.hash().toString('hex'),
    innerHash: feeBump.innerTransaction.hash().toString('hex'),
    ledger: Number(body.ledger ?? 0),
    feeCharged: body.fee_charged ?? feeBump.fee,
  };
}
