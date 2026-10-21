// Limits, names, currency and account rules shared by the page and the server.

export const MAX_ITEMS = 200;
export const MAX_GROUP_MEMBERS = 50;

export const CURRENCIES = ['$', '€', '£', '¥', '₹', 'Rs', 'PKR', '₩', '₺', 'R$', 'CHF', 'AED', 'SAR'] as const;

export const MESSAGES = {
  currency: 'Enter a currency symbol of up to 3 characters, with no digits',
  groupName: 'Enter a group name of up to 50 characters',
  memberName: 'Enter a name of up to 30 characters',
  nameUsed: 'That name has already been used in this group',
  groupFull: 'A group can have at most 50 members',
  billName: 'Bill name can be at most 60 characters',
  itemName: 'Item name can be at most 40 characters',
  noItems: 'Add at least one item',
  tooManyItems: 'A bill can have at most 200 items',
  price: 'Price must be between 0.01 and 1,000,000.00, with at most 2 decimal places',
  taxAmount: 'Tax must be between 0.00 and 1,000,000.00, with at most 2 decimal places',
  taxPercent: 'Tax must be between 0% and 100%, with at most 2 decimal places',
  tipAmount: 'Tip must be between 0.00 and 1,000,000.00, with at most 2 decimal places',
  tipPercent: 'Tip must be between 0% and 100%, with at most 2 decimal places',
  otherAmount: 'Other charges must be between 0.01 and 1,000,000.00, or left empty',
  otherPercent: 'Other charges must be between 0.01% and 100%, or left empty',
  noParticipants: 'Choose who took part',
  noPayer: 'Choose who paid',
  payerNotParticipant: 'The payer must be one of the people on this bill',
  noSharers: 'Choose who shared this item',
  sharerNotParticipant: 'Only people on this bill can share an item',
  settleAmount: 'Amount must be between 0.01 and 1,000,000.00, with at most 2 decimal places',
  settleSamePerson: 'Choose two different people',
  settlePeople: 'Choose who paid and who received the payment',
  username: 'Enter a username of 3 to 30 English letters, numbers or underscores, like omar_99',
  passwordShort: 'Password must be at least 8 characters',
  passwordLong: 'Password can be at most 128 characters',
  usernameTaken: 'That username is taken',
  loginFailed: 'Username or password is incorrect',
  resetFailed: 'Username or recovery code is incorrect',
  inviteInvalid: "That invite link isn't valid. Check the code and try again.",
  inviteUsed: 'This invite has already been used',
  inviteForSomeoneElse: "You're already in these groups, so this invite is for someone else. Send them the link.",
  notYourPerson: 'Choose someone from your other groups',
  alreadyMember: 'That person is already in this group',
  settleBeforeRemove: "Settle this member's balance before removing them",
  settleBeforeLeave: 'Settle your balance before leaving',
  groupGone: 'This group no longer exists',
  noAccess: "You don't have access to this group",
  noLongerAccess: 'You no longer have access to this group',
  lastAccountWarning:
    "You're the last member with an account. If you leave, this group and all its bills, settle-ups and history will be permanently deleted. Unsettled balances will be lost.",
  offline: "Couldn't save — check your connection",
  busy: 'The app is busy right now. Try again in a moment.',
} as const;

/** "Too many wrong tries. Wait 30 seconds and try again." (minutes from 1 minute up). */
export function tooManyTries(seconds: number): string {
  const wait =
    seconds < 60
      ? `${seconds} second${seconds === 1 ? '' : 's'}`
      : `${Math.ceil(seconds / 60)} minute${Math.ceil(seconds / 60) === 1 ? '' : 's'}`;
  return `Too many wrong tries. Wait ${wait} and try again.`;
}

export function restoreToChange(name: string): string {
  return `Restore ${name} to change this bill`;
}

export function groupFullRestore(name: string): string {
  return `This group already has 50 members, so ${name} can't be restored`;
}

/** Counts characters the way people do (so "zł" is 2, not bytes). */
export function charCount(text: string): number {
  return Array.from(text).length;
}

export type Check<T> = { ok: true; value: T } | { ok: false; message: string };

export function checkCurrency(raw: string): Check<string> {
  const symbol = raw.trim();
  const n = charCount(symbol);
  if (n < 1 || n > 3 || /\p{Nd}/u.test(symbol) || /\p{Cc}/u.test(symbol)) {
    return { ok: false, message: MESSAGES.currency };
  }
  // A listed symbol typed in other letters ("pkr") is written the listed way ("PKR").
  const listed = CURRENCIES.find((c) => c.toLowerCase() === symbol.toLowerCase());
  return { ok: true, value: listed ?? symbol };
}

export function checkGroupName(raw: string): Check<string> {
  const name = raw.trim();
  const n = charCount(name);
  return n >= 1 && n <= 50 ? { ok: true, value: name } : { ok: false, message: MESSAGES.groupName };
}

export function checkMemberName(raw: string): Check<string> {
  const name = raw.trim();
  const n = charCount(name);
  return n >= 1 && n <= 30 ? { ok: true, value: name } : { ok: false, message: MESSAGES.memberName };
}

/** Compares member names the way the app does: trimmed, not case-sensitive. */
export function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase('en-US');
}

const USERNAME = /^[A-Za-z0-9_]{3,30}$/;

export function checkUsername(raw: string): Check<string> {
  const name = raw.trim();
  return USERNAME.test(name) ? { ok: true, value: name } : { ok: false, message: MESSAGES.username };
}

export function checkPassword(raw: string): Check<string> {
  const n = charCount(raw);
  if (n < 8) return { ok: false, message: MESSAGES.passwordShort };
  if (n > 128) return { ok: false, message: MESSAGES.passwordLong };
  return { ok: true, value: raw };
}

/** Invite codes are compared without spaces or dashes and in capitals. */
export function normalizeInviteCode(code: unknown): string {
  return String(code ?? '').toUpperCase().replace(/[\s-]/g, '');
}

/** "ABCDEFGHJKLM" -> ["ABCD", "EFGH", "JKLM"]: shown in groups of four so it's easy to read out. */
export function inviteCodeGroups(code: string): string[] {
  return code.match(/.{1,4}/g) ?? [code];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-21" -> "21 Oct 2026". */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Default bill name: "Bill – 21 Oct 2026". */
export function defaultBillName(isoDate: string): string {
  return `Bill – ${formatDate(isoDate)}`;
}
