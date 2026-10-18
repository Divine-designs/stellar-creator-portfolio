import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/user/data-export
 *
 * Issue #811 — GDPR/CCPA right-to-access (data portability).
 * Issue #1539 — include every user-linked model in the archive.
 * Returns a complete JSON archive of all data held for the authenticated user.
 * Logs the request to AuditLog for compliance.
 *
 * In a production deployment this would dispatch an async job and email a
 * download link; for now it returns the payload inline (acceptable for
 * datasets under the HTTP timeout threshold) and marks the response as a
 * JSON download attachment.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: {
      creatorProfile: true,
      clientProfile: true,
      bounties: true,
      applications: true,
      notifications: true,
      messages: true,
      reviews: true,
      payments: true,
      referrals: true,
      kycVerification: true,
      auditLogs: {
        orderBy: { createdAt: 'desc' },
        take: 1000,
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Log the data-export request itself
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'GDPR_DATA_EXPORT_REQUESTED',
      resource: 'user',
      resourceId: user.id,
      httpMethod: 'GET',
      payload: { requestedAt: new Date().toISOString(), ip: req.headers.get('x-forwarded-for') ?? 'unknown' },
    },
  });

  // Build the archive — strip sensitive server-side fields
  const archive = {
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      creatorProfile: user.creatorProfile,
      clientProfile: user.clientProfile,
    },
    bounties: user.bounties,
    applications: user.applications,
    messages: user.messages.map(m => ({
      id: m.id, bountyId: m.bountyId, senderId: m.senderId, receiverId: m.receiverId,
      content: m.content, createdAt: m.createdAt, readAt: m.readAt,
    })),
    reviews: user.reviews.map(r => ({
      id: r.id, bountyId: r.bountyId, reviewerId: r.reviewerId, revieweeId: r.revieweeId,
      rating: r.rating, comment: r.comment, createdAt: r.createdAt,
    })),
    payments: user.payments.map(p => ({
      id: p.id, bountyId: p.bountyId, amount: p.amount, currency: p.currency,
      status: p.status, createdAt: p.createdAt,
    })),
    notifications: user.notifications.map(n => ({
      id: n.id, title: n.title, body: n.body, type: n.type,
      createdAt: n.createdAt, readAt: n.readAt,
    })),
    referrals: user.referrals.map(r => ({
      id: r.id, referredUserId: r.referredUserId, status: r.status, createdAt: r.createdAt,
    })),
    kycVerification: user.kycVerification
      ? {
          id: user.kycVerification.id,
          status: user.kycVerification.status,
          provider: user.kycVerification.provider,
          submittedAt: user.kycVerification.submittedAt,
          reviewedAt: user.kycVerification.reviewedAt,
        }
      : null,
    auditLogs: user.auditLogs,
  };

  return new NextResponse(JSON.stringify(archive, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="stellar-data-export-${user.id}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
