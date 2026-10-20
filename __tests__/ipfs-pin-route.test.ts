import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// /api/ipfs/pin must return the real CID from a pinning provider, never a
// hand-rolled `bafy${sha256}` string (issue #1507).
// ---------------------------------------------------------------------------

const REAL_CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

const { upsert } = vi.hoisted(() => ({ upsert: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { pinnedFile: { upsert } },
}));

import { POST } from '@/app/api/ipfs/pin/route';

const fetchMock = vi.fn();

beforeEach(() => {
  upsert.mockReset().mockResolvedValue({});
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.PINATA_API_KEY = 'test-key';
  process.env.PINATA_SECRET_API_KEY = 'test-secret';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PINATA_API_KEY;
  delete process.env.PINATA_SECRET_API_KEY;
  delete process.env.IPFS_RPC_URL;
});

async function sha256Hex(content: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content).buffer);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The route only ever calls req.formData(), so a minimal stub suffices. */
function requestWithForm(form: FormData) {
  return { formData: async () => form } as unknown as Parameters<typeof POST>[0];
}

async function pinRequest(content: string, opts: { sha256?: string } = {}) {
  const file = new Blob([content], { type: 'image/png' });
  const form = new FormData();
  form.append('file', file, 'art.png');
  if (opts.sha256) form.append('sha256', opts.sha256);
  return POST(requestWithForm(form));
}

describe('POST /api/ipfs/pin', () => {
  it('returns the CID provided by the pinning service verbatim', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ IpfsHash: REAL_CID, PinSize: 12 }),
    });

    const body = await (await pinRequest('hello world')).json();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body.cid).toBe(REAL_CID);
    expect(body.gatewayUrl).toContain(REAL_CID);
    expect(body.size).toBe(12);
  });

  it('never fabricates a CID from the sha256 digest', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ IpfsHash: REAL_CID, PinSize: 12 }),
    });

    const sha256 = await sha256Hex('hello world');
    const body = await (await pinRequest('hello world', { sha256 })).json();

    expect(body.cid).not.toBe(`bafy${sha256.slice(0, 52)}`);
    expect(body.sha256).toBe(sha256);
  });

  it('persists the pin and de-duplicates repeat uploads by CID', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ IpfsHash: REAL_CID, PinSize: 12 }),
    });

    await pinRequest('hello world');
    await pinRequest('hello world');

    expect(upsert).toHaveBeenCalledTimes(2);
    for (const [args] of upsert.mock.calls) {
      expect(args.where).toEqual({ cid: REAL_CID });
      expect(args.create).toMatchObject({ cid: REAL_CID, sha256: await sha256Hex('hello world') });
    }
  });

  it('rejects tampered uploads (422) without pinning them', async () => {
    const res = await pinRequest('good content', { sha256: 'deadbeef'.repeat(8) });

    expect(res.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns 503 with a retryable flag when the provider errors — no fake CID', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const res = await pinRequest('hello world');
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.retryable).toBe(true);
    expect(body.cid).toBeUndefined();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns 503 with a retryable flag when the provider is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await pinRequest('hello world');

    expect(res.status).toBe(503);
    expect((await res.json()).retryable).toBe(true);
  });

  it('returns 503 instead of inventing a CID when no provider is configured', async () => {
    delete process.env.PINATA_API_KEY;
    delete process.env.PINATA_SECRET_API_KEY;

    const res = await pinRequest('hello world');
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.retryable).toBe(true);
    expect(body.cid).toBeUndefined();
  });

  it('rejects a missing file with 400', async () => {
    const res = await POST(requestWithForm(new FormData()));
    expect(res.status).toBe(400);
  });
});
