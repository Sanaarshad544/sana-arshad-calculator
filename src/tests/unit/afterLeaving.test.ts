// The red corner message for a change that failed after its page was left (US-37 #7).
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../shared/rules.js';
import { ApiError } from '../../client/api.js';
import { failedAfterLeaving } from '../../client/hooks.js';

describe('US-37 #7 failedAfterLeaving', () => {
  it('says to check the connection when the server could not be reached', () => {
    expect(failedAfterLeaving('Bill not saved.', new ApiError(0, MESSAGES.offline))).toBe('Bill not saved. Check your connection.');
    expect(failedAfterLeaving('Bill not saved.', new ApiError(500, MESSAGES.offline))).toBe('Bill not saved. Check your connection.');
  });

  it('says the database is unreachable without claiming a save failed, whatever the change was', () => {
    const err = new ApiError(503, "Couldn't save — the database isn't reachable. Try again in a moment.", {}, 'DB_DOWN');
    expect(failedAfterLeaving('Payment not deleted.', err)).toBe("Payment not deleted. The app can't reach its database. Try again in a moment.");
  });

  it("gives a field's own message when the server rejected a field", () => {
    const err = new ApiError(400, 'Please fix the highlighted fields', { payer: 'The payer must be one of the people on this bill' });
    expect(failedAfterLeaving('Bill not saved.', err)).toBe('Bill not saved. The payer must be one of the people on this bill');
  });

  it("otherwise gives the server's message, and treats anything else as a connection problem", () => {
    expect(failedAfterLeaving('Payment not recorded.', new ApiError(409, 'Restore Omar to change this bill'))).toBe(
      'Payment not recorded. Restore Omar to change this bill',
    );
    expect(failedAfterLeaving('Group not created.', new Error('boom'))).toBe('Group not created. Check your connection.');
  });
});
