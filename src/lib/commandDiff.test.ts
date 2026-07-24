import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { describeDiff, diffCommandNames } from './commandDiff.js';

/**
 * The deploy script deletes registrations, and this diff is what an operator
 * reads to confirm it deleted the right ones. Reversed arguments here would
 * report a removal as an addition at exactly the wrong moment.
 */
describe('diffCommandNames', () => {
  test('reports a newly added command', () => {
    const diff = diffCommandNames(['ping', 'status'], ['ping', 'status', 'net']);

    assert.deepEqual(diff.added, ['net']);
    assert.deepEqual(diff.removed, []);
    assert.deepEqual(diff.unchanged, ['ping', 'status']);
  });

  test('reports a command that no longer exists in code', () => {
    const diff = diffCommandNames(['ping', 'legacy'], ['ping']);

    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, ['legacy']);
  });

  test('treats a rename as one addition and one removal', () => {
    const diff = diffCommandNames(['sites'], ['websites']);

    assert.deepEqual(diff.added, ['websites']);
    assert.deepEqual(diff.removed, ['sites']);
    assert.deepEqual(diff.unchanged, []);
  });

  test('reports nothing when the sets match, regardless of order', () => {
    const diff = diffCommandNames(['status', 'ping'], ['ping', 'status']);

    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
    assert.deepEqual(diff.unchanged, ['ping', 'status']);
  });

  test('handles a first-ever deploy', () => {
    const diff = diffCommandNames([], ['ping', 'help']);

    assert.deepEqual(diff.added, ['help', 'ping']);
    assert.deepEqual(diff.removed, []);
  });

  test('handles a full wipe', () => {
    const diff = diffCommandNames(['ping', 'help'], []);

    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, ['help', 'ping']);
  });
});

describe('describeDiff', () => {
  test('says so explicitly when nothing moved', () => {
    assert.equal(describeDiff({ added: [], removed: [], unchanged: ['ping'] }), ' · no changes');
  });

  test('lists both directions when both happened', () => {
    const text = describeDiff({ added: ['net'], removed: ['legacy'], unchanged: [] });

    assert.match(text, /added: net/);
    assert.match(text, /removed: legacy/);
  });
});
