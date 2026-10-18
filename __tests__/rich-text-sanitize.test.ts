import { describe, it, expect } from 'vitest';
import { sanitizeRichText } from '@/lib/rich-text/sanitize';

describe('sanitizeRichText', () => {
  it('keeps allowlisted formatting tags', () => {
    const input = '<p>Hello <strong>world</strong> <em>!</em></p>';
    expect(sanitizeRichText(input)).toBe(input);
  });

  it('strips <script> tags', () => {
    const out = sanitizeRichText('<p>hi</p><script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('strips img onerror payloads', () => {
    const out = sanitizeRichText('<img src=x onerror="alert(1)">');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('onerror');
  });

  it('strips svg onload payloads', () => {
    const out = sanitizeRichText('<svg onload="alert(1)"></svg>');
    expect(out).not.toContain('<svg');
    expect(out).not.toContain('onload');
  });

  it('blocks javascript: links', () => {
    const out = sanitizeRichText('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('click');
  });

  it('blocks data: URLs', () => {
    const out = sanitizeRichText('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>');
    expect(out).not.toContain('data:');
  });

  it('forces rel and target on safe links', () => {
    const out = sanitizeRichText('<a href="https://example.com">link</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('returns empty string for null/undefined input', () => {
    expect(sanitizeRichText(null)).toBe('');
    expect(sanitizeRichText(undefined)).toBe('');
  });
});
