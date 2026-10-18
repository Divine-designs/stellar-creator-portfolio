import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
const mockPrisma = {
  kycSubmission: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
};

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  DeleteObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

const CRON_SECRET = 'test-cron-secret';

function makeRequest(secret?: string) {
  return new Request('http://localhost/api/admin/cron/kyc-cleanup', {
    method: 'POST',
    headers: secret ? { 'X-Cron-Secret': secret } : {},
  });
}

describe('POST /api/admin/cron/kyc-cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.KYC_S3_BUCKET = 'kyc-bucket';
    mockSend.mockResolvedValue({});
  });

  it('rejects requests without a valid cron secret', async () => {
    const { POST } = await import('@/app/api/admin/cron/kyc-cleanup/route');
    const res = await POST(makeRequest('wrong-secret'));
    expect(res.status).toBe(401);
    expect(mockPrisma.kycSubmission.findMany).not.toHaveBeenCalled();
  });

  it('deletes S3 objects for expired KYC records before deleting DB rows', async () => {
    mockPrisma.kycSubmission.findMany.mockResolvedValue([
      { id: 'kyc_1', s3Key: 'kyc/kyc_1.pdf' },
      { id: 'kyc_2', s3Key: 'kyc/kyc_2.pdf' },
    ]);
    mockPrisma.kycSubmission.deleteMany.mockResolvedValue({ count: 2 });

    const { POST } = await import('@/app/api/admin/cron/kyc-cleanup/route');
    const res = await POST(makeRequest(CRON_SECRET));

    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(2);
    const deletedKeys = mockSend.mock.calls.map((c) => c[0].input.Key);
    expect(deletedKeys).toEqual(['kyc/kyc_1.pdf', 'kyc/kyc_2.pdf']);
    expect(mockPrisma.kycSubmission.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['kyc_1', 'kyc_2'] } },
    });
  });

  it('is idempotent when an S3 object is already deleted', async () => {
    mockPrisma.kycSubmission.findMany.mockResolvedValue([
      { id: 'kyc_1', s3Key: 'kyc/kyc_1.pdf' },
    ]);
    mockPrisma.kycSubmission.deleteMany.mockResolvedValue({ count: 1 });
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }),
    );

    const { POST } = await import('@/app/api/admin/cron/kyc-cleanup/route');
    const res = await POST(makeRequest(CRON_SECRET));

    expect(res.status).toBe(200);
    expect(mockPrisma.kycSubmission.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['kyc_1'] } },
    });
  });

  it('does not delete DB rows when an S3 deletion fails unexpectedly', async () => {
    mockPrisma.kycSubmission.findMany.mockResolvedValue([
      { id: 'kyc_1', s3Key: 'kyc/kyc_1.pdf' },
    ]);
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const { POST } = await import('@/app/api/admin/cron/kyc-cleanup/route');
    const res = await POST(makeRequest(CRON_SECRET));

    expect(res.status).toBe(500);
    expect(mockPrisma.kycSubmission.deleteMany).not.toHaveBeenCalled();
  });

  it('returns zero counts when nothing is expired', async () => {
    mockPrisma.kycSubmission.findMany.mockResolvedValue([]);

    const { POST } = await import('@/app/api/admin/cron/kyc-cleanup/route');
    const res = await POST(makeRequest(CRON_SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockSend).not.toHaveBeenCalled();
    expect(body).toMatchObject({ deletedObjects: 0, deletedRows: 0 });
  });
});
