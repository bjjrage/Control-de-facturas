/**
 * AUCTION SANDBOX — PollController regressions.
 * Covers: no concurrent polls, suspend/resume, mutation timeout + single
 * refresh, withTimeout semantics.
 */
import { describe, it, expect, vi } from 'vitest';
import { PollController, TimeoutError, withTimeout } from '../poll-controller';

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

  it('runMutation timeout resolves unknown (never throws), resumes, refreshes once', async () => {
    const order: string[] = [];
    const ctl = new PollController(
      async () => {
        order.push('poll');
      },
      { intervalMs: 1000 }
    );
    const result = await ctl.runMutation(() => new Promise<string>(() => {}), 20, 'Iniciar subasta');
    expect(result.status).toBe('unknown');
    if (result.status === 'unknown') {
      expect(result.label).toBe('Iniciar subasta');
      expect(result.elapsedMs).toBe(20);
    }
    expect(order).toEqual(['poll']);
    expect(ctl.isSuspended).toBe(false);
    // polling works again after the timeout
    expect(await ctl.tick()).toBe('polled');
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
    await polling;
    expect(result).toEqual({ status: 'done', value: 'ok' });
    // Strict order: initial poll fully ends → mutation runs → single refresh
    // poll (which itself pushes start/end markers).
    expect(order).toEqual(['poll-start', 'poll-end', 'mutation-start', 'poll-start', 'poll-end']);
  });

  it('GAP2: slow mutation times out unknown, completes later without duplication', async () => {
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
    const first = await ctl.runMutation(slowMutation, 20, 'Iniciar subasta');
    expect(first.status).toBe('unknown');
    expect(calls).toBe(1);
    // The timed-out mutation completes later on its own — exactly once.
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['mutation-1-start', 'poll', 'mutation-1-end']);
    expect(calls).toBe(1);
    // Operator-initiated retry is a NEW explicit call (never automatic).
    const second = await ctl.runMutation(
      async () => {
        calls += 1;
        return 'v2';
      },
      5000,
      'Iniciar subasta'
    );
    expect(second).toEqual({ status: 'done', value: 'v2' });
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
