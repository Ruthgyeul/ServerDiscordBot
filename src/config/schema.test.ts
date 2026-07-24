import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCommands,
  normalizeFiles,
  normalizeMonitor,
  normalizeServices,
  normalizeWebsites,
  checkReferences,
} from './schema.js';
import type { ConfigIssue } from '../types/index.js';

/**
 * These lists are security allowlists, so the behaviour under test is not
 * "does a good config load" but "does a bad one fail closed": every rejection
 * below is a path that must never reach systemctl, execFile or the filesystem.
 */

/** Run a normalizer and hand back both the result and the issues it raised. */
function normalize<T>(
  fn: (raw: unknown, issues: ConfigIssue[]) => T,
  raw: unknown,
): { result: T; issues: ConfigIssue[]; errors: ConfigIssue[] } {
  const issues: ConfigIssue[] = [];
  const result = fn(raw, issues);
  return { result, issues, errors: issues.filter((issue) => issue.level === 'error') };
}

describe('normalizeServices', () => {
  test('keeps a valid entry and applies defaults', () => {
    const { result, issues } = normalize(normalizeServices, [
      { name: 'portfolio', label: 'Portfolio', unit: 'portfolio.service' },
    ]);

    assert.equal(issues.length, 0);
    assert.deepEqual(result, [
      { name: 'portfolio', label: 'Portfolio', unit: 'portfolio.service', critical: false },
    ]);
  });

  test('falls back to the name when no label is given', () => {
    const { result } = normalize(normalizeServices, [{ name: 'web', unit: 'web.service' }]);
    assert.equal(result[0]?.label, 'web');
  });

  test('rejects a unit that is a path rather than a unit name', () => {
    const { result, errors } = normalize(normalizeServices, [
      { name: 'evil', unit: '../../etc/passwd' },
    ]);

    assert.equal(result.length, 0);
    assert.match(errors[0]?.message ?? '', /Invalid unit/);
  });

  test('accepts a capitalised name matching the unit file', () => {
    // Unit files are routinely capitalised (WebApp.service), and naming
    // the entry after its unit is the obvious thing to write.
    const { result, issues } = normalize(normalizeServices, [
      { name: 'WebApp', unit: 'WebApp.service' },
      { name: 'MonitorApp', unit: 'MonitorApp.service' },
    ]);

    assert.equal(issues.length, 0);
    assert.deepEqual(
      result.map((service) => service.name),
      ['WebApp', 'MonitorApp'],
    );
  });

  test('rejects names that are not safe option values', () => {
    const { result } = normalize(normalizeServices, [
      { name: 'BAD NAME', unit: 'a.service' }, // whitespace
      { name: 'x'.repeat(80), unit: 'b.service' }, // too long
      { name: '-leading', unit: 'c.service' }, // must start alphanumeric
      { name: 'has/slash', unit: 'd.service' },
      { unit: 'e.service' }, // missing entirely
    ]);

    assert.equal(result.length, 0);
  });

  test('treats names differing only by case as duplicates', () => {
    // Lookups are case-insensitive, so allowing both would make
    // findService("web") silently pick one of them.
    const { result, errors } = normalize(normalizeServices, [
      { name: 'Web', unit: 'first.service' },
      { name: 'web', unit: 'second.service' },
    ]);

    assert.equal(result.length, 1);
    assert.equal(result[0]?.unit, 'first.service');
    assert.match(errors[0]?.message ?? '', /Duplicate/);
  });

  test('keeps the first of two entries sharing a name', () => {
    const { result, errors } = normalize(normalizeServices, [
      { name: 'dup', unit: 'first.service' },
      { name: 'dup', unit: 'second.service' },
    ]);

    assert.equal(result.length, 1);
    assert.equal(result[0]?.unit, 'first.service');
    assert.match(errors[0]?.message ?? '', /Duplicate/);
  });

  test('survives entries that are not objects', () => {
    const { result } = normalize(normalizeServices, ['nope', 42, null]);
    assert.equal(result.length, 0);
  });

  test('ignores a section that is not an array', () => {
    const { result, errors } = normalize(normalizeServices, { name: 'oops' });
    assert.equal(result.length, 0);
    assert.equal(errors.length, 1);
  });
});

describe('normalizeWebsites', () => {
  test('applies defaults for the optional fields', () => {
    const { result } = normalize(normalizeWebsites, [
      { name: 'portfolio', url: 'https://example.com' },
    ]);

    assert.equal(result[0]?.expectStatus, 200);
    assert.equal(result[0]?.timeoutMs, 8000);
    assert.equal(result[0]?.checkCert, true);
  });

  test('never enables certificate checks for plain http', () => {
    const { result } = normalize(normalizeWebsites, [
      { name: 'internal', url: 'http://10.0.0.5:3000', checkCert: true },
    ]);

    assert.equal(result[0]?.checkCert, false);
  });

  test('rejects unsupported protocols and unparseable urls', () => {
    const { result } = normalize(normalizeWebsites, [
      { name: 'ftp', url: 'ftp://example.com' },
      { name: 'junk', url: 'not a url' },
    ]);

    assert.equal(result.length, 0);
  });

  test('clamps out-of-range numbers to the default instead of failing', () => {
    const { result, issues } = normalize(normalizeWebsites, [
      { name: 'site', url: 'https://example.com', expectStatus: 999, timeoutMs: 1 },
    ]);

    assert.equal(result[0]?.expectStatus, 200);
    assert.equal(result[0]?.timeoutMs, 8000);
    assert.equal(
      issues.every((issue) => issue.level === 'warning'),
      true,
    );
  });
});

describe('normalizeCommands', () => {
  test('rejects a shell line masquerading as an executable', () => {
    const { result, errors } = normalize(normalizeCommands, [
      { name: 'pwn', command: 'rm -rf / && echo done' },
    ]);

    assert.equal(result.length, 0);
    assert.match(errors[0]?.message ?? '', /single executable/);
  });

  test('rejects shell metacharacters individually', () => {
    for (const command of ['a;b', 'a|b', 'a`b`', 'a$(b)', 'a>b', 'a&b']) {
      const { result } = normalize(normalizeCommands, [{ name: 'x', command }]);
      assert.equal(result.length, 0, `should have rejected ${command}`);
    }
  });

  test('defaults to the safe side for every optional flag', () => {
    const { result } = normalize(normalizeCommands, [{ name: 'disk', command: 'df' }]);

    assert.equal(result[0]?.allowArgs, false);
    assert.equal(result[0]?.sudo, false);
    assert.equal(result[0]?.confirm, false);
    assert.deepEqual(result[0]?.args, []);
  });

  test('drops an args array that is not all strings', () => {
    const { result } = normalize(normalizeCommands, [
      { name: 'x', command: 'df', args: ['-h', 5] },
    ]);

    assert.deepEqual(result[0]?.args, []);
  });
});

describe('normalizeFiles', () => {
  test('requires an absolute path', () => {
    const { result } = normalize(normalizeFiles, [{ name: 'rel', path: 'logs/app.log' }]);
    assert.equal(result.length, 0);
  });

  test('rejects traversal segments even in an absolute path', () => {
    const { result, errors } = normalize(normalizeFiles, [
      { name: 'esc', path: '/var/log/../../etc/shadow' },
    ]);

    assert.equal(result.length, 0);
    assert.match(errors[0]?.message ?? '', /must not contain/);
  });

  test('clamps maxLines into range', () => {
    const { result } = normalize(normalizeFiles, [
      { name: 'log', path: '/var/log/syslog', maxLines: 99999 },
    ]);

    assert.equal(result[0]?.maxLines, 200);
  });
});

describe('normalizeMonitor', () => {
  test('produces a complete config from an empty object', () => {
    const { result } = normalize(normalizeMonitor, {});

    assert.equal(result.enabled, true);
    assert.equal(result.intervalSeconds, 60);
    assert.equal(result.thresholds.cpuPercent, 85);
    assert.equal(result.checks.certificates, true);
    assert.equal(result.historyHours, 24);
  });

  test('rejects an interval that would hammer the host', () => {
    const { result } = normalize(normalizeMonitor, { intervalSeconds: 1 });
    assert.equal(result.intervalSeconds, 60);
  });

  test('keeps valid overrides', () => {
    const { result } = normalize(normalizeMonitor, {
      intervalSeconds: 120,
      checks: { certificates: false },
      thresholds: { cpuPercent: 70 },
      ignoreMounts: ['/snap'],
    });

    assert.equal(result.intervalSeconds, 120);
    assert.equal(result.checks.certificates, false);
    assert.equal(result.checks.resources, true);
    assert.equal(result.thresholds.cpuPercent, 70);
    assert.deepEqual(result.ignoreMounts, ['/snap']);
  });
});

describe('checkReferences', () => {
  test('warns about a site pointing at a service that does not exist', () => {
    const issues: ConfigIssue[] = [];
    checkReferences(
      [
        {
          name: 'site',
          label: 'Site',
          url: 'https://example.com',
          expectStatus: 200,
          timeoutMs: 8000,
          checkCert: true,
          service: 'ghost',
        },
      ],
      [],
      issues,
    );

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.level, 'warning');
  });

  test('resolves a service reference regardless of case', () => {
    const issues: ConfigIssue[] = [];
    checkReferences(
      [
        {
          name: 'WebApp',
          label: 'Web app',
          url: 'https://example.com',
          expectStatus: 200,
          timeoutMs: 8000,
          checkCert: true,
          service: 'webapp',
        },
      ],
      [{ name: 'WebApp', label: 'Web app', unit: 'WebApp.service' }],
      issues,
    );

    assert.equal(issues.length, 0);
  });

  test('stays quiet when the reference resolves', () => {
    const issues: ConfigIssue[] = [];
    checkReferences(
      [
        {
          name: 'site',
          label: 'Site',
          url: 'https://example.com',
          expectStatus: 200,
          timeoutMs: 8000,
          checkCert: true,
          service: 'real',
        },
      ],
      [{ name: 'real', label: 'Real', unit: 'real.service' }],
      issues,
    );

    assert.equal(issues.length, 0);
  });
});
