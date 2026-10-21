import { describe, expect, it } from 'vitest';
import { createLimiter, waitAfter } from '../../server/limits.js';
import { tooManyTries } from '../../shared/rules.js';

describe('A: at most a few password checks at once', () => {
  it('runs at most 4 at a time and turns away the overflow', async () => {
    const run = createLimiter(4, 2);
    let active = 0;
    let peak = 0;
    const task = () =>
      new Promise<void>((resolve) => {
        active += 1;
        peak = Math.max(peak, active);
        setTimeout(() => {
          active -= 1;
          resolve();
        }, 20);
      });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => run(task)));
    expect(peak).toBe(4);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(6);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(2);
    expect(rejected[0].reason.status).toBe(503);
    expect(rejected[0].reason.message).toBe('The app is busy right now. Try again in a moment.');
  });
});

describe('B: the wait schedule', () => {
  it('5 free tries, then 30 s, 1 min, 2 min, 5 min, then 15 min', () => {
    expect([1, 2, 3, 4].map(waitAfter)).toEqual([0, 0, 0, 0]);
    expect([5, 6, 7, 8, 9, 10, 50].map(waitAfter)).toEqual([30, 60, 120, 300, 900, 900, 900]);
  });

  it('says the wait in plain words', () => {
    expect(tooManyTries(30)).toBe('Too many wrong tries. Wait 30 seconds and try again.');
    expect(tooManyTries(1)).toBe('Too many wrong tries. Wait 1 second and try again.');
    expect(tooManyTries(60)).toBe('Too many wrong tries. Wait 1 minute and try again.');
    expect(tooManyTries(61)).toBe('Too many wrong tries. Wait 2 minutes and try again.');
    expect(tooManyTries(900)).toBe('Too many wrong tries. Wait 15 minutes and try again.');
  });
});
