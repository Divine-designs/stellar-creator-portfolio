import { describe, it, expect } from 'vitest';
import { validateSyncPushPayload } from '@/lib/validation/sync-push';

const OWNER = 'user-owner-1';
const ATTACKER = 'user-attacker-2';

function makePush(overrides: Record<string, unknown> = {}) {
  return {
    userId: OWNER,
    deviceId: 'device-1',
    changes: [
      {
        entityType: 'portfolio',
        entityId: 'portfolio-1',
        operation: 'update',
        ownerId: OWNER,
        data: { title: 'My portfolio' },
      },
    ],
    ...overrides,
  };
}

describe('validateSyncPushPayload', () => {
  it('accepts a well-formed push where the caller owns every record', () => {
    const result = validateSyncPushPayload(makePush(), OWNER);
    expect(result.ok).toBe(true);
  });

  it('rejects a push that writes another user\'s record (cross-user write)', () => {
    const payload = makePush({
      changes: [
        {
          entityType: 'portfolio',
          entityId: 'portfolio-victim',
          operation: 'update',
          ownerId: OWNER,
          data: { title: 'hijacked' },
        },
      ],
    });

    const result = validateSyncPushPayload(payload, ATTACKER);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/ownership/i);
    }
  });

  it('rejects a push whose body userId does not match the authenticated caller', () => {
    const result = validateSyncPushPayload(makePush({ userId: ATTACKER }), OWNER);
    expect(result.ok).toBe(false);
  });

  it('rejects unknown entity types (deny-by-default)', () => {
    const payload = makePush({
      changes: [
        {
          entityType: 'admin_settings',
          entityId: 'x',
          operation: 'update',
          ownerId: OWNER,
          data: {},
        },
      ],
    });

    const result = validateSyncPushPayload(payload, OWNER);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/entity type/i);
    }
  });

  it('rejects a record whose data fails the per-entity schema', () => {
    const payload = makePush({
      changes: [
        {
          entityType: 'portfolio',
          entityId: 'portfolio-1',
          operation: 'update',
          ownerId: OWNER,
          data: { title: 12345 },
        },
      ],
    });

    const result = validateSyncPushPayload(payload, OWNER);
    expect(result.ok).toBe(false);
  });

  it('rejects an empty changes array', () => {
    const result = validateSyncPushPayload(makePush({ changes: [] }), OWNER);
    expect(result.ok).toBe(false);
  });
});
