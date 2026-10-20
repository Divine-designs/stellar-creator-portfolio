import { NextRequest, NextResponse } from 'next/server';
import { buildGatewayUrl } from '@/lib/ipfs/gateways';
import { HashMismatchError, PinUnavailableError, pinFile } from '@/lib/ipfs/pinner';

// Pinning persists to Postgres via Prisma, which needs the Node runtime.
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('file');
  const expectedSha256 = String(form.get('sha256') ?? '');

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }

  const name = (file instanceof File && file.name) || 'upload';

  try {
    const { cid, sha256, size } = await pinFile(file, { name, expectedSha256 });
    return NextResponse.json({
      cid,
      sha256,
      size,
      gatewayUrl: buildGatewayUrl(cid),
    });
  } catch (err) {
    if (err instanceof HashMismatchError) {
      return NextResponse.json({ error: 'Hash mismatch' }, { status: 422 });
    }
    if (err instanceof PinUnavailableError) {
      // Never fall back to a fabricated CID (issue #1507).
      return NextResponse.json(
        { error: 'Pinning service unavailable', retryable: true },
        { status: 503 },
      );
    }
    throw err;
  }
}
