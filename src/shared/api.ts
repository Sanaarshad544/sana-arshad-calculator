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
  inviteCode: string;
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

export interface DashboardDto {
  owe: CurrencyTotal[];
  owed: CurrencyTotal[];
  groups: GroupSummary[];
  soloBills: SoloBillSummary[];
}

export type JoinResult =
  | { status: 'rejoined'; groupId: string }
  | {
      status: 'choose';
      groupId: string;
      groupName: string;
      choices: { memberId: string; name: string; removed: boolean }[];
    };
