import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DiscordLimits, codeBlock, fitEntries, truncateText } from './limits.js';

/**
 * These guard the failure mode that only appears once the managed server grows:
 * a list that renders fine with three services and 400s the interaction with
 * thirty.
 */
describe('fitEntries', () => {
  test('returns everything when it fits', () => {
    assert.equal(fitEntries(['a', 'b', 'c'], 100), 'a\nb\nc');
  });

  test('returns an empty string for no entries', () => {
    assert.equal(fitEntries([], 100), '');
  });

  test('never exceeds the limit', () => {
    const entries = Array.from({ length: 200 }, (_, i) => `service-${i} is running fine`);
    const out = fitEntries(entries, DiscordLimits.embedDescription);

    assert.ok(out.length <= DiscordLimits.embedDescription, `was ${out.length}`);
  });

  test('cuts between entries, never inside one', () => {
    const entries = ['aaaa', 'bbbb', 'cccc', 'dddd'];
    const out = fitEntries(entries, 20);

    for (const line of out.split('\n')) {
      if (line.startsWith('_')) continue; // the overflow note
      assert.ok(entries.includes(line), `"${line}" is a partial entry`);
    }
  });

  test('says how many entries were dropped', () => {
    const out = fitEntries(['aaaa', 'bbbb', 'cccc', 'dddd'], 20);
    assert.match(out, /and \d+ more/);
  });

  test('adds no note when everything fits', () => {
    assert.doesNotMatch(fitEntries(['a', 'b'], 100), /more/);
  });

  test('truncates rather than returning nothing when one entry is oversized', () => {
    const out = fitEntries(['x'.repeat(500)], 50);

    assert.ok(out.length <= 50);
    assert.notEqual(out, '');
  });

  test('honours a custom separator', () => {
    assert.equal(fitEntries(['a', 'b'], 100, '\n\n'), 'a\n\nb');
  });
});

describe('truncateText', () => {
  test('leaves short text alone', () => {
    assert.equal(truncateText('short', 50), 'short');
  });

  test('respects the limit exactly', () => {
    assert.equal(truncateText('x'.repeat(100), 10).length, 10);
  });
});

describe('codeBlock', () => {
  test('wraps in fences', () => {
    assert.equal(codeBlock('hello', 100), '```\nhello\n```');
  });

  test('neutralises a fence break from untrusted log content', () => {
    // nginx writes the request path verbatim, so this is reachable by anyone
    // who can send an HTTP request to the host.
    const hostile = 'GET /```\n**INJECTED** HTTP/1.1';
    const out = codeBlock(hostile);

    // Exactly one opening and one closing fence: nothing escaped the block.
    assert.equal(out.split('```').length, 3);
    assert.ok(out.startsWith('```\n') && out.endsWith('\n```'));
  });

  test('stays inside the limit even when escaping grows the text', () => {
    // Escaping adds a backslash per backtick, so a backtick-heavy input is
    // longer after escaping than before — the bound must still hold.
    const out = codeBlock('`'.repeat(9000), DiscordLimits.embedDescription);
    assert.ok(out.length <= DiscordLimits.embedDescription, `was ${out.length}`);
  });

  test('counts the fences against the limit', () => {
    const out = codeBlock('x'.repeat(5000), DiscordLimits.embedDescription);
    assert.ok(
      out.length <= DiscordLimits.embedDescription,
      `block was ${out.length}, over the ${DiscordLimits.embedDescription} limit`,
    );
  });
});
