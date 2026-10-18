import { describe, it, expect } from 'vitest';
import {
  generateApiKey,
  hashApiKey,
  parseScopes,
  verifyApiKey,
  isApiKeyExpired,
  API_KEY_SCOPES,
} from '@/lib/api-keys';

describe('API key utilities', () => {
  it('generates keys with sk_ prefix', () => {
    const { rawKey, keyHash } = generateApiKey();
    expect(rawKey).toMatch(/^sk_[a-f0-9]{48}$/);
    expect(keyHash).toHaveLength(64);
  });

  it('hashes keys consistently', () => {
    const key = 'sk_test123';
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it('parses valid scopes', () => {
    expect(parseScopes(['read-only', 'read-write', 'invalid'])).toEqual([
      'read-only',
      'read-write',
    ]);
  });

  it('rejects empty scope list after parsing', () => {
    expect(parseScopes(['admin'])).toEqual([]);
  });

  it('never stores plaintext: generated key hash differs from raw key', () => {
    const { rawKey, keyHash } = generateApiKey();
    expect(keyHash).not.toBe(rawKey);
    expect(keyHash).toBe(hashApiKey(rawKey));
  });

  it('verifies a matching key and rejects a mismatched one', () => {
    const { rawKey, keyHash } = generateApiKey();
    expect(verifyApiKey(rawKey, keyHash)).toBe(true);
    expect(verifyApiKey('sk_deadbeef', keyHash)).toBe(false);
  });

  it('rejects verification against a malformed stored hash', () => {
    const { rawKey } = generateApiKey();
    expect(verifyApiKey(rawKey, 'not-a-hash')).toBe(false);
  });

  it('treats keys without expiry as non-expiring', () => {
    expect(isApiKeyExpired(null)).toBe(false);
  });

  it('detects expired keys', () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 1000);
    expect(isApiKeyExpired(past)).toBe(true);
    expect(isApiKeyExpired(future)).toBe(false);
  });

  it('exposes a deny-by-default scope enum', () => {
    expect(API_KEY_SCOPES).toContain('read-only');
    expect(API_KEY_SCOPES).toContain('read-write');
    expect(API_KEY_SCOPES).not.toContain('admin');
  });
});
