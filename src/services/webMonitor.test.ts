import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { healthCheckUserAgent } from './webMonitor.js';

/**
 * Regression tests for a bug that made *every* site look down: a non-Latin-1
 * BOT_NAME (Korean, an emoji) cannot go into an HTTP header, so `fetch` threw
 * before sending the request and the failure was reported as if the site were
 * unreachable.
 */
describe('healthCheckUserAgent', () => {
  /** Mirrors the ByteString rule fetch enforces on header values. */
  function isHeaderSafe(value: string): boolean {
    return [...value].every((char) => (char.codePointAt(0) ?? 0) <= 0xff);
  }

  test('passes a plain ASCII name through', () => {
    assert.equal(
      healthCheckUserAgent('ServerDiscordBot'),
      'ServerDiscordBot/1.0 health-check',
    );
  });

  test('produces a header-safe value for a Korean name', () => {
    const agent = healthCheckUserAgent('귀찮은 초이');
    assert.equal(isHeaderSafe(agent), true);
    assert.equal(agent, 'ServerDiscordBot/1.0 health-check');
  });

  test('produces a header-safe value for an emoji name', () => {
    const agent = healthCheckUserAgent('🖥️ bot 🚀');
    assert.equal(isHeaderSafe(agent), true);
    assert.equal(agent, 'bot/1.0 health-check');
  });

  test('keeps the ASCII part of a mixed name', () => {
    assert.equal(healthCheckUserAgent('Choi 초이'), 'Choi/1.0 health-check');
  });

  test('collapses whitespace rather than emitting a broken header', () => {
    assert.equal(healthCheckUserAgent('My  Server Bot'), 'My-Server-Bot/1.0 health-check');
  });

  test('falls back when the name is empty', () => {
    assert.equal(healthCheckUserAgent('   '), 'ServerDiscordBot/1.0 health-check');
  });
});
