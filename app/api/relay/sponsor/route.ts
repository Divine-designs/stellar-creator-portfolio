/**
 * POST /api/relay/sponsor
 *
 * Platform paymaster relay endpoint.  Receives a signed XDR transaction,
 * wraps it in a fee-bump funded by the platform account, and submits it to
 * the Stellar/Soroban network.
 *
 * The user never sees a network-fee prompt — the platform absorbs the cost.
 * The fee-bump logic lives in lib/payments/feeBump.ts so it can be tested
 * without HTTP; this handler only parses input and maps errors.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sponsorTransaction, SponsorError } from '@/lib/payments/feeBump';

export async function POST(req: NextRequest) {
  try {
    const { xdr } = await req.json();
    if (!xdr || typeof xdr !== 'string') {
      return NextResponse.json({ error: 'Missing xdr' }, { status: 400 });
    }

    const result = await sponsorTransaction(xdr);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SponsorError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
