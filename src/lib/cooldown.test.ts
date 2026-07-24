import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { consumeCooldown, resetCooldowns } from './cooldown.js';

describe('consumeCooldown', () => {
  beforeEach(() => {
    resetCooldowns();
  });

  test('allows the first call', () => {
    assert.deepEqual(consumeCooldown('status', 'user-1', 5), {
      limited: false,
      secondsLeft: 0,
    });
  });

  test('blocks an immediate repeat by the same user', () => {
    consumeCooldown('status', 'user-1', 5);
    const second = consumeCooldown('status', 'user-1', 5);

    assert.equal(second.limited, true);
    assert.ok(second.secondsLeft > 0 && second.secondsLeft <= 5);
  });

  test('tracks users independently', () => {
    consumeCooldown('status', 'user-1', 5);

    assert.equal(consumeCooldown('status', 'user-2', 5).limited, false);
  });

  test('tracks commands independently', () => {
    consumeCooldown('status', 'user-1', 5);

    assert.equal(consumeCooldown('top', 'user-1', 5).limited, false);
  });

  test('is disabled at zero or below', () => {
    for (let i = 0; i < 5; i += 1) {
      assert.equal(consumeCooldown('ping', 'user-1', 0).limited, false);
    }
    assert.equal(consumeCooldown('ping', 'user-1', -1).limited, false);
  });

  test('allows the call again once the window passes', async () => {
    // A 1-second cooldown keeps the test fast while still exercising expiry.
    consumeCooldown('sites', 'user-1', 1);
    assert.equal(consumeCooldown('sites', 'user-1', 1).limited, true);

    await new Promise((resolve) => setTimeout(resolve, 1050));

    assert.equal(consumeCooldown('sites', 'user-1', 1).limited, false);
  });
});
