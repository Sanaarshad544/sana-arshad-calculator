# User Stories

How Bill Splitter helps each role get their jobs done. Every story names its role (from [app-roles.md](app-roles.md)) and the job it serves (from [jobs-to-be-done.md](jobs-to-be-done.md)), and has testable acceptance criteria and a status.

## How to read this file

- **Template:** "As a [role], I want [capability], so that [benefit]."
- **Acceptance criteria:** written as "Given [starting state], when [action], then [observable result]". They cover:
  - the normal case
  - invalid input
  - boundary values
  - very large and very small numbers
  - what happens when the user carries on after a result or an error
- **Status:** **Implemented** means the running app does exactly what every criterion says today, proven by the checks listed under "Implementation progress". **Not implemented** means it doesn't yet, or not every criterion is proven.
- **Money format:** amounts are shown with 2 decimals and the bill's or group's currency symbol. The examples below leave out the symbol.

## Shared rules used by many stories

These rules come from the spec and apply wherever a story mentions them.

- **Money fields** (item prices, settle-up amounts): 0.01–1,000,000.00, at most 2 decimal places. No negatives, letters, blanks or extra decimals.
- **Per-field limit:** the 1,000,000.00 limit applies to each field on its own. A bill's items subtotal and grand total may be larger.
- **Items:** every bill (solo, equal or itemized) needs 1–200 items. The largest possible grand total is 1,000,000,000.00, and it is still exact to the cent.
- **Names** (spaces at the start and end are trimmed before checking):
  - Group name: required, at most 50 characters.
  - Member name: required, at most 30 characters, and unique within a group: it can't match any other member, current or removed. Not case-sensitive: "omar" clashes with "Omar". Renaming a member frees their old name.
  - Bill name: optional, up to 60 characters, defaulting to "Bill – date".
  - Item name: optional, up to 40 characters, defaulting to "Item 1", "Item 2" and so on.
- **Tax and tip:** each can be a **%** (0–100, at most 2 decimal places, e.g. 12.5 or 8.25) or an **amount** (0.00–1,000,000.00). Both boxes start empty, and a blank tax or tip means 0.
- **Other charges** (optional, one field per bill, always labelled "Other charges", for service, delivery or table fees and similar):
  - Blank, 0 or 0.00 means "no other charges", and the results show "Other charges 0.00".
  - As an amount: 0.01–1,000,000.00, at most 2 decimal places.
  - As a %: 0.01–100, at most 2 decimal places.
- **What each % is of:**
  - Tax % and other charges % are always of the **items subtotal** only.
  - Tax is never charged on other charges or tip.
  - A % tip has a per-bill **"tip on"** option: **items only (default)** or **items + tax**. A tip is never calculated on other charges.
- **Rounding:** tax, other charges and tip are each worked out separately in cents. Any % result is rounded half-up to the cent, so it can be 0.00. An "items + tax" tip uses the already-rounded tax. All money math uses whole cents, never floating-point.
- **Grand total** = items subtotal + tax + other charges + tip.
- **Exactness:** for every bill, the shares add up exactly to the grand total.
- **Results:** totals appear only when **Calculate** is pressed. Changing any input hides the old result until Calculate is pressed again.
- **Currency:** a display symbol only, with no conversion. Choose from the list of 13 ($, €, £, ¥, ₹, Rs, PKR, ₩, ₺, R$, CHF, AED, SAR), or choose "Other" and type a symbol of 1 to 3 characters with no digits. A listed symbol typed under "Other" in different letters ("pkr") is saved the listed way ("PKR"). A group's currency can be changed at any time, which relabels every amount without converting it.
- **Accounts:**
  - Username: 3 to 30 English letters, numbers or underscores (like omar_99), not case-sensitive.
  - Password: at least 8 characters (and at most 128), any characters. Every password box has an eye button to show or hide what's typed.
  - A session ends on Log out or after 30 days without use.
  - **Wrong tries:** after 5 wrong passwords in a row for a username, each next try must wait: 30 seconds, then 1, 2 and 5 minutes, then 15 minutes for every try after that. Nobody is ever locked out: once the wait is over, the right password works. The count starts again after a successful login, or after a day without tries. Recovery codes are counted separately in the same way.
- **Group size:** 1 to 50 **current** members. Removed members don't count.
- **People and invites:** everyone added to a group by name is a *person*, and the same person can be added to several groups by picking them from "Or add someone from your other groups". Each person who hasn't joined yet has their own invite code (12 letters and numbers, shown in groups of four, e.g. "K7QM XW3P 9HTD") and link (`/invite/<code>`). Using it once links every group that person is in to one account. There is no group-wide code.
  - **Who can see a code:** one code opens all of that person's groups, so only current members who are in every one of those groups can see, copy and share it. For someone in just one group, that's every current member of it.
  - **When a code changes:** when someone with an account leaves or is removed from a group, everyone in that group who hasn't joined gets a new code. When a person is added to another group that someone who could see their code isn't in, they get a new code too. Old links then show "That invite link isn't valid. Check the code and try again."
  - **A used invite** shows only "This invite has already been used", never whose it was or their groups.
- **Language and number display:**
  - All text is in English.
  - Amounts are shown with a thousands comma and 2 decimals ("1,000,000.00").
  - The currency symbol goes before the amount ("$12.50"), with a space for symbols made of letters ("Rs 400.00", "CHF 12.00").
  - Typing "1,000.50" is accepted as 1000.50, while European style ("1.000,50") is rejected.
- **Layout:** desktop-first, and fully usable on phones down to 360 px wide.

## Implementation progress

- **Last checked:** 22 Oct 2026, against the code in `src/`, after QA round 1 and its security and code reviews.
- **Implemented:** all 40 stories.
- **Retired:** US-24 "Rejoin a group with the invite code" was retired in QA round 1. There is no group-wide code any more, and removed members come back only through Restore (US-23).
- **How it was checked:** `npm test` (run from `src/`) passed twice in a row:
  - 215 unit and server tests.
  - 269 browser tests, each run in Chromium (Chrome and Edge), Firefox and WebKit (Safari), 807 runs in all, with automatic WCAG 2.2 AA checks in light and dark mode.
- **Checks done by hand,** because a test can't stop Docker or install the app from scratch:
  - US-27 #3: stopping the database while the app runs, then starting it again.
  - US-28: `docker compose down` then `docker compose up -d`, and restarting the app.
  - US-30: a fresh copy set up by following the README, and the "Can't reach the database" message.
  - US-31: the production build, its secure login cookie, and a schema update applied to a database that already had data.
  - US-32: real data unchanged after `npm test`, and the database-down message from `npm test`.

Where the tests are (all in `src/tests/`):

| Stories | Tests |
|---|---|
| Money maths, rounding, input checks and wrong-try waits (US-02, US-05, US-13, US-14, US-16, US-17, US-25) | `unit/money.test.ts`, `unit/bill.test.ts`, `unit/limits.test.ts` |
| Server rules for every story | `api/accounts.test.ts`, `api/solo.test.ts`, `api/groups.test.ts`, `api/criteria-*.test.ts`, `api/review-fixes.test.ts`, `api/attempt-limits.test.ts` |
| Personal invites, adding people from other groups, renaming (US-10 to US-12, US-20, US-21, US-39 to US-41) | `api/invites.test.ts`, `e2e/round1-groups.spec.ts`, `e2e/round1-review.spec.ts` |
| Accounts, solo bills and input messages in the browser (US-01 to US-08, US-25 to US-27, US-34, US-35) | `e2e/accounts.spec.ts`, `e2e/solo.spec.ts`, `e2e/criteria-solo.spec.ts`, `e2e/criteria-extra.spec.ts`, `e2e/round1-solo.spec.ts` |
| Groups, bills, balances and settle-ups in the browser (US-09 to US-19) | `e2e/groups.spec.ts`, `e2e/criteria-groups.spec.ts`, `e2e/round1-groups.spec.ts` |
| Members leaving and coming back (US-20 to US-23) | `e2e/groups.spec.ts`, `e2e/criteria-members.spec.ts`, `e2e/round1-members.spec.ts` |
| Dashboard, navigation, appearance, accessibility, feedback and unsaved changes (US-33 to US-38) | `e2e/layout.spec.ts`, `e2e/ux.spec.ts`, `e2e/criteria-members.spec.ts`, `e2e/round1-members.spec.ts` |

Each test's name starts with the story and criterion it proves, for example "US-07 #3".

## Story list

| ID | Story | Role | Job | Status |
|---|---|---|---|---|
| US-01 | Create an account | Solo diner, Group member | J12 | Implemented |
| US-02 | Log in and log out | Solo diner, Group member | J12 | Implemented |
| US-03 | Reset a forgotten password with a recovery code | Solo diner, Group member | J13 | Implemented |
| US-04 | Keep my bills and groups private | Solo diner, Group member | J12 | Implemented |
| US-05 | Total a solo bill | Solo diner | J1 | Implemented |
| US-06 | Choose the currency of a solo bill | Solo diner | J15 | Implemented |
| US-07 | Save a solo bill to my history | Solo diner | J2 | Implemented |
| US-08 | Open, edit and delete saved solo bills | Solo diner | J2 | Implemented |
| US-09 | Create a group | Group member | J6 | Implemented |
| US-10 | Add friends to a group by name | Group member | J8 | Implemented |
| US-11 | Share a friend's own invite | Group member | J8 | Implemented |
| US-12 | Join all my friends' groups with my own invite | Group member | J8 | Implemented |
| US-13 | Record an equal-split group bill | Group member | J3 | Implemented |
| US-14 | Record an itemized group bill | Group member | J4 | Implemented |
| US-15 | Record who paid a group bill | Group member | J5 | Implemented |
| US-16 | See balances and suggested payments | Group member | J6 | Implemented |
| US-17 | Record a settle-up | Group member | J7 | Implemented |
| US-18 | Edit and delete group bills and settle-ups | Group member | J6 | Implemented |
| US-19 | See the group's activity log | Group member | J9 | Implemented |
| US-20 | Remove a member from a group | Group member | J10 | Implemented |
| US-21 | Leave a group | Group member | J10 | Implemented |
| US-22 | Close out a group as the last member with an account | Group member | J11 | Implemented |
| US-23 | Restore a removed member | Group member | J10 | Implemented |
| US-25 | Get a clear message for every invalid input | Solo diner, Group member | J14 | Implemented |
| US-26 | Carry on safely after a result or an error | Solo diner, Group member | J14 | Implemented |
| US-27 | Keep my inputs when saving fails | Solo diner, Group member | J14 | Implemented |
| US-28 | Keep my records after a restart | Solo diner, Group member | J2, J6 | Implemented |
| US-29 | Use the app in my usual browser | Solo diner, Group member | J16 | Implemented |
| US-33 | See my money at a glance on the Dashboard | Solo diner, Group member | J20 | Implemented |
| US-34 | Find my way on a computer or a phone | Solo diner, Group member | J16 | Implemented |
| US-35 | Choose light or dark appearance | Solo diner, Group member | J21 | Implemented |
| US-36 | Use the app with a keyboard, screen reader or zoom | Solo diner, Group member | J22 | Implemented |
| US-37 | Know what happened after every action | Solo diner, Group member | J14 | Implemented |
| US-38 | Don't lose unsaved changes by accident | Solo diner, Group member | J14 | Implemented |
| US-39 | Edit a group's name and currency | Group member | J6 | Implemented |
| US-40 | Rename a member | Group member | J9 | Implemented |
| US-41 | Add someone from my other groups | Group member | J8 | Implemented |
| US-30 | Run the app locally from the README | Host | J17 | Implemented |
| US-31 | Deploy the app to my own server | Host | J18 | Implemented |
| US-32 | Run all tests with one command | Host | J19 | Implemented |

---

## Accounts

### US-01 Create an account
**As a** Solo diner or Group member, **I want** to create an account with a username and password, **so that** my bills and groups are kept for me and nobody else.
- **Job:** J12 · **Status:** Implemented

Acceptance criteria:
1. Given a username nobody has used and a valid password, when I sign up, then my account is created, I'm logged in, and a one-time recovery code is shown with a "save this now" warning.
2. Given I leave the recovery code screen, then that code is never shown again.
3. Given a username that is already taken, when I sign up, then I see "That username is taken" and no account is created.
4. Given "Sana" already exists, when someone signs up as "sana" or "SANA", then they see "That username is taken" (usernames aren't case-sensitive).
5. Given a username that is blank, 2 characters or 31 characters long, or contains anything other than English letters, numbers and underscores (e.g. "sana!" or "sa na"), when I sign up, then I see "Enter a username of 3 to 30 English letters, numbers or underscores, like omar_99" and no account is created. The hint under Username reads "3 to 30 English letters, numbers or underscores, like omar_99".
6. Given a username of exactly 3 or exactly 30 characters, then it's accepted.
7. Given a password that is blank or 7 characters long, when I sign up, then I see "Password must be at least 8 characters". Given 129 characters, I see "Password can be at most 128 characters". Either way no account is created, and the hint under the box reads "At least 8 characters".
8. Given a password of exactly 8 or exactly 128 characters, including spaces and symbols, then it's accepted.
9. Given sign-up failed (e.g. the username was taken), when I fix it and sign up again, then the account is created without reloading the page.
10. The app never asks for an email address or phone number, and never sends email or text messages.
11. Given any password box (sign up, log in, reset), when I press the eye button ("Show password"), then I can see what I typed, and pressing it again ("Hide password") hides it. A shown password isn't capitalised or corrected by phone keyboards.

### US-02 Log in and log out
**As a** Solo diner or Group member, **I want** to log in with my username and password and log out when I'm done, **so that** only I can reach my records, even on a shared computer.
- **Job:** J12 · **Status:** Implemented

Acceptance criteria:
1. Given a correct username and password, when I log in, then I'm logged in and see my own bills and groups.
2. Given a wrong password, when I log in, then I see "Username or password is incorrect" and stay logged out.
3. Given a username that doesn't exist, when I log in, then I see the same message, "Username or password is incorrect", which never says whether the username or the password was wrong.
4. Given a failed login, when I enter the correct details and log in again, then I'm logged in without reloading the page.
5. Given my account is "Sana", when I log in as "sana" or "SANA" with the right password, then I'm logged in.
6. Given 5 wrong passwords in a row, when I try again within 30 seconds, even with the right password, then I see "Too many wrong tries. Wait 30 seconds and try again." and nothing is checked.
7. Given I'm logged in, when I press Log out, then I'm logged out at once, and opening any bill or group page sends me to the login page.
8. Given I've used the app within the last 30 days, when I return, then I'm still logged in.
9. Given I haven't used the app for 30 days, when I return, then I must log in again.
10. Given I keep entering wrong passwords, then the waits grow to 1 minute, 2 minutes, 5 minutes, then 15 minutes for every try after that. Once a wait is over, the right password logs me in, and the count starts again.
11. Given my username is waiting, then other usernames can still log in at once. The same wait applies to usernames that don't exist, so the wait never reveals which usernames are real.

### US-03 Reset a forgotten password with a recovery code
**As a** Solo diner or Group member, **I want** to set a new password using my recovery code, **so that** I can get back into my account without email or anyone's help.
- **Job:** J13 · **Status:** Implemented

Acceptance criteria:
1. Given my username, my current recovery code and a new valid password, when I reset, then I can log in with the new password, and a new recovery code is shown once with a "save this now" warning.
2. Given I've reset my password, when I try the old recovery code again, then it no longer works.
3. Given a wrong recovery code, or a username that doesn't exist, when I reset, then a clear message is shown and no password is changed.
4. Given a new password that is blank or 7 characters long, when I reset, then I see "Password must be at least 8 characters" (or "Password can be at most 128 characters" for 129), and the password isn't changed.
5. Given 5 wrong recovery codes in a row, when I try again, then the same waits as for passwords apply, counted separately from passwords. Once the wait is over, the right code works, and the reset also clears any wait on logging in.

### US-04 Keep my bills and groups private
**As a** Solo diner or Group member, **I want** my solo bills to be visible only to me and my groups only to their current members, **so that** nobody else can read or change my money records.
- **Job:** J12 · **Status:** Implemented

Acceptance criteria:
1. Given I'm logged out, when I open any bill or group page (including by typing its address), then I'm sent to the login page and no data is shown.
2. Given I'm logged in, when I type the address of another account's solo bill, then it isn't shown and can't be changed.
3. Given I'm logged in, when I type the address of a group I'm not a current member of (including one I was removed from), then it isn't shown and can't be changed.
4. Given someone sends requests straight to the server, bypassing the page, then the server applies the same rules and returns no private data.

---

## Solo bills

### US-05 Total a solo bill
**As a** Solo diner, **I want** to enter my bill's items, tax, other charges and tip and see the exact total, **so that** I pay the right amount.
- **Job:** J1 · **Status:** Implemented

Acceptance criteria:
1. Given items 12.50 and 7.50, tax 10%, other charges blank and tip 15% on items, when I press Calculate, then I see subtotal 20.00, tax 2.00, other charges 0.00, tip 3.00 and total 25.00.
2. Given items 12.50 and 7.50, tax 10%, other charges 5% and tip 15% on items, when I press Calculate, then I see subtotal 20.00, tax 2.00, other charges 1.00, tip 3.00 and total 26.00.
3. Given an items subtotal of 100.00, tax 10.00 (amount), other charges blank and tip 15% on items + tax, when I press Calculate, then the tip is 16.50 and the total is 126.50.
4. Given an items subtotal of 100.00, tax 10.00 (amount), other charges 7.50 (amount) and tip 15% on items + tax, when I press Calculate, then other charges is 7.50, the tip is 16.50 (other charges are not tipped on), and the total is 134.00.
5. Given an items subtotal of 100.00, tax 10% and other charges 10%, when I press Calculate, then other charges is 10.00 (a % of the items only, not of items + tax).
6. Given an items subtotal of 33.33 and other charges 12.5%, when I press Calculate, then other charges is 4.17 (4.16625 rounded half-up).
7. Given an items subtotal of 20.00 and tip 12.5%, then the tip is 2.50. Given an items subtotal of 20.00 and tax 8.25%, then the tax is 1.65.
8. Given an items subtotal of 0.01 and other charges 5%, then other charges is 0.00 (rounded half-up) and no error is shown.
9. Given other charges 0 or 0.00, then it's treated as "no other charges", shows 0.00, and causes no error.
10. Given tip 0, then the tip shows 0.00 with no error.
11. Given a new bill, then the "tip on" option starts at items only.
12. Given an items subtotal of 0.01, tax 0, other charges 1,000,000.00 (amount) and tip 0, when I press Calculate, then other charges is 1,000,000.00 and the total is 1,000,000.01.
13. Given no items, when I press Calculate, then I see "Add at least one item" and no result.
14. Given any invalid field (see US-25), when I press Calculate, then no result is shown.
15. Given an empty tax box, when I type 5, then the box shows "5" (not "05"), and a tax left blank counts as 0.

### US-06 Choose the currency of a solo bill
**As a** Solo diner, **I want** to pick the currency symbol for my bill, **so that** amounts are shown the way I paid them.
- **Job:** J15 · **Status:** Implemented

Acceptance criteria:
1. Given a new solo bill, when I open the currency picker, then it offers exactly $, €, £, ¥, ₹, Rs, PKR, ₩, ₺, R$, CHF, AED, SAR and "Other", with PKR in capitals.
2. Given I pick a symbol from the list, then every amount on the bill is shown with that symbol, and no currency conversion happens.
3. Given I pick "Other" and type "kr" or "zł", then every amount is shown with that symbol.
4. Given "Other" with a blank symbol, a symbol of 4+ characters (e.g. "abcd") or one containing a digit (e.g. "R1"), when I press Calculate or Save, then I see "Enter a currency symbol of up to 3 characters, with no digits" and nothing is saved.
5. Given "Other" with " kr " (spaces around it), then it's saved as "kr".
6. Given an unsaved bill, I can change its currency freely.
7. Given the bill has been saved once, when I edit it, then the currency can't be changed.
8. Given an invalid currency symbol is sent straight to the server, then it's rejected and nothing is saved.

### US-07 Save a solo bill to my history
**As a** Solo diner, **I want** to save a bill and see it in my history, **so that** I have a record of what I spent.
- **Job:** J2 · **Status:** Implemented

Acceptance criteria:
1. Given a valid solo bill, when I save it, then it appears at the top of my history (newest first) showing its name, date, currency and total.
2. Given I leave the name empty, when I save, then the bill is named "Bill – date" (using the bill's date).
3. Given a bill name of exactly 60 characters, then it's accepted. A name of 61 or more characters shows a clear message and the bill isn't saved.
4. Given the bill has an invalid field (see US-25), when I press Save, then the field's message is shown and nothing is saved.
5. Given I have several saved bills, then my history lists them newest first, and shows only my own bills.

### US-08 Open, edit and delete saved solo bills
**As a** Solo diner, **I want** to reopen, fix or remove a saved bill, **so that** my record stays accurate.
- **Job:** J2 · **Status:** Implemented

Acceptance criteria:
1. Given a saved solo bill, when I open it, then every input and result is shown exactly as saved, including other charges and its % / amount setting, and the "tip on" setting.
2. Given I change an amount and save, then the totals are recalculated and checked with the same rules as a new bill. Invalid edits show the same messages and aren't saved.
3. Given I edit other charges (value or % / amount), when I save, then the total is recalculated to match.
4. Given I'm editing a saved bill, then its currency can't be changed.
5. Given I press Delete, then I'm asked to confirm. Cancel keeps the bill unchanged, and Confirm removes it from my history.

---

## Groups

### US-09 Create a group
**As a** Group member, **I want** to create a group for a circle of friends, **so that** we can keep shared costs in one place over time.
- **Job:** J6 · **Status:** Implemented

Acceptance criteria:
1. Given I enter a group name and pick a currency, when I create the group, then I'm its first and only current member, and the activity log records "X created the group".
2. Given I'm choosing the group's currency, then I can pick from the list of 13 or choose "Other" and type a symbol of 1 to 3 characters with no digits (same rules and message as US-06). A note tells me I can change it later and that amounts aren't converted.
3. Given a blank group name, or one of 51 or more characters, when I create the group, then I see "Enter a group name of up to 50 characters" and no group is created. Names of exactly 1 and exactly 50 characters are accepted. The hint under Group name reads "Up to 50 characters".
4. Given a group exists, then its name and currency can be changed later (US-39).
5. Given a group, then all its bills, settle-ups and balances use the group's single currency.

### US-10 Add friends to a group by name
**As a** Group member, **I want** to add a friend to my group by name only, **so that** I can include them in bills even if they never create an account.
- **Job:** J8 · **Status:** Implemented

Acceptance criteria:
1. Given I add a name-only member "Omar", then Omar can immediately be ticked as a participant, and chosen as the payer of a bill he takes part in, and the activity log records "X added Omar".
2. Given the group has 50 current members, when I add another, then I see "A group can have at most 50 members" and nobody is added.
3. Given a blank name, or one of 31 or more characters, when I add it, then I see "Enter a name of up to 30 characters" and nobody is added. Names of exactly 1 and exactly 30 characters are accepted.
4. Given "Omar" is a current member, when I add "Omar", "omar" or "OMAR", then I see "That name has already been used in this group" and nobody is added.
5. Given "Omar" is a removed member, when I add a new "Omar" (in any letter case), then I see "That name has already been used in this group" and nobody is added. The name stays Omar's while he has it, so restoring him gives it back.
6. Given 49 current members and some removed members, when I add one more, then it succeeds, because removed members don't count toward the 50.
7. Given I add someone new by name, then an "Invite Omar" box appears straight away offering their own invite link (US-11).

### US-11 Share a friend's own invite
**As a** Group member, **I want** each friend I add by name to have their own invite code and link that I can copy or share, **so that** they can take over their own part without picking their name from a list.
- **Job:** J8 · **Status:** Implemented

Acceptance criteria:
1. Given a friend in the group hasn't joined yet, when I open the Members tab, then I see their own invite code next to their name (12 characters, shown in groups of four), with "Copy link" and, on phones, "Share".
2. Given I press "Copy link", then their invite link (`…/invite/<code>`) is copied, ready to paste. Given the browser can't copy (for example over plain http on a home network), then the link is shown in a box to copy by hand.
3. Given two friends who haven't joined, then each has a different code. Given people who have an account, then no code is shown for them.
4. Given the same friend is in two of my groups (added from my other groups, US-41), then they have one code, shown in both groups.
5. Given a current member who is in every group the friend is in, then they can see and share the code, not only the person who added the friend. For a friend in just one group, that's every current member.
6. Given a current member who isn't in all of the friend's groups (so the code would let them into a group they're not in), then they see no code, only "Only someone who's in all of Omar's groups can send their invite."
7. Given someone with an account leaves or is removed from the group, then every friend in it who hasn't joined gets a new code, and an old link shows "That invite link isn't valid. Check the code and try again." Removing someone without an account changes no codes.
8. Given any group, then there's no group-wide invite code.

### US-12 Join all my friends' groups with my own invite
**As a** Group member, **I want** to open my own invite link and create an account (or log in), **so that** every group my friends added me to is linked to my account at once.
- **Job:** J8 · **Status:** Implemented

Acceptance criteria:
1. Given Ghania was added by name to two groups and opens her invite link, then she sees "Ghania, join your friends' groups" and both group names, with no list of names to pick from.
2. Given she chooses "I'm new here" and creates an account, then both groups are linked to it at once: after saving her recovery code she lands on the Dashboard, both groups are in her list, and each group's log records "Ghania joined with their invite".
3. Given she already has an account, when she chooses "I have an account" and logs in, then both groups are linked to that account. Given the invite can't be used (for example it was used meanwhile), then she's still logged in and sees why.
4. Given a code has been used, when anyone opens it, then they see "Invite already used" and "This invite has already been used", with no name or group shown, and it can't be used again (sign-up with it creates no account).
5. Given a wrong code, then I see "That invite link isn't valid. Check the code and try again." and nothing changes.
6. Given I'm logged in and already in every group of that invite (for example, I opened a friend's link to test it), then I see that the invite is for them, with no Join button, and the code stays usable.
7. Given one of those groups already has my account as a member, then that group is skipped, and after joining I see "You were already in Flat, so it was skipped." There the invited name shows as "already here as <my name>". Given one of my memberships was removed, then it's linked but stays removed until someone restores me (US-23): the message says so, and that group's log records "Ghania linked their account (still removed)".
8. Given I was sent only the code, when I enter it under "Use an invite code" (in any letter case, with or without spaces or dashes, or by pasting the whole link), then I go to the same invite. Given characters other than letters and numbers, then I see "Invite codes have only letters and numbers. Check the code and try again."
9. Given I'm already in some, but not all, of the invite's groups (logged in, or logging in from the link), then nothing is joined yet: I see "You're already in Flat. If you're not Ghania, don't join: send them this link instead.", and "Join these groups" asks "Join as Ghania?" before anything changes.
10. Given Ghania was removed from every group she was added to, then her invite shows "That invite link isn't valid. Check the code and try again." until someone restores her.

---

## Group bills

### US-13 Record an equal-split group bill
**As a** Group member, **I want** to record a group bill split evenly between the people who took part, **so that** each pays an equal share that adds up exactly to the bill.
- **Job:** J3 · **Status:** Implemented

Acceptance criteria:
1. Given a group of 10 members, when I add a bill with 5 participants, paid by one of them, then only those 5 are charged and the other 5 members' balances don't change.
2. Given a grand total of 100.00 and 3 participants, when I press Calculate, then the shares are 33.34 / 33.33 / 33.33, the first participant in list order is marked as paying the extra cent, and the shares add up to 100.00.
3. Given an items subtotal of 90.00, tax 0, other charges 10% and tip 0, split between 3 participants, when I press Calculate, then other charges is 9.00, the grand total is 99.00, and each share is 33.00.
4. Given an items subtotal of 10.00 and other charges 0.01 (amount), split between 2 participants, then the grand total is 10.01 and the shares are 5.01 and 5.00.
5. Given a grand total of 0.01 split between 2 participants, then the shares are 0.01 and 0.00.
6. Given an items subtotal of 1,000,000.00, tax 0, other charges blank and a 100% tip on items, split between 50 participants, then the grand total is 2,000,000.00, each share is 40,000.00, and the shares add up to the total.
7. Given an items subtotal of 1,000,000.00, tax 0, other charges 1,000,000.00 (amount) and tip 0, split between 3 participants, then the grand total is 2,000,000.00 and the shares are 666,666.67 / 666,666.67 / 666,666.66.
8. Given no participants are selected, when I press Calculate, then I see "Choose who took part" and no result (no division by zero).
9. Given no items, when I press Calculate, then I see "Add at least one item" and no result.
10. Given an equal-split bill, then tax, other charges and tip follow the shared rules above, including the "tip on" option.

### US-14 Record an itemized group bill
**As a** Group member, **I want** to record which items each person had, including shared dishes, **so that** everyone pays for what they had plus a fair part of tax, other charges and tip.
- **Job:** J4 · **Status:** Implemented

Acceptance criteria:
1. Given Ali has a 40.00 steak and Sara a 10.00 salad, with tax 5.00, other charges blank and tip 10.00, when I press Calculate, then Ali's share is 52.00 and Sara's is 13.00.
2. Given the same bill with other charges 2.50 (amount), then Ali pays 2.00 and Sara 0.50 of the other charges, Ali's share is 54.00, Sara's is 13.50, and they add up to the grand total of 67.50.
3. Given 12.00 nachos ticked for Ali, Sara and Omar, then each is charged 4.00 for the nachos.
4. Given a 10.00 item shared by 3 people, then their parts are 3.34 / 3.33 / 3.33, with the extra cent going to the first ticked person.
5. Given three participants with 10.00 of items each and other charges 0.10, then their other-charges parts are 0.04 / 0.03 / 0.03: the leftover cent goes to the first participant in list order when there's a tie.
6. Given any itemized bill, then tax, other charges and tip are each split separately in proportion to each participant's items subtotal (leftover cents by largest remainder). Each of those parts adds up exactly to the bill's tax, other charges and tip.
7. Given a participant with no items, and other charges of 5.00 on the bill, then that participant's other-charges part is 0.00, and they owe 0.00 in total (items, tax, other charges and tip).
8. Given an item with nobody ticked, when I press Calculate, then I see "Choose who shared this item" next to it and no result.
9. Given any valid itemized bill, then the per-person totals add up exactly to the grand total.
10. Given an item row, when I open its people dropdown, then it lists only this bill's participants, each with a tick box, and I can tick one or several.
11. Given I've ticked Ali, Sara and Omar for an item and closed the dropdown, then the row shows "Ali, Sara, Omar".
12. Given I untick a participant from the bill, then they disappear from every item's dropdown, and items left with nobody ticked show "Choose who shared this item" when I press Calculate.

### US-15 Record who paid a group bill
**As a** Group member, **I want** to record which participant paid the bill, **so that** they're credited and the others owe them.
- **Job:** J5 · **Status:** Implemented

Acceptance criteria:
1. Given a bill's participants are Ali and Sara, then the payer list offers only Ali and Sara.
2. Given Omar is chosen as payer and then unticked as a participant, when I press Calculate or Save, then I see "The payer must be one of the people on this bill" and nothing is saved.
3. Given Ali paid 65.00 and the shares are Ali 52.00 and Sara 13.00, then Ali's balance goes up by 13.00 (65.00 paid − his own 52.00 share) and Sara's goes down by 13.00.
4. Given any bill, then exactly one payer is recorded. There is no option for several payers.
5. Given a removed member, then they're never offered as payer or participant on a new bill.

### US-16 See balances and suggested payments
**As a** Group member, **I want** to see each member's running balance and the fewest payments to settle up, **so that** I always know who owes whom.
- **Job:** J6 · **Status:** Implemented

Acceptance criteria:
1. Given Ali paid 65.00 for a bill with shares Ali 52.00 and Sara 13.00 (and no other activity), then Ali's net balance is +13.00, Sara's is −13.00, and the suggestion reads "Sara pays Ali 13.00".
2. Given any group, then the net balances of all members always add up to exactly 0.00.
3. Given several members owe and are owed, then the suggestions use the fewest payments that bring every balance to 0.00 (largest debtor matched to largest creditor), shown as "X pays Y amount".
4. Given every balance is 0.00, then no suggestions are shown.
5. Given a removed member, then they don't appear in the balance list or the suggestions.
6. Given I open a group, then the balances and suggested payments are at the top of the page, side by side and lined up (same top edge), with "Edit group" and "Add bill" buttons visible, and the tabs Bills, Settle-ups, Members and Activity below. Each friend's invite and Removed members are on the Members tab.
7. Given the suggestion "Sara pays Ali 13.00", when I press "Record this payment", then the settle-up form opens pre-filled with Sara → Ali and 13.00, and nothing is saved until I confirm. I can change the amount before confirming.
8. Given balances are shown, then money owed to a member is green with "+" and "is owed", and money a member owes is red with "−" and "owes". Colour is never the only signal.

### US-17 Record a settle-up
**As a** Group member, **I want** to record that one member paid another back, **so that** balances reflect repayments.
- **Job:** J7 · **Status:** Implemented

Acceptance criteria:
1. Given Sara owes Ali 13.00, when I record "Sara paid Ali 13.00", then both balances become 0.00 and the suggestion disappears.
2. Given Sara owes Ali 13.00, when I record "Sara paid Ali 20.00", then Sara's balance is +7.00, Ali's is −7.00, and the suggestion reads "Ali pays Sara 7.00" (overpaying flips the debt).
3. Given a settle-up from a member to the same member, then a clear message is shown and nothing is saved.
4. Given a settle-up amount outside 0.01–1,000,000.00, or with more than 2 decimals, letters or a blank, then a clear message is shown and nothing is saved.
5. Given a removed member, then they're never offered as either person in a new settle-up.
6. Given a settle-up, then it's a record only: no real money is moved.

### US-18 Edit and delete group bills and settle-ups
**As a** Group member, **I want** to correct or remove any group bill or settle-up, **so that** our balances stay right.
- **Job:** J6 · **Status:** Implemented

Acceptance criteria:
1. Given any current member, then they can edit or delete any bill or settle-up in the group, not just their own.
2. Given I edit a bill or settle-up and save, then it's checked with the same rules as a new one, and the balances update.
3. Given I reopen a group bill with other charges, then its value and % / amount setting are shown exactly as saved, and editing them recalculates the bill and the balances.
4. Given I press Delete on a bill, then I'm asked to confirm. Cancel keeps it, and Confirm removes it and updates the balances.
5. Given a bill or settle-up that includes a removed member, when I try to edit or delete it, then I see "Restore Omar to change this bill" and nothing changes. A message about Delete shows at the top of the page, next to the Delete button.

### US-19 See the group's activity log
**As a** Group member, **I want** a log of every change in the group, **so that** I can see who did what and when.
- **Job:** J9 · **Status:** Implemented

Acceptance criteria:
1. Given any member adds, edits or deletes a bill or settle-up, then the activity log shows who did it, when, and what changed (e.g. "Sara edited 'Pizza night': 60.00 → 65.00").
2. Given a member is removed, leaves or is restored, then the log shows "X removed Omar", "Omar left" or "X restored Omar".
3. Given the group is created, a member is added or someone joins with their invite, then the log shows "X created the group", "X added Omar" or "Omar joined with their invite".
4. Given any log entry, then it shows who made the change and when.
5. Given any current member, then they can see the whole log.
6. Given the group is renamed, its currency changes or a member is renamed, then the log shows "X renamed the group from 'A' to 'B'", "X changed the currency from $ to PKR" or "X renamed ghania to Ghania".

---

## Members leaving and coming back

### US-20 Remove a member from a group
**As a** Group member, **I want** to remove a member who has settled up, **so that** the group lists only the people still in it, without changing past bills.
- **Job:** J10 · **Status:** Implemented

Acceptance criteria:
1. Given a member whose balance isn't 0.00, when anyone tries to remove them, then I see "Settle this member's balance before removing them" and nothing changes.
2. Given Omar's balance is 0.00, when any member removes him, then he moves to "Removed members", and the log records "X removed Omar".
3. Given a member has balance 0.00 but hasn't been removed, then they're still a normal current member (settled isn't the same as removed).
4. Given Omar is removed, when I open "Pizza night" (which he paid for), then it shows "Omar (removed)" as payer and participant, and the bill's totals and everyone's balances are exactly as before.
5. Given Omar is removed, when I add a new bill or settle-up, then he isn't offered as payer, participant or settle-up person, and he isn't in the balance list or the suggestions.
6. Given Omar is removed, when I try to edit or delete a bill or settle-up that includes him, then I see "Restore Omar to change this bill" and nothing changes.
7. Given Omar has an account and is removed, then the group disappears from his group list right away, and opening its address shows that he no longer has access. His account and solo bills are unchanged.
8. Given Omar has an account and is removed, then everyone in the group who hasn't joined yet gets a new invite code, so an invite link he saw can't bring him back under their name (US-11 #7).

### US-21 Leave a group
**As a** Group member, **I want** to leave a group once I've settled up, **so that** I'm no longer part of it.
- **Job:** J10 · **Status:** Implemented

Acceptance criteria:
1. Given my balance isn't 0.00 and another current member has an account, when I try to leave, then I see "Settle your balance before leaving" and I stay in the group.
2. Given my balance is 0.00 and another current member has an account, when I leave, then I move to "Removed members", the log records "Omar left", and the group disappears from my group list.
3. Given I've left, then my old bills keep me as "Name (removed)", and every total and balance stays the same.
4. Given I've left, then my account and solo bills are unchanged.
5. Given I'm the last current member with an account, then leaving follows US-22 instead.
6. Given I leave, then everyone in the group who hasn't joined yet gets a new invite code, so an invite link I saw can't bring me back under their name (US-11 #7).

### US-22 Close out a group as the last member with an account
**As a** Group member, **I want** to leave a group even when I'm the last member with an account, after a clear warning, **so that** a group nobody uses is closed for good.
- **Job:** J11 · **Status:** Implemented

Acceptance criteria:
1. Given I'm the only current member with an account, when I press Leave, then I see: "You're the last member with an account. If you leave, this group and all its bills, settle-ups and history will be permanently deleted. Unsettled balances will be lost."
2. Given that warning, when I press Cancel, then nothing changes.
3. Given that warning, when I press Leave (whatever my balance), then the group is permanently deleted, including its members, bills, settle-ups and activity log.
4. Given a group was deleted, then it disappears for everyone, its address shows "This group no longer exists", and an invite that only led to that group is no longer valid.
5. Given a group was deleted, then my account, my solo bills and my other groups are unchanged.
6. Given any group, then there's no separate "delete group" button. Deletion only happens this way.

### US-23 Restore a removed member
**As a** Group member, **I want** to bring back a member who was removed, **so that** they can take part again with one continuous history.
- **Job:** J10 · **Status:** Implemented

Acceptance criteria:
1. Given the group has removed members, then the members page lists them under "Removed members", each with a Restore button that any current member can use.
2. Given Omar is removed, when any member presses Restore, then he's a current member again with his full history and no "(removed)" mark, and the log records "X restored Omar".
3. Given Omar had an account, when he's restored, then his access to the group returns.
4. Given Omar is restored, then bills and settle-ups that include him can be edited and deleted again.
5. Given the group already has 50 current members, when anyone tries to restore Omar, then a clear message is shown and he stays removed.
6. Given Omar is restored, then he keeps his name. Nobody else can have taken it while he had it.
7. Given Omar was removed, then Restore is the only way back in: his used invite can't bring him back.

---

## Input checks, results and saving (all bills)

### US-25 Get a clear message for every invalid input
**As a** Solo diner or Group member, **I want** a clear message next to any field I've filled in wrongly, **so that** I never get a wrong result or a crash.
- **Job:** J14 · **Status:** Implemented

Acceptance criteria:
1. Given a money field containing "abc", "-5", "1.234", "1000000.01" or a blank, when I press Calculate or Save, then a message next to that field explains the rule and no result is shown.
2. Given a money field of exactly 0.01 or exactly 1,000,000.00, then it's accepted.
3. Given tax or tip as a % outside 0–100 (e.g. -1 or 100.01), then a clear message is shown and no result.
4. Given tax or tip as a % of exactly 0 or exactly 100, then it's accepted.
5. Given a tax or tip % with more than 2 decimal places (e.g. 12.345), then a clear message is shown and no result.
6. Given tax or tip as an amount outside 0.00–1,000,000.00, or with letters or more than 2 decimals, then a clear message is shown and no result.
7. Given other charges as an amount of "abc", "-1", "0.001" or "1000000.01", then "Other charges must be between 0.01 and 1,000,000.00, or left empty" appears next to the field and no result is shown.
8. Given other charges as a % of "abc", "-5", "0.001" or "100.01", then "Other charges must be between 0.01% and 100%, or left empty" appears next to the field and no result is shown.
9. Given other charges of exactly 0.01 or 1,000,000.00 (amount), or exactly 0.01% or 100%, then it's accepted.
10. Given any bill (solo, equal or itemized) with no items, when I press Calculate, then I see "Add at least one item" and no result.
11. Given a bill with 200 items, when I add another, then I see "A bill can have at most 200 items" and no item is added.
12. Given 3 items of 1,000,000.00 each, when I press Calculate, then the items subtotal is 3,000,000.00 with no error (the limit is per field, not per total).
13. Given 200 items of 1,000,000.00 each, tax 100%, other charges 100% and tip 100% on items + tax, when I press Calculate, then the result is an items subtotal of 200,000,000.00, tax 200,000,000.00, other charges 200,000,000.00, tip 400,000,000.00, and grand total exactly 1,000,000,000.00.
14. Given an item name left blank, then it's shown as "Item N" by its position. An item name of exactly 40 characters is accepted, and 41 or more shows a clear message and no result.
15. Given any input at all, then the app never shows NaN, Infinity, "undefined", or a blank or crashed screen.
16. Given invalid data is sent straight to the server, bypassing the page, then the server rejects it and saves nothing.
17. Given I type "1,000.50" or "1000.50" in a money field, then both are accepted as 1000.50.
18. Given I type "1.000,50" (European style) or a misplaced comma such as "10,00", then the field's normal message is shown and no result.
19. Given any form (sign up, reset password, create or edit a group, add or rename a member, record a payment, use an invite code, or an invite page), when I edit a field that's showing its message, then that message disappears straight away. Messages on other fields stay until those are edited.

### US-26 Carry on safely after a result or an error
**As a** Solo diner or Group member, **I want** results and errors to update correctly as I keep working, **so that** I never act on an out-of-date figure.
- **Job:** J14 · **Status:** Implemented

Acceptance criteria:
1. Given an error is showing, when I fix the field and press Calculate, then the error disappears and the correct result appears, with no page reload needed.
2. Given a result is showing, when I change any input, then the old result is hidden until I press Calculate again.
3. Given a result is showing, when I switch tax, tip or other charges between % and amount, or change the "tip on" option, then the old result is hidden until I press Calculate again.
4. Given I press Calculate several times without changing anything, then the same result is shown each time.
5. Given a new bill form, then the results area below the form reads "Press Calculate to see results".
6. Given valid inputs, when I press Calculate, then the results appear below the form, on every screen size, and the page scrolls down to them.
7. Given results are showing, when I change any input, then the results area goes back to "Press Calculate to see results".
8. Given a bill in Rs with a total of 1234567.5 and a share of 400, then the results show "Rs 1,234,567.50" and "Rs 400.00". In $ they show "$1,234,567.50" and "$400.00".
9. Given a field is showing an error, when I edit that field, then its error disappears straight away, before I press Calculate.
10. Given results are showing, then each % line shows its rate, e.g. "Tax (5%)", "Other charges (10%)", "Tip (15% of items)" or "Tip (15% of items + tax)".
11. Given a bill form, then the "Save bill" button sits under the results, with any message about saving just above it. When the server rejects a field, the cursor moves to that field.

### US-27 Keep my inputs when saving fails
**As a** Solo diner or Group member, **I want** my entries kept if a save fails, **so that** I don't have to type everything again.
- **Job:** J14 · **Status:** Implemented

Acceptance criteria:
1. Given the server can't be reached, when I save, then I see "Couldn't save — check your connection" and all my inputs are kept.
2. Given a save failed, when the server is reachable again and I press Save, then the bill is saved normally.
3. Given the app's database stops while I'm using the app, when I save, then a clear message is shown, my inputs are kept, and nothing is half-saved. Once the database is back, saving works without restarting the app.
4. Given a save fails partway (e.g. the database stops mid-save), then none of that save is stored: no bill without its items, no balance change without its activity log entry.

### US-28 Keep my records after a restart
**As a** Solo diner or Group member, **I want** my bills, groups and balances to still be there after the app or its database restarts, **so that** my history is never lost.
- **Jobs:** J2, J6 · **Status:** Implemented

Acceptance criteria:
1. Given I've saved solo bills, groups, group bills and settle-ups, when the app server is stopped and started again, then all of them, and all balances and activity logs, are exactly as before.
2. Given the same saved data, when the database container is stopped and started again (including `docker compose down` then `docker compose up -d`), then everything is exactly as before.

### US-29 Use the app in my usual browser
**As a** Solo diner or Group member, **I want** the app to work in the current version of my usual browser, **so that** I don't need to install anything.
- **Job:** J16 · **Status:** Implemented

Acceptance criteria:
1. Given the current version of Chrome, Edge, Firefox or Safari, when I use every feature above, then it behaves the same way and every acceptance criterion passes.

---

## Screens, appearance and accessibility

### US-33 See my money at a glance on the Dashboard
**As a** Solo diner or Group member, **I want** a home screen that sums up what I owe and what I'm owed, **so that** I know where I stand the moment I log in.
- **Job:** J20 · **Status:** Implemented

Acceptance criteria:
1. Given I log in, then I land on the Dashboard.
2. Given I'm in groups, then the Dashboard shows "You owe" and "You're owed" totals across all my groups, one line per currency.
3. Given I'm in one group using $ and another using Rs, then the Dashboard shows separate $ and Rs totals, never one combined number.
4. Given I'm in groups, then each group is listed with my own balance in it, and clicking a group opens its page.
5. Given I have solo bills, then my latest solo bills are listed, newest first.
6. Given the Dashboard, then "New solo bill" and "New group bill" buttons are visible.
7. Given I have no groups and no solo bills, then each section shows a short explanation and a button for the next step instead of an empty space.
8. Given every balance across my groups is 0.00, then the Dashboard says I owe nothing and am owed nothing.
9. Given I owe or am owed money, then under "You owe" and "You're owed" I see who: e.g. "To Ali" with "Rs 400.00" and the group's name, which opens that group.

### US-34 Find my way on a computer or a phone
**As a** Solo diner or Group member, **I want** clear navigation that works on a big screen and a small one, **so that** I can use whichever device I have with me.
- **Job:** J16 · **Status:** Implemented

Acceptance criteria:
1. Given a screen 1280 px wide, then a left sidebar with Dashboard, Solo bills, Groups and Settings is always visible.
2. Given a screen 375 px wide, then the sidebar is replaced by a menu button at the top, which opens the same four links.
3. Given any page at any width from 360 px up, then all content fits with no sideways scrolling of the page.
4. Given I'm on a page, then its sidebar or menu link is highlighted, so I can see where I am.
5. Given the Settings page, then it shows my username, the appearance setting and a Log out button.
6. Given any page, then the app is called "Bill Splitter" everywhere (browser tab, sidebar, log-in page).

### US-35 Choose light or dark appearance
**As a** Solo diner or Group member, **I want** the app to be light or dark to suit my surroundings, **so that** figures are comfortable to read day or night.
- **Job:** J21 · **Status:** Implemented

Acceptance criteria:
1. Given the appearance setting is "Device" (the default) and my device is in dark mode, then the app is dark. When the device switches to light mode, the app follows.
2. Given I choose "Light" or "Dark" on the Settings page, then the app uses that look regardless of my device setting.
3. Given I chose "Dark", when I log out and back in (on any computer), then the app is still dark, because the choice is saved with my account.
4. Given either theme, then all text has at least 4.5:1 contrast, and owed / owes amounts keep their "+" / "−" and words as well as colour.

### US-36 Use the app with a keyboard, screen reader or zoom
**As a** Solo diner or Group member, **I want** every feature to work without a mouse, with a screen reader and at large text sizes, **so that** I can manage my money on my own.
- **Job:** J22 · **Status:** Implemented

Acceptance criteria:
1. Given I use only the keyboard, then I can sign up, log in, create a group, add members, add an itemized bill (including choosing people in the item dropdowns), calculate, save, record a settle-up and log out, with a clearly visible focus outline at every step.
2. Given a confirmation dialog is open, then keyboard focus stays inside it, and Esc closes it the same way as Cancel.
3. Given a screen reader, then every field has a label, each error is read out with its field, and new results and success messages are announced.
4. Given 200% browser zoom, then every page is still usable with no lost content or functions.
5. Given any button, link or tick box, then its touch or click area is at least 24×24 px.
6. Given any page in light or dark mode, when the automated accessibility checks run as part of `npm test`, then they report no WCAG 2.2 AA violations.

### US-37 Know what happened after every action
**As a** Solo diner or Group member, **I want** clear signs when something is saving, saved, loading or empty, **so that** I'm never unsure whether it worked and never save something twice.
- **Job:** J14 · **Status:** Implemented

Acceptance criteria:
1. Given I save a bill, record a payment or remove a member, then a short corner message appears ("Bill saved", "Payment recorded", "Member removed"), disappears after 5 seconds, and is announced by screen readers.
2. Given I press Save, then the button shows "Saving…" and is disabled until the save finishes.
3. Given I double-click Save, then only one bill is created.
4. Given a page is loading its data, then grey placeholder shapes are shown until the content appears.
5. Given I have no groups, then the Groups page shows "No groups yet. Create one to start splitting with friends." with a Create group button. Empty solo-bill, group-bill and activity lists likewise explain what to do next.
6. Given I press Delete, Remove member, Leave or close out a group, then a pop-up asks me to confirm. The dangerous button is red, and Cancel or Stay is the safe default.

### US-38 Don't lose unsaved changes by accident
**As a** Solo diner or Group member, **I want** a warning before I leave a bill I haven't saved, **so that** I don't lose a long receipt I've typed in.
- **Job:** J14 · **Status:** Implemented

Acceptance criteria:
1. Given I've changed a bill form without saving, when I click a sidebar link, the back button or any other link, then I'm asked "You have unsaved changes. Leave without saving?" with Stay and Leave.
2. Given that question, when I press Stay, then I stay on the form with everything I typed.
3. Given that question, when I press Leave, then I go to the other page and the changes are discarded. Nothing is saved as a draft.
4. Given I've changed a bill form without saving, when I close or reload the browser tab, then the browser's own "Leave site?" prompt appears.
5. Given I haven't changed anything, or I've just saved, when I leave the form, then no warning appears.

---

### US-39 Edit a group's name and currency
**As a** Group member, **I want** to rename a group or change its currency, **so that** I can fix a mistake or follow a change of plan.
- **Job:** J6 · **Status:** Implemented

Acceptance criteria:
1. Given I'm a current member, when I press "Edit group", change the name and press "Save changes", then the group has the new name everywhere and the log records "X renamed the group from 'A' to 'B'".
2. Given I change the currency (e.g. $ to PKR), then every amount in the group shows the new symbol, nothing is converted, and the log records "X changed the currency from $ to PKR".
3. Given a blank or 51-character name, or a bad currency symbol, then the same messages as when creating a group are shown and nothing changes.
4. Given someone who isn't a current member, then they can't change the group, even by sending requests straight to the server.

### US-40 Rename a member
**As a** Group member, **I want** to change a member's name, **so that** typos like "ghania" can be fixed.
- **Job:** J9 · **Status:** Implemented

Acceptance criteria:
1. Given I press "Rename" next to a member, type a new name and press "Save name", then the new name shows everywhere, including old bills and balances, and the log records "X renamed ghania to Ghania".
2. Given the new name matches another member in any letter case, then I see "That name has already been used in this group" and nothing changes.
3. Given a member was renamed, then their old name is free and can be given to someone else.
4. Given a blank or 31-character name, then I see "Enter a name of up to 30 characters".
5. Given I rename someone who hasn't joined yet, then their invite page and the lists in my other groups show the new name.
6. Given the rename box is open, when I press Save name, Cancel or Esc, then it closes and the cursor goes back to that member's Rename button.

### US-41 Add someone from my other groups
**As a** Group member, **I want** to add a friend who's already in another of my groups, **so that** they're the same person everywhere and one invite covers all their groups.
- **Job:** J8 · **Status:** Implemented

Acceptance criteria:
1. Given people are in my other groups, then the Members tab shows "Or add someone from your other groups", listing each current member of those groups once, by their name (never their username), with the groups they're in, and leaving out people already in this group. Someone who hasn't joined is listed only when I'm in all of their groups, so I can send them their invite.
2. Given I pick someone who hasn't joined yet, then they're added as the same person, with the same invite code in both groups ("Their invite link now covers this group too."), and the cursor moves to their "Invite" box. Given someone who could see that code isn't in this group, then the code changes, and the box says "Their invite link has changed, so send them this new one."
3. Given I pick someone who has an account, then they get access to this group straight away.
4. Given their usual name clashes with someone in this group, then a "Name in this group" box appears with "That name has already been used in this group", and I can add them under a different name.
5. Given people who aren't in any of my groups, then they're never offered, and they can't be added by sending requests straight to the server. The list can only be asked for about a group I'm in.

---

## Running the app

### US-30 Run the app locally from the README
**As a** Host, **I want** to install and start the app on my computer by following the README, **so that** I can try it for free.
- **Job:** J17 · **Status:** Implemented

Acceptance criteria:
1. Given Node.js LTS and Docker are installed, when I follow the README steps on a fresh clone (go into the `src` folder, copy `.env.example` to `.env`, `docker compose up -d`, `npm install`, `npm run dev`, open the shown address), then the app runs and I can sign up locally.
2. Given the README, then it never asks for a paid account, an API key, or any third-party cloud or paid service.
3. Given the app is running, then it works with no internet-based service: accounts, data storage and calculations all happen inside the app and its own self-hosted PostgreSQL container.
4. Given the database container isn't running, when I start the app, then it prints "Can't reach the database. Start it with: docker compose up -d" and stops, with no crash trace.
5. Given a fresh database, when the app starts, then it creates its own tables automatically. No manual database setup is needed.
6. Given the database container is running, then its port is reachable only from my own computer, not from other machines on the network.
7. Given the README, then it warns that `docker compose down -v` permanently deletes all saved data, and that plain `docker compose down` keeps it.

### US-31 Deploy the app to my own server
**As a** Host, **I want** to run the same app on a server, **so that** my friends can use it for real.
- **Job:** J18 · **Status:** Implemented

Acceptance criteria:
1. Given a server with Node.js LTS and a self-hosted PostgreSQL 18 database (e.g. the same Compose file), when I deploy the same build, then it runs, configured only through settings the app owns: port, `DATABASE_URL` and session secret.
2. Given the deployed app, then it doesn't depend on any third-party cloud or paid service.
3. Given the deployed app, then passwords are stored hashed (never as plain text), and sessions use secure cookies.
4. Given the deployed app starts against a database that already has data, then pending schema updates are applied automatically and existing data is kept.

### US-32 Run all tests with one command
**As a** Host, **I want** to run every automated test with one command, **so that** I can see for myself that the app works as described.
- **Job:** J19 · **Status:** Implemented

Acceptance criteria:
1. Given the project is installed and the database container is running, when I run `npm test`, then the calculation, validation and server tests and the browser tests (Chromium, Firefox and WebKit, Safari's engine) all run and pass.
2. Given I have real bills saved in the app, when I run `npm test`, then the tests use only the separate test database, which is wiped and rebuilt at the start of each run, and my real data is unchanged.
3. Given I run `npm test` twice in a row, then both runs give the same results.
4. Given the database container isn't running, when I run `npm test`, then it stops at once with "Can't reach the database. Start it with: docker compose up -d".

---

## Open questions

None. Every open question has been settled in the spec and is reflected in the stories above.
