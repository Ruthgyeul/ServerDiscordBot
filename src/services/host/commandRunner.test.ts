import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseExtraArgs } from './commandRunner.js';

/**
 * Extra arguments are the one place a Discord user's free text reaches a
 * process argv. `execFile` already means they cannot become shell syntax, so
 * these tests pin the second layer: what a caller is allowed to say at all.
 */
describe('parseExtraArgs', () => {
  test('splits on whitespace and drops empties', () => {
    assert.deepEqual(parseExtraArgs('  -n   50  '), ['-n', '50']);
  });

  test('returns nothing for an empty string', () => {
    assert.deepEqual(parseExtraArgs('   '), []);
  });

  test('accepts the characters real arguments need', () => {
    assert.deepEqual(parseExtraArgs('--path=/var/log/app.log --tag=a,b 50%'), [
      '--path=/var/log/app.log',
      '--tag=a,b',
      '50%',
    ]);
  });

  test('rejects shell metacharacters', () => {
    for (const input of ['a; rm -rf /', 'a && b', 'a | b', '$(whoami)', '`id`', 'a>b']) {
      assert.throws(() => parseExtraArgs(input), /not allowed/, `should reject ${input}`);
    }
  });

  test('constrains argument meaning when the entry sets a pattern', () => {
    // The charset check passes /etc/shadow happily — it contains nothing
    // dangerous. Only an entry-level pattern can say "a line count, not a path".
    assert.deepEqual(parseExtraArgs('50', '^[0-9]{1,4}$'), ['50']);
    assert.throws(() => parseExtraArgs('/etc/shadow', '^[0-9]{1,4}$'), /not permitted/);
    assert.throws(() => parseExtraArgs('-rf', '^[0-9]{1,4}$'), /not permitted/);
  });

  test('applies the pattern to every argument, not just the first', () => {
    assert.throws(() => parseExtraArgs('10 /etc/passwd', '^[0-9]{1,4}$'), /not permitted/);
  });

  test('caps the number of arguments', () => {
    assert.throws(() => parseExtraArgs('a b c d e f g h i j'), /Too many/);
  });

  test('caps argument length', () => {
    assert.throws(() => parseExtraArgs('x'.repeat(300)), /too long/);
  });

  test('rejects newline smuggling', () => {
    // Split on \s+ makes this two arguments rather than one, but the second
    // must still be rejected on its own merits.
    assert.throws(() => parseExtraArgs('ok\n; rm -rf /'), /not allowed/);
  });
});
