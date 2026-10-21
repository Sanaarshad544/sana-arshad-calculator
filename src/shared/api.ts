// Shapes of the JSON the server sends and receives. Ids are strings.

import type { BillInput, GroupBillInput, Share, SplitMode, Totals } from './bill.js';
import type { Payment } from './balances.js';

export type Theme = 'device' | 'light' | 'dark';

export interface Account {
  username: string;
  theme: Theme;
}

export interface SoloBillSummary {
  id: string;
  name: string;
  date: string;
  currency: string;
  totalCents: number;
}

export interface SoloBillDetail extends SoloBillSummary {
  input: BillInput;
  totals: Totals;
}

export interface MemberDto {
  id: string;
  name: string;
  status: 'current' | 'removed';
  hasAccount: boolean;
  isMe: boolean;
  balanceCents: number;
  /**
   * This person's own invite code while they haven't joined, when I may share it:
   * only members who are in every group the person is in see it. Otherwise null.
   */
  inviteCode: string | null;
  /**
   * Why someone who hasn't joined shows no code:
   * 'elsewhere' – their invite also opens a group I'm not in, so someone in all their groups must send it;
   * 'joined' – they joined with their invite, and their account was already in this group under another name.
   */
  inviteNote: 'elsewhere' | 'joined' | null;
  /** With 'joined': the name their account has in this group, if known. */
  alsoHereAs: string | null;
}

export interface GroupSummary {
  id: string;
  name: string;
  currency: string;
  myBalanceCents: number;
}

export interface GroupDetail {
  id: string;
  name: string;
  currency: string;
  meId: string;
  /** Current members first (in the order they were added), then removed members. */
  members: MemberDto[];
  suggestions: Payment[];
  /** True when I'm the only current member with an account. */
  iAmLastAccount: boolean;
}

export interface GroupBillSummary {
  id: string;
  name: string;
  date: string;
  splitMode: SplitMode;
  payerId: string;
  participantIds: string[];
  totalCents: number;
  /** Name of a removed member on this bill, which makes it view-only; null if none. */
  lockedBy: string | null;
}

export interface GroupBillDetail extends GroupBillSummary {
  input: GroupBillInput;
  totals: Totals;
  shares: Share[];
}

export interface SettleUpDto {
  id: string;
  fromId: string;
  toId: string;
  amountCents: number;
  date: string;
  lockedBy: string | null;
}

export interface ActivityDto {
  id: string;
  actorName: string;
  message: string;
  at: string;
}

export interface CurrencyTotal {
  currency: string;
  cents: number;
}

/** One suggested payment that involves me: "You owe Ali Rs 400.00 · QA Trip". */
export interface MyDebt {
  groupId: string;
  groupName: string;
  currency: string;
  otherName: string;
  cents: number;
  direction: 'owe' | 'owed';
}

export interface DashboardDto {
  owe: CurrencyTotal[];
  owed: CurrencyTotal[];
  debts: MyDebt[];
  groups: GroupSummary[];
  soloBills: SoloBillSummary[];
}

/** Someone from my other groups who can be added to a group. */
export interface PersonOption {
  /** "p:<person id>" for a name-only person, "a:<account id>" for someone with an account. */
  key: string;
  name: string;
  hasAccount: boolean;
  groups: string[];
}

/** What an invite link shows before joining. A used invite shows nothing else (empty name and groups). */
export interface InviteInfo {
  name: string;
  /** The groups the person is in now. */
  groups: string[];
  used: boolean;
  /** The logged-in viewer is already in every one of the person's groups (so it's not their invite). */
  viewerAlreadyIn: boolean;
  /** Which of those groups the logged-in viewer is already in. */
  viewerGroups: string[];
}

/** What happened when an invite was used. */
export interface InviteResult {
  joined: string[];
  removed: string[];
  alreadyIn: string[];
}
