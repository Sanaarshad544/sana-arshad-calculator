# User Stories

How the Bill Splitting Calculator helps each role get their jobs done. Every story names its role (from [app-roles.md](app-roles.md)) and the job it serves (from [jobs-to-be-done.md](jobs-to-be-done.md)), and has testable acceptance criteria and a status.

## How to read this file

- **Template:** "As a [role], I want [capability], so that [benefit]."
- **Acceptance criteria:** written as "Given [starting state], when [action], then [observable result]". They cover:
  - the normal case
  - invalid input
  - boundary values
  - very large and very small numbers
  - what happens when the user carries on after a result or an error
- **Status:** **Implemented** means the running app does exactly what every criterion says today. **Not implemented** means it doesn't yet. No app code exists yet, so every story is currently **Not implemented**.
- **Money format:** amounts are shown with 2 decimals and the bill's or group's currency symbol. The examples below leave out the symbol.

## Shared rules used by many stories

These rules come from the spec and apply wherever a story mentions them.

- **Money fields** (item prices, settle-up amounts): 0.01–1,000,000.00, at most 2 decimal places. No negatives, letters, blanks or extra decimals.
- **Per-field limit:** the 1,000,000.00 limit applies to each field on its own. A bill's food subtotal and grand total may be larger.
- **Items:** every bill (solo, equal or itemized) needs 1–200 items. The largest possible grand total is 1,000,000,000.00, and it is still exact to the cent.
- **Names** (spaces at the start and end are trimmed before checking):
  - Group name: required, 1–50 characters.
  - Member name: required, 1–30 characters, and never reused within a group: it can't match any member the group has ever had, current or removed. Not case-sensitive: "omar" clashes with "Omar".
  - Bill name: optional, up to 60 characters, defaulting to "Bill – date".
  - Item name: optional, up to 40 characters, defaulting to "Item 1", "Item 2" and so on.
- **Tax and tip:** each can be a **%** (0–100, at most 2 decimal places, e.g. 12.5 or 8.25) or an **amount** (0.00–1,000,000.00). Tip may be 0.
- **Other charges** (optional, one field per bill, always labelled "Other charges", for service, delivery or table fees and similar):
  - Blank, 0 or 0.00 means "no other charges", and the results show "Other charges 0.00".
  - As an amount: 0.01–1,000,000.00, at most 2 decimal places.
  - As a %: 0.01–100, at most 2 decimal places.
- **What each % is of:**
  - Tax % and other charges % are always of the **food subtotal** only.
  - Tax is never charged on other charges or tip.
  - A % tip has a per-bill **"tip on"** option: **food only (default)** or **food + tax**. A tip is never calculated on other charges.
- **Rounding:** tax, other charges and tip are each worked out separately in cents. Any % result is rounded half-up to the cent, so it can be 0.00. A "food + tax" tip uses the already-rounded tax. All money math uses whole cents, never floating-point.
- **Grand total** = food subtotal + tax + other charges + tip.
- **Exactness:** for every bill, the shares add up exactly to the grand total.
- **Results:** totals appear only when **Calculate** is pressed. Changing any input hides the old result until Calculate is pressed again.
- **Currency:** a display symbol only, with no conversion. Choose from the default list of 12 ($, €, £, ¥, ₹, Rs, ₩, ₺, R$, CHF, AED, SAR), or choose "Other" and type a symbol of 1–3 characters with no digits.
- **Accounts:**
  - Username: 3–30 characters (letters, numbers, underscore), not case-sensitive.
  - Password: 8–128 characters, any characters.
  - A session ends on Log out or after 30 days without use.
  - There is no limit on failed login or recovery-code attempts.
- **Group size:** 1–50 **current** members. Removed members don't count.

## Story list

| ID | Story | Role | Job | Status |
|---|---|---|---|---|
| US-01 | Create an account | Solo diner, Group member | J12 | Not implemented |
| US-02 | Log in and log out | Solo diner, Group member | J12 | Not implemented |
| US-03 | Reset a forgotten password with a recovery code | Solo diner, Group member | J13 | Not implemented |
| US-04 | Keep my bills and groups private | Solo diner, Group member | J12 | Not implemented |
| US-05 | Total a solo bill | Solo diner | J1 | Not implemented |
| US-06 | Choose the currency of a solo bill | Solo diner | J15 | Not implemented |
| US-07 | Save a solo bill to my history | Solo diner | J2 | Not implemented |
| US-08 | Open, edit and delete saved solo bills | Solo diner | J2 | Not implemented |
| US-09 | Create a group | Group member | J6 | Not implemented |
| US-10 | Add friends to a group by name | Group member | J8 | Not implemented |
| US-11 | View and copy the group's invite code | Group member | J8 | Not implemented |
| US-12 | Join a group by claiming my name | Group member | J8 | Not implemented |
| US-13 | Record an equal-split group bill | Group member | J3 | Not implemented |
| US-14 | Record an itemized group bill | Group member | J4 | Not implemented |
| US-15 | Record who paid a group bill | Group member | J5 | Not implemented |
| US-16 | See balances and suggested payments | Group member | J6 | Not implemented |
| US-17 | Record a settle-up | Group member | J7 | Not implemented |
| US-18 | Edit and delete group bills and settle-ups | Group member | J6 | Not implemented |
| US-19 | See the group's activity log | Group member | J9 | Not implemented |
| US-20 | Remove a member from a group | Group member | J10 | Not implemented |
| US-21 | Leave a group | Group member | J10 | Not implemented |
| US-22 | Close out a group as the last member with an account | Group member | J11 | Not implemented |
| US-23 | Restore a removed member | Group member | J10 | Not implemented |
| US-24 | Rejoin a group with the invite code | Group member | J10 | Not implemented |
| US-25 | Get a clear message for every invalid input | Solo diner, Group member | J14 | Not implemented |
| US-26 | Carry on safely after a result or an error | Solo diner, Group member | J14 | Not implemented |
| US-27 | Keep my inputs when saving fails | Solo diner, Group member | J14 | Not implemented |
| US-28 | Keep my records after a restart | Solo diner, Group member | J2, J6 | Not implemented |
| US-29 | Use the app in my usual browser | Solo diner, Group member | J16 | Not implemented |
| US-30 | Run the app locally from the README | Host | J17 | Not implemented |
| US-31 | Deploy the app to my own server | Host | J18 | Not implemented |
| US-32 | Run all tests with one command | Host | J19 | Not implemented |

---

## Accounts

### US-01 Create an account
**As a** Solo diner or Group member, **I want** to create an account with a username and password, **so that** my bills and groups are kept for me and nobody else.
- **Job:** J12 · **Status:** Not implemented

Acceptance criteria:
1. Given a username nobody has used and a valid password, when I sign up, then my account is created, I'm logged in, and a one-time recovery code is shown with a "save this now" warning.
2. Given I leave the recovery code screen, then that code is never shown again.
3. Given a username that is already taken, when I sign up, then I see "That username is taken" and no account is created.
4. Given "Sana" already exists, when someone signs up as "sana" or "SANA", then they see "That username is taken" (usernames aren't case-sensitive).
5. Given a username that is blank, 2 characters or 31 characters long, or contains anything other than letters, numbers and underscore (e.g. "sana!" or "sa na"), when I sign up, then a clear message is shown and no account is created.
6. Given a username of exactly 3 or exactly 30 characters, then it's accepted.
7. Given a password that is blank, 7 characters or 129 characters long, when I sign up, then a clear message is shown and no account is created.
8. Given a password of exactly 8 or exactly 128 characters, including spaces and symbols, then it's accepted.
9. Given sign-up failed (e.g. the username was taken), when I fix it and sign up again, then the account is created without reloading the page.
10. The app never asks for an email address or phone number, and never sends email or text messages.

### US-02 Log in and log out
**As a** Solo diner or Group member, **I want** to log in with my username and password and log out when I'm done, **so that** only I can reach my records, even on a shared computer.
- **Job:** J12 · **Status:** Not implemented

Acceptance criteria:
1. Given a correct username and password, when I log in, then I'm logged in and see my own bills and groups.
2. Given a wrong password, when I log in, then I see "Username or password is incorrect" and stay logged out.
3. Given a username that doesn't exist, when I log in, then I see the same message, "Username or password is incorrect", which never says whether the username or the password was wrong.
4. Given a failed login, when I enter the correct details and log in again, then I'm logged in without reloading the page.
5. Given my account is "Sana", when I log in as "sana" or "SANA" with the right password, then I'm logged in.
6. Given 20 wrong passwords in a row, when I then enter the correct one, then I'm logged in. There's no limit on attempts.
7. Given I'm logged in, when I press Log out, then I'm logged out at once, and opening any bill or group page sends me to the login page.
8. Given I've used the app within the last 30 days, when I return, then I'm still logged in.
9. Given I haven't used the app for 30 days, when I return, then I must log in again.

### US-03 Reset a forgotten password with a recovery code
**As a** Solo diner or Group member, **I want** to set a new password using my recovery code, **so that** I can get back into my account without email or anyone's help.
- **Job:** J13 · **Status:** Not implemented

Acceptance criteria:
1. Given my username, my current recovery code and a new valid password, when I reset, then I can log in with the new password, and a new recovery code is shown once with a "save this now" warning.
2. Given I've reset my password, when I try the old recovery code again, then it no longer works.
3. Given a wrong recovery code, or a username that doesn't exist, when I reset, then a clear message is shown and no password is changed.
4. Given a new password that is blank, 7 characters or 129 characters long, when I reset, then a clear message is shown and the password isn't changed.
5. Given many wrong recovery codes in a row, when I then enter the right one, then the reset works. There's no limit on attempts.
6. Given I've lost both my password and my recovery code, then the account can't be recovered. My names in groups stay as they were, and a new account can claim a name again through the group's invite code (US-12, US-24).

### US-04 Keep my bills and groups private
**As a** Solo diner or Group member, **I want** my solo bills to be visible only to me and my groups only to their current members, **so that** nobody else can read or change my money records.
- **Job:** J12 · **Status:** Not implemented

Acceptance criteria:
1. Given I'm logged out, when I open any bill or group page (including by typing its address), then I'm sent to the login page and no data is shown.
2. Given I'm logged in, when I type the address of another account's solo bill, then it isn't shown and can't be changed.
3. Given I'm logged in, when I type the address of a group I'm not a current member of (including one I was removed from), then it isn't shown and can't be changed.
4. Given someone sends requests straight to the server, bypassing the page, then the server applies the same rules and returns no private data.

---

## Solo bills

### US-05 Total a solo bill
**As a** Solo diner, **I want** to enter my bill's items, tax, other charges and tip and see the exact total, **so that** I pay the right amount.
- **Job:** J1 · **Status:** Not implemented

Acceptance criteria:
1. Given items 12.50 and 7.50, tax 10%, other charges blank and tip 15% on food, when I press Calculate, then I see subtotal 20.00, tax 2.00, other charges 0.00, tip 3.00 and total 25.00.
2. Given items 12.50 and 7.50, tax 10%, other charges 5% and tip 15% on food, when I press Calculate, then I see subtotal 20.00, tax 2.00, other charges 1.00, tip 3.00 and total 26.00.
3. Given food 100.00, tax 10.00 (amount), other charges blank and tip 15% on food + tax, when I press Calculate, then the tip is 16.50 and the total is 126.50.
4. Given food 100.00, tax 10.00 (amount), other charges 7.50 (amount) and tip 15% on food + tax, when I press Calculate, then other charges is 7.50, the tip is 16.50 (other charges are not tipped on), and the total is 134.00.
5. Given food 100.00, tax 10% and other charges 10%, when I press Calculate, then other charges is 10.00 (a % of the food only, not of food + tax).
6. Given food 33.33 and other charges 12.5%, when I press Calculate, then other charges is 4.17 (4.16625 rounded half-up).
7. Given food 20.00 and tip 12.5%, then the tip is 2.50. Given food 20.00 and tax 8.25%, then the tax is 1.65.
8. Given food 0.01 and other charges 5%, then other charges is 0.00 (rounded half-up) and no error is shown.
9. Given other charges 0 or 0.00, then it's treated as "no other charges", shows 0.00, and causes no error.
10. Given tip 0, then the tip shows 0.00 with no error.
11. Given a new bill, then the "tip on" option starts at food only.
12. Given food 0.01, tax 0, other charges 1,000,000.00 (amount) and tip 0, when I press Calculate, then other charges is 1,000,000.00 and the total is 1,000,000.01.
13. Given no items, when I press Calculate, then I see "Add at least one item" and no result.
14. Given any invalid field (see US-25), when I press Calculate, then no result is shown.

### US-06 Choose the currency of a solo bill
**As a** Solo diner, **I want** to pick the currency symbol for my bill, **so that** amounts are shown the way I paid them.
- **Job:** J15 · **Status:** Not implemented

Acceptance criteria:
1. Given a new solo bill, when I open the currency picker, then it offers exactly $, €, £, ¥, ₹, Rs, ₩, ₺, R$, CHF, AED, SAR and "Other".
2. Given I pick a symbol from the list, then every amount on the bill is shown with that symbol, and no currency conversion happens.
3. Given I pick "Other" and type "kr" or "zł", then every amount is shown with that symbol.
4. Given "Other" with a blank symbol, a symbol of 4+ characters (e.g. "abcd") or one containing a digit (e.g. "R1"), when I press Calculate or Save, then I see "Currency symbol must be 1–3 characters with no digits" and nothing is saved.
5. Given "Other" with " kr " (spaces around it), then it's saved as "kr".
6. Given an unsaved bill, I can change its currency freely.
7. Given the bill has been saved once, when I edit it, then the currency can't be changed.
8. Given an invalid currency symbol is sent straight to the server, then it's rejected and nothing is saved.

### US-07 Save a solo bill to my history
**As a** Solo diner, **I want** to save a bill and see it in my history, **so that** I have a record of what I spent.
- **Job:** J2 · **Status:** Not implemented

Acceptance criteria:
1. Given a valid solo bill, when I save it, then it appears at the top of my history (newest first) showing its name, date, currency and total.
2. Given I leave the name empty, when I save, then the bill is named "Bill – date" (using the bill's date).
3. Given a bill name of exactly 60 characters, then it's accepted. A name of 61 or more characters shows a clear message and the bill isn't saved.
4. Given the bill has an invalid field (see US-25), when I press Save, then the field's message is shown and nothing is saved.
5. Given I have several saved bills, then my history lists them newest first, and shows only my own bills.

### US-08 Open, edit and delete saved solo bills
**As a** Solo diner, **I want** to reopen, fix or remove a saved bill, **so that** my record stays accurate.
- **Job:** J2 · **Status:** Not implemented

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
- **Job:** J6 · **Status:** Not implemented

Acceptance criteria:
1. Given I enter a group name and pick a currency, when I create the group, then I'm its first and only current member, an invite code is generated automatically, and the activity log records "X created the group".
2. Given I'm choosing the group's currency, then I can pick from the default list of 12 or choose "Other" and type a symbol of 1–3 characters with no digits (same rules and message as US-06). A note tells me the currency can't be changed after the group is created.
3. Given a blank group name, or one of 51 or more characters, when I create the group, then a clear message is shown and no group is created. Names of exactly 1 and exactly 50 characters are accepted.
4. Given a group exists, then there's no way to change its currency, either on the page or by sending requests straight to the server.
5. Given a group, then all its bills, settle-ups and balances use the group's single currency.

### US-10 Add friends to a group by name
**As a** Group member, **I want** to add a friend to my group by name only, **so that** I can include them in bills even if they never create an account.
- **Job:** J8 · **Status:** Not implemented

Acceptance criteria:
1. Given I add a name-only member "Omar", then Omar can immediately be ticked as a participant, and chosen as the payer of a bill he takes part in, and the activity log records "X added Omar".
2. Given the group has 50 current members, when I add another, then I see "A group can have at most 50 members" and nobody is added.
3. Given a blank name, or one of 31 or more characters, when I add it, then a clear message is shown and nobody is added. Names of exactly 1 and exactly 30 characters are accepted.
4. Given "Omar" is a current member, when I add "Omar", "omar" or "OMAR", then I see "That name has already been used in this group" and nobody is added.
5. Given "Omar" is a removed member, when I add a new "Omar" (in any letter case), then I see "That name has already been used in this group" and nobody is added. The name stays Omar's, so restoring him always gives it back.
6. Given 49 current members and some removed members, when I add one more, then it succeeds, because removed members don't count toward the 50.

### US-11 View and copy the group's invite code
**As a** Group member, **I want** to see and copy my group's invite code, **so that** I can pass it to friends who want to take over their own name.
- **Job:** J8 · **Status:** Not implemented

Acceptance criteria:
1. Given I'm a current member, when I open the group's invite section, then I see the invite code and a Copy button.
2. Given I press Copy, then the code is copied, ready to paste.
3. Given any group, then there's no option to regenerate or change the invite code. It stays the same for the life of the group.

### US-12 Join a group by claiming my name
**As a** Group member, **I want** to enter a group's invite code and claim the name my friends added for me, **so that** I can see and manage my own part of the group's history.
- **Job:** J8 · **Status:** Not implemented

Acceptance criteria:
1. Given Omar creates an account and enters the group's invite code, when he chooses "I'm Omar", then his account is linked to that member, the group appears in his group list, he sees the full group history, and the activity log records "Omar claimed the name Omar".
2. Given a valid invite code and an account that isn't in the group, when I enter it, then I can choose from all of the group's **unclaimed** members, current or removed. Removed names are marked "(removed)".
3. Given a member already claimed by an account, then that name isn't offered, and no other account can claim it.
4. Given my account already claims a member in this group, then I can't claim a second member in the same group.
5. Given a valid invite code, then there's no option to add myself as a new name. Only current members add new names (US-10).
6. Given a new account claims a removed, unclaimed name, then that member is restored and linked to the account (restore limits from US-23 apply).
7. Given a wrong invite code, when I enter it, then I see "That invite code isn't valid" and join nothing.
8. Given I'm already a current member, when I enter the group's invite code, then I see "You're already in this group" and nothing changes.
9. Given a wrong code was entered, when I enter the correct code, then joining works without reloading the page.

---

## Group bills

### US-13 Record an equal-split group bill
**As a** Group member, **I want** to record a group bill split evenly between the people who took part, **so that** each pays an equal share that adds up exactly to the bill.
- **Job:** J3 · **Status:** Not implemented

Acceptance criteria:
1. Given a group of 10 members, when I add a bill with 5 participants, paid by one of them, then only those 5 are charged and the other 5 members' balances don't change.
2. Given a grand total of 100.00 and 3 participants, when I press Calculate, then the shares are 33.34 / 33.33 / 33.33, the first participant in list order is marked as paying the extra cent, and the shares add up to 100.00.
3. Given food 90.00, tax 0, other charges 10% and tip 0, split between 3 participants, when I press Calculate, then other charges is 9.00, the grand total is 99.00, and each share is 33.00.
4. Given food 10.00 and other charges 0.01 (amount), split between 2 participants, then the grand total is 10.01 and the shares are 5.01 and 5.00.
5. Given a grand total of 0.01 split between 2 participants, then the shares are 0.01 and 0.00.
6. Given food 1,000,000.00, tax 0, other charges blank and a 100% tip on food, split between 50 participants, then the grand total is 2,000,000.00, each share is 40,000.00, and the shares add up to the total.
7. Given food 1,000,000.00, tax 0, other charges 1,000,000.00 (amount) and tip 0, split between 3 participants, then the grand total is 2,000,000.00 and the shares are 666,666.67 / 666,666.67 / 666,666.66.
8. Given no participants are selected, when I press Calculate, then I see "Choose who took part" and no result (no division by zero).
9. Given no items, when I press Calculate, then I see "Add at least one item" and no result.
10. Given an equal-split bill, then tax, other charges and tip follow the shared rules above, including the "tip on" option.

### US-14 Record an itemized group bill
**As a** Group member, **I want** to record which items each person had, including shared dishes, **so that** everyone pays for what they had plus a fair part of tax, other charges and tip.
- **Job:** J4 · **Status:** Not implemented

Acceptance criteria:
1. Given Ali has a 40.00 steak and Sara a 10.00 salad, with tax 5.00, other charges blank and tip 10.00, when I press Calculate, then Ali's share is 52.00 and Sara's is 13.00.
2. Given the same bill with other charges 2.50 (amount), then Ali pays 2.00 and Sara 0.50 of the other charges, Ali's share is 54.00, Sara's is 13.50, and they add up to the grand total of 67.50.
3. Given 12.00 nachos ticked for Ali, Sara and Omar, then each is charged 4.00 for the nachos.
4. Given a 10.00 item shared by 3 people, then their parts are 3.34 / 3.33 / 3.33, with the extra cent going to the first ticked person.
5. Given three participants with 10.00 of food each and other charges 0.10, then their other-charges parts are 0.04 / 0.03 / 0.03: the leftover cent goes to the first participant in list order when there's a tie.
6. Given any itemized bill, then tax, other charges and tip are each split separately in proportion to each participant's food subtotal (leftover cents by largest remainder). Each of those parts adds up exactly to the bill's tax, other charges and tip.
7. Given a participant with no items, and other charges of 5.00 on the bill, then that participant's other-charges part is 0.00, and they owe 0.00 in total (food, tax, other charges and tip).
8. Given an item with nobody ticked, when I press Calculate, then I see "Choose who shared this item" next to it and no result.
9. Given any valid itemized bill, then the per-person totals add up exactly to the grand total.

### US-15 Record who paid a group bill
**As a** Group member, **I want** to record which participant paid the bill, **so that** they're credited and the others owe them.
- **Job:** J5 · **Status:** Not implemented

Acceptance criteria:
1. Given a bill's participants are Ali and Sara, then the payer list offers only Ali and Sara.
2. Given Omar is chosen as payer and then unticked as a participant, when I press Calculate or Save, then I see "The payer must be one of the people on this bill" and nothing is saved.
3. Given Ali paid 65.00 and the shares are Ali 52.00 and Sara 13.00, then Ali's balance goes up by 13.00 (65.00 paid − his own 52.00 share) and Sara's goes down by 13.00.
4. Given any bill, then exactly one payer is recorded. There is no option for several payers.
5. Given a removed member, then they're never offered as payer or participant on a new bill.

### US-16 See balances and suggested payments
**As a** Group member, **I want** to see each member's running balance and the fewest payments to settle up, **so that** I always know who owes whom.
- **Job:** J6 · **Status:** Not implemented

Acceptance criteria:
1. Given Ali paid 65.00 for a bill with shares Ali 52.00 and Sara 13.00 (and no other activity), then Ali's net balance is +13.00, Sara's is −13.00, and the suggestion reads "Sara pays Ali 13.00".
2. Given any group, then the net balances of all members always add up to exactly 0.00.
3. Given several members owe and are owed, then the suggestions use the fewest payments that bring every balance to 0.00 (largest debtor matched to largest creditor), shown as "X pays Y amount".
4. Given every balance is 0.00, then no suggestions are shown.
5. Given a removed member, then they don't appear in the balance list or the suggestions.

### US-17 Record a settle-up
**As a** Group member, **I want** to record that one member paid another back, **so that** balances reflect repayments.
- **Job:** J7 · **Status:** Not implemented

Acceptance criteria:
1. Given Sara owes Ali 13.00, when I record "Sara paid Ali 13.00", then both balances become 0.00 and the suggestion disappears.
2. Given Sara owes Ali 13.00, when I record "Sara paid Ali 20.00", then Sara's balance is +7.00, Ali's is −7.00, and the suggestion reads "Ali pays Sara 7.00" (overpaying flips the debt).
3. Given a settle-up from a member to the same member, then a clear message is shown and nothing is saved.
4. Given a settle-up amount outside 0.01–1,000,000.00, or with more than 2 decimals, letters or a blank, then a clear message is shown and nothing is saved.
5. Given a removed member, then they're never offered as either person in a new settle-up.
6. Given a settle-up, then it's a record only: no real money is moved.

### US-18 Edit and delete group bills and settle-ups
**As a** Group member, **I want** to correct or remove any group bill or settle-up, **so that** our balances stay right.
- **Job:** J6 · **Status:** Not implemented

Acceptance criteria:
1. Given any current member, then they can edit or delete any bill or settle-up in the group, not just their own.
2. Given I edit a bill or settle-up and save, then it's checked with the same rules as a new one, and the balances update.
3. Given I reopen a group bill with other charges, then its value and % / amount setting are shown exactly as saved, and editing them recalculates the bill and the balances.
4. Given I press Delete on a bill, then I'm asked to confirm. Cancel keeps it, and Confirm removes it and updates the balances.
5. Given a bill or settle-up that includes a removed member, when I try to edit or delete it, then I see "Restore Omar to change this bill" and nothing changes.

### US-19 See the group's activity log
**As a** Group member, **I want** a log of every change in the group, **so that** I can see who did what and when.
- **Job:** J9 · **Status:** Not implemented

Acceptance criteria:
1. Given any member adds, edits or deletes a bill or settle-up, then the activity log shows who did it, when, and what changed (e.g. "Sara edited 'Pizza night': 60.00 → 65.00").
2. Given a member is removed, leaves, is restored or rejoins, then the log shows "X removed Omar", "Omar left", "X restored Omar" or "Omar rejoined with the invite code".
3. Given the group is created, a member is added or a name is claimed, then the log shows "X created the group", "X added Omar" or "Omar claimed the name Omar".
4. Given any log entry, then it shows who made the change and when.
5. Given any current member, then they can see the whole log.

---

## Members leaving and coming back

### US-20 Remove a member from a group
**As a** Group member, **I want** to remove a member who has settled up, **so that** the group lists only the people still in it, without changing past bills.
- **Job:** J10 · **Status:** Not implemented

Acceptance criteria:
1. Given a member whose balance isn't 0.00, when anyone tries to remove them, then I see "Settle this member's balance before removing them" and nothing changes.
2. Given Omar's balance is 0.00, when any member removes him, then he moves to "Removed members", and the log records "X removed Omar".
3. Given a member has balance 0.00 but hasn't been removed, then they're still a normal current member (settled isn't the same as removed).
4. Given Omar is removed, when I open "Pizza night" (which he paid for), then it shows "Omar (removed)" as payer and participant, and the bill's totals and everyone's balances are exactly as before.
5. Given Omar is removed, when I add a new bill or settle-up, then he isn't offered as payer, participant or settle-up person, and he isn't in the balance list or the suggestions.
6. Given Omar is removed, when I try to edit or delete a bill or settle-up that includes him, then I see "Restore Omar to change this bill" and nothing changes.
7. Given Omar has an account and is removed, then the group disappears from his group list right away, and opening its address shows that he no longer has access. His account and solo bills are unchanged.

### US-21 Leave a group
**As a** Group member, **I want** to leave a group once I've settled up, **so that** I'm no longer part of it.
- **Job:** J10 · **Status:** Not implemented

Acceptance criteria:
1. Given my balance isn't 0.00 and another current member has an account, when I try to leave, then I see "Settle your balance before leaving" and I stay in the group.
2. Given my balance is 0.00 and another current member has an account, when I leave, then I move to "Removed members", the log records "Omar left", and the group disappears from my group list.
3. Given I've left, then my old bills keep me as "Name (removed)", and every total and balance stays the same.
4. Given I've left, then my account and solo bills are unchanged.
5. Given I'm the last current member with an account, then leaving follows US-22 instead.

### US-22 Close out a group as the last member with an account
**As a** Group member, **I want** to leave a group even when I'm the last member with an account, after a clear warning, **so that** a group nobody uses is closed for good.
- **Job:** J11 · **Status:** Not implemented

Acceptance criteria:
1. Given I'm the only current member with an account, when I press Leave, then I see: "You're the last member with an account. If you leave, this group and all its bills, settle-ups and history will be permanently deleted. Unsettled balances will be lost."
2. Given that warning, when I press Cancel, then nothing changes.
3. Given that warning, when I press Leave (whatever my balance), then the group is permanently deleted, including its members, bills, settle-ups, activity log and invite code.
4. Given a group was deleted, then it disappears for everyone, its address shows "This group no longer exists", and its invite code is no longer valid.
5. Given a group was deleted, then my account, my solo bills and my other groups are unchanged.
6. Given any group, then there's no separate "delete group" button. Deletion only happens this way.

### US-23 Restore a removed member
**As a** Group member, **I want** to bring back a member who was removed, **so that** they can take part again with one continuous history.
- **Job:** J10 · **Status:** Not implemented

Acceptance criteria:
1. Given the group has removed members, then the members page lists them under "Removed members", each with a Restore button that any current member can use.
2. Given Omar is removed, when any member presses Restore, then he's a current member again with his full history and no "(removed)" mark, and the log records "X restored Omar".
3. Given Omar had an account, when he's restored, then his access to the group returns.
4. Given Omar is restored, then bills and settle-ups that include him can be edited and deleted again.
5. Given the group already has 50 current members, when anyone tries to restore Omar, then a clear message is shown and he stays removed.
6. Given Omar is restored, then he gets his name "Omar" back. No other member can have taken it, because names are never reused within a group.

### US-24 Rejoin a group with the invite code
**As a** Group member, **I want** to rejoin a group I was removed from by entering its invite code, **so that** I can come back without waiting for someone to restore me.
- **Job:** J10 · **Status:** Not implemented

Acceptance criteria:
1. Given Omar has an account and was removed, when he enters the group's invite code, then he's restored automatically with his full history and access, and the log records "Omar rejoined with the invite code".
2. Given the group has 50 current members, when Omar enters the invite code, then a clear message is shown and he stays removed.
3. Given a group was deleted (US-22), when its old invite code is entered, then I see "That invite code isn't valid".

---

## Input checks, results and saving (all bills)

### US-25 Get a clear message for every invalid input
**As a** Solo diner or Group member, **I want** a clear message next to any field I've filled in wrongly, **so that** I never get a wrong result or a crash.
- **Job:** J14 · **Status:** Not implemented

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
12. Given 3 items of 1,000,000.00 each, when I press Calculate, then the food subtotal is 3,000,000.00 with no error (the limit is per field, not per total).
13. Given 200 items of 1,000,000.00 each, tax 100%, other charges 100% and tip 100% on food + tax, when I press Calculate, then the result is food 200,000,000.00, tax 200,000,000.00, other charges 200,000,000.00, tip 400,000,000.00, and grand total exactly 1,000,000,000.00.
14. Given an item name left blank, then it's shown as "Item N" by its position. An item name of exactly 40 characters is accepted, and 41 or more shows a clear message and no result.
15. Given any input at all, then the app never shows NaN, Infinity, "undefined", or a blank or crashed screen.
16. Given invalid data is sent straight to the server, bypassing the page, then the server rejects it and saves nothing.

### US-26 Carry on safely after a result or an error
**As a** Solo diner or Group member, **I want** results and errors to update correctly as I keep working, **so that** I never act on an out-of-date figure.
- **Job:** J14 · **Status:** Not implemented

Acceptance criteria:
1. Given an error is showing, when I fix the field and press Calculate, then the error disappears and the correct result appears, with no page reload needed.
2. Given a result is showing, when I change any input, then the old result is hidden until I press Calculate again.
3. Given a result is showing, when I switch tax, tip or other charges between % and amount, or change the "tip on" option, then the old result is hidden until I press Calculate again.
4. Given I press Calculate several times without changing anything, then the same result is shown each time.

### US-27 Keep my inputs when saving fails
**As a** Solo diner or Group member, **I want** my entries kept if a save fails, **so that** I don't have to type everything again.
- **Job:** J14 · **Status:** Not implemented

Acceptance criteria:
1. Given the server can't be reached, when I save, then I see "Couldn't save — check your connection" and all my inputs are kept.
2. Given a save failed, when the server is reachable again and I press Save, then the bill is saved normally.
3. Given the app's database stops while I'm using the app, when I save, then a clear message is shown, my inputs are kept, and nothing is half-saved. Once the database is back, saving works without restarting the app.
4. Given a save fails partway (e.g. the database stops mid-save), then none of that save is stored: no bill without its items, no balance change without its activity log entry.

### US-28 Keep my records after a restart
**As a** Solo diner or Group member, **I want** my bills, groups and balances to still be there after the app or its database restarts, **so that** my history is never lost.
- **Jobs:** J2, J6 · **Status:** Not implemented

Acceptance criteria:
1. Given I've saved solo bills, groups, group bills and settle-ups, when the app server is stopped and started again, then all of them, and all balances and activity logs, are exactly as before.
2. Given the same saved data, when the database container is stopped and started again (including `docker compose down` then `docker compose up -d`), then everything is exactly as before.

### US-29 Use the app in my usual browser
**As a** Solo diner or Group member, **I want** the app to work in the current version of my usual browser, **so that** I don't need to install anything.
- **Job:** J16 · **Status:** Not implemented

Acceptance criteria:
1. Given the current version of Chrome, Edge, Firefox or Safari, when I use every feature above, then it behaves the same way and every acceptance criterion passes.

---

## Running the app

### US-30 Run the app locally from the README
**As a** Host, **I want** to install and start the app on my computer by following the README, **so that** I can try it for free.
- **Job:** J17 · **Status:** Not implemented

Acceptance criteria:
1. Given Node.js LTS and Docker are installed, when I follow the README steps on a fresh clone (copy `.env.example` to `.env`, `docker compose up -d`, `npm install`, `npm run dev`, open the shown address), then the app runs and I can sign up locally.
2. Given the README, then it never asks for a paid account, an API key, or any third-party cloud or paid service.
3. Given the app is running, then it works with no internet-based service: accounts, data storage and calculations all happen inside the app and its own self-hosted PostgreSQL container.
4. Given the database container isn't running, when I start the app, then it prints "Can't reach the database. Start it with: docker compose up -d" and stops, with no crash trace.
5. Given a fresh database, when the app starts, then it creates its own tables automatically. No manual database setup is needed.
6. Given the database container is running, then its port is reachable only from my own computer, not from other machines on the network.
7. Given the README, then it warns that `docker compose down -v` permanently deletes all saved data, and that plain `docker compose down` keeps it.

### US-31 Deploy the app to my own server
**As a** Host, **I want** to run the same app on a server, **so that** my friends can use it for real.
- **Job:** J18 · **Status:** Not implemented

Acceptance criteria:
1. Given a server with Node.js LTS and a self-hosted PostgreSQL 18 database (e.g. the same Compose file), when I deploy the same build, then it runs, configured only through settings the app owns: port, `DATABASE_URL` and session secret.
2. Given the deployed app, then it doesn't depend on any third-party cloud or paid service.
3. Given the deployed app, then passwords are stored hashed (never as plain text), and sessions use secure cookies.
4. Given the deployed app starts against a database that already has data, then pending schema updates are applied automatically and existing data is kept.

### US-32 Run all tests with one command
**As a** Host, **I want** to run every automated test with one command, **so that** I can see for myself that the app works as described.
- **Job:** J19 · **Status:** Not implemented

Acceptance criteria:
1. Given the project is installed and the database container is running, when I run `npm test`, then the calculation, validation and server tests and the browser tests (Chromium, Firefox and WebKit, Safari's engine) all run and pass.
2. Given I have real bills saved in the app, when I run `npm test`, then the tests use only the separate test database, which is wiped and rebuilt at the start of each run, and my real data is unchanged.
3. Given I run `npm test` twice in a row, then both runs give the same results.
4. Given the database container isn't running, when I run `npm test`, then it stops at once with "Can't reach the database. Start it with: docker compose up -d".

---

## Open questions

None. Every open question has been settled in the spec and is reflected in the stories above.
