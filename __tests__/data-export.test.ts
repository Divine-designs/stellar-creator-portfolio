import { Prisma } from '@prisma/client';
import { buildUserDataExport } from '@/lib/user-data-export';

/**
 * Regression test for #1539: the GDPR data export must include every
 * Prisma model that is linked to a User (via a `userId` field or a
 * relation to `User`). If a new user-linked model is added and the
 * export forgets it, this test fails.
 */

const SECRET_FIELDS = new Set([
  'password',
  'passwordHash',
  'hashedPassword',
  'token',
  'tokenHash',
  'refreshToken',
  'secret',
  'secretKey',
  'stellarSecret',
  'stellarSecretSeed',
  'privateKey',
  'apiKey',
]);

function modelHasUserLink(model: Prisma.DMMF.Model): boolean {
  return model.fields.some((field) => {
    if (field.name === 'userId') return true;
    if (field.kind === 'object' && field.type === 'User') return true;
    return false;
  });
}

function userLinkedModels(): string[] {
  return Prisma.dmmf.datamodel.models
    .filter((model) => model.name !== 'User' && modelHasUserLink(model))
    .map((model) => model.name)
    .sort();
}

function exportKeys(): string[] {
  const payload = buildUserDataExport({
    userId: 'test-user-id',
    records: {},
  });
  return Object.keys(payload).sort();
}

describe('GDPR data export coverage (#1539)', () => {
  it('includes every Prisma model linked to a User', () => {
    const expected = userLinkedModels();
    const keys = exportKeys();

    const missing = expected.filter((model) => !keys.includes(model));
    expect(missing).toEqual([]);
  });

  it('does not leak secret or hash fields', () => {
    const payload = buildUserDataExport({
      userId: 'test-user-id',
      records: {},
    });
    const serialized = JSON.stringify(payload);

    for (const secret of SECRET_FIELDS) {
      expect(serialized).not.toContain(`"${secret}"`);
    }
  });

  it('matches the export key snapshot', () => {
    expect(exportKeys()).toMatchSnapshot();
  });
});
