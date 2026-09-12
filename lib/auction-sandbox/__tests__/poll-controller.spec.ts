/**
 * AUCTION SANDBOX — PollController regressions.
 * Covers: no concurrent polls, poll timeout leash, suspend/resume,
 * drain-with-timeout, orphan hold (mutations refused, reads continue),
 * settle refresh, cap backstop, no blind retry.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  DRAIN_TIMEOUT_MESSAGE,
  PollController,
  ReconcilingError,
  TimeoutError,
  isNextRedirect,
  withTimeout,
} from '../poll-controller';

function deferred<T = void>() {
  let resolve!: (v: T | PromiseLike<T>) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('withTimeout', () => {
  it('resolves normally when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'x')).resolves.toBe(42);
  });

  it('rejects with TimeoutError when the promise hangs', async () => {
    const hanging = new Promise(() => {});
    await expect(withTimeout(hanging, 20, 'start')).rejects.toBeInstanceOf(TimeoutError);
  });

  it('does not swallow the original rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'x')).rejects.toThrow('boom');
  });
});

describe('isNextRedirect', () => {
  it('detects redirect digests and nothing else', () => {
    expect(isNextRedirect({ digest: 'NEXT_REDIRECT;replace;/login' })).toBe(true);
    expect(isNextRedirect(new Error('x'))).toBe(false);
    expect(isNextRedirect(null)).toBe(false);
    expect(isNextRedirect('NEXT_REDIRECT')).toBe(false);
  });
});

describe('PollController', () => {
  it('never runs two polls concurrently (second tick is skipped)', async () => {
    const gate = deferred();
    let calls = 0;
    const ctl = new PollController(
      async () => {
        calls += 1;
        await gate.promise;
      },
      { intervalMs: 1000 }
    );
    const first = ctl.tick();
    const second = await ctl.tick();
    expect(second).toBe('skipped');
    expect(calls).toBe(1);
    gate.resolve();
    expect(await first).toBe('polled');
    expect(ctl.stats).toEqual({ polls: 1, skipped: 1 });
  });

  it('a hung poll cannot wedge the heartbeat (timeout leash + retry)', async () => {
    let calls = 0;
    const ctl = new PollController(
      async () => {
        calls += 1;
        if (calls === 1) await new Promise(() => {}); // hang once
      },
      { intervalMs: 1000, pollTimeoutMs: 30 }
    );
    await ctl.tick(); // resolves despite the hang
    expect(calls).toBe(1);
    expect(ctl.lastPollError).toBeInstanceOf(TimeoutError);
    expect(await ctl.tick()).toBe('polled'); // recovers on next tick
    expect(calls).toBe(2);
  });

  it('suspend blocks ticks until resumed', async () => {
    const poll = vi.fn(async () => {});
    const ctl = new PollController(poll, { intervalMs: 1000 });
    ctl.suspend();
    ctl.suspend();
    expect(await ctl.tick()).toBe('skipped');
    ctl.resume();
    expect(await ctl.tick()).toBe('skipped');
    ctl.resume();
    expect(await ctl.tick()).toBe('polled');
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('runMutation suspends polling, then refreshes exactly once', async () => {
    const order: string[] = [];
    const ctl = new PollController(
      async () => {
        order.push('poll');
      },
      { intervalMs: 1000 }
    );
    const result = await ctl.runMutation(
      async () => {
        order.push('mutation');
        expect(ctl.isSuspended).toBe(true);
        return 'ok';
      },
      5000,
      'start'
    );
    expect(result).toEqual({ status: 'done', value: 'ok' });
    expect(order).toEqual(['mutation', 'poll']);
    expect(ctl.isSuspended).toBe(false);
  });

  it('GAP1: mutation waits for the in-flight poll — never overlaps', async () => {
    const order: string[] = [];
    const gate = deferred();
    const ctl = new PollController(
      async () => {
        order.push('poll-start');
        await gate.promise;
        order.push('poll-end');
      },
      { intervalMs: 1000 }
    );
    const polling = ctl.tick(); // in-flight, blocked on gate
    void polling;
    await new Promise((r) => setTimeout(r, 10)); // let the poll actually start
    const mutating = ctl.runMutation(
      async () => {
        order.push('mutation-start');
        return 'ok';
      },
      5000,
      'Start'
    );
    await new Promise((r) => setTimeout(r, 30));
    // Mutation must NOT have started while the poll is in flight.
    expect(order).toEqual(['poll-start']);
    gate.resolve();
    const result = await mutating;
    expect(result).toEqual({ status: 'done', value: 'ok' });
    // Strict order: initial poll fully ends → mutation runs → single refresh
    // poll (which itself pushes start/end markers).
    expect(order).toEqual(['poll-start', 'poll-end', 'mutation-start', 'poll-start', 'poll-end']);
  });

  it('GAP2-drain: stuck poll blocks the mutation (no overlap, visible guidance)', async () => {
    const order: string[] = [];
    const ctl = new PollController(
      async () => {
        order.push('poll-start');
        await new Promise(() => {}); // stuck forever
      },
      { intervalMs: 1000 }
    );
    const polling = ctl.tick(); // in-flight, never settles
    void polling;
    await new Promise((r) => setTimeout(r, 10));
    let mutationStarted = false;
    const result = await ctl.runMutation(
      async () => {
        mutationStarted = true;
        return 'x';
      },
      5000,
      'Iniciar subasta',
      { drainTimeoutMs: 30 }
    );
    expect(mutationStarted).toBe(false);
    expect(result.status).toBe('unknown');
    if (result.status === 'unknown') {
      expect(result.detail).toContain('Recargá');
    }
    expect(order).toEqual(['poll-start']);
    // NOTE: `polling` intentionally left pending (stuck poll simulation).
  });

  it('drain-unknown never locks retries: nothing ran, so retry is immediately allowed', async () => {
    const ctl = new PollController(
      async () => {
        await new Promise(() => {}); // stuck forever
      },
      { intervalMs: 1000 }
    );
    const stuck = ctl.tick();
    void stuck;
    await new Promise((r) => setTimeout(r, 10));
    const first = await ctl.runMutation(async () => 'x', 5000, 'Start', { drainTimeoutMs: 20 });
    expect(first.status).toBe('unknown');
    // No orphan was raised (mutation never started): no ReconcilingError.
    expect(ctl.hasUnsettledMutation).toBe(false);
    const second = await ctl.runMutation(async () => 'y', 5000, 'Start', { drainTimeoutMs: 20 });
    expect(second).toEqual({ status: 'unknown', label: 'Start', elapsedMs: 20, detail: expect.stringContaining('Recargá') });
  });

  it('GAP3: timeout holds mutations, keeps reads flowing, refreshes on settle', async () => {
    const order: string[] = [];
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const ctl = new PollController(
      async () => {
        order.push('poll');
      },
      { intervalMs: 1000 }
    );
    const slowMutation = async () => {
      calls += 1;
      order.push(`mutation-${calls}-start`);
      await gate;
      order.push(`mutation-${calls}-end`);
      return `v${calls}`;
    };
    const settled: string[] = [];
    ctl.onOrphanSettled = () => settled.push('settled');

    const first = await ctl.runMutation(slowMutation, 20, 'Iniciar subasta');
    expect(first.status).toBe('unknown');
    expect(calls).toBe(1);
    expect(ctl.hasUnsettledMutation).toBe(true);
    // Reads keep flowing while the orphan is pending (reconciliation).
    expect(await ctl.tick()).toBe('polled');
    expect(order).toEqual(['mutation-1-start', 'poll']);
    // ...but new mutations are refused (never a blind retry).
    let secondStarted = false;
    await expect(
      ctl.runMutation(
        async () => {
          secondStarted = true;
          return 'x';
        },
        5000,
        'Iniciar subasta'
      )
    ).rejects.toBeInstanceOf(ReconcilingError);
    expect(secondStarted).toBe(false);
    // The orphan settles later: exactly one refresh, hold cleared, notified.
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(['mutation-1-start', 'poll', 'mutation-1-end', 'poll']);
    expect(settled).toEqual(['settled']);
    expect(ctl.hasUnsettledMutation).toBe(false);
    expect(calls).toBe(1); // never duplicated
    // Operator-initiated retry after settle is a NEW explicit call.
    const retry = await ctl.runMutation(
      async () => {
        calls += 1;
        return 'v2';
      },
      5000,
      'Iniciar subasta'
    );
    expect(retry).toEqual({ status: 'done', value: 'v2' });
    expect(calls).toBe(2);
  });

  it('runMutation propagates mutation errors and still refreshes', async () => {
    const order: string[] = [];
    const ctl = new PollController(
      async () => {
        order.push('poll');
      },
      { intervalMs: 1000 }
    );
    await expect(
      ctl.runMutation(async () => {
        throw new Error('Error de conexión.');
      }, 5000, 'x')
    ).rejects.toThrow('Error de conexión.');
    expect(order).toEqual(['poll']);
    expect(ctl.isSuspended).toBe(false);
  });

  it('start is idempotent and stop halts the timer', () => {
    vi.useFakeTimers();
    try {
      const poll = vi.fn(async () => {});
      const ctl = new PollController(poll, { intervalMs: 1000 });
      ctl.start();
      ctl.start();
      expect(ctl.isRunning).toBe(true);
      ctl.stop();
      expect(ctl.isRunning).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
