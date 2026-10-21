# App Roles

Who uses the Bill Splitting Calculator. Each role is a different kind of person with different needs. Jobs are in [jobs-to-be-done.md](jobs-to-be-done.md), and stories are in [user-stories.md](user-stories.md).

## Solo diner

A **Solo diner** is someone who eats out, orders in or shops on their own and pays their own bill. They want to know the exact amount to pay, including tax, any other charges (such as a service, delivery or table fee) and tip, and they want a private record of what they've spent.

They can:
- create an account with a username and password, receive a one-time recovery code, log in, log out, and reset a forgotten password with that code
- enter a bill's items, tax, other charges and tip, each of tax, other charges and tip as a % or an amount, and choose whether a % tip is on the food only or on the food + tax
- pick the bill's currency symbol, press Calculate and see the subtotal, tax, other charges, tip and total, exact to the cent
- save the bill to their personal history, then reopen, edit or delete saved bills

They must never:
- see another person's solo bills, or have their own solo bills seen or changed by anyone else, even by typing a page address directly
- change a solo bill's currency once that bill has been saved
- be shown a wrong, stale or broken result (such as NaN, Infinity or "undefined") for any input

## Group member

A **Group member** belongs to one or more lasting groups of friends who share costs again and again: meals, trips, groceries. Every member has equal rights; there is no admin or organizer. A bill may involve the whole group or only the members who took part, and one person usually pays the bill for everyone. They want to know, at any time, who owes whom across all the group's bills, and the fewest payments needed to settle up.

They can:
- create a group with a name and a currency, and add friends to it by name, even friends who never create an account
- view the group's invite code and copy it, and use an invite code to join a group by claiming their name, or to rejoin a group they were removed from
- record a group bill: choose who took part, who paid (one of the people who took part) and whether to split it equally or by items, with shared items split between the people who had them
- see every member's running balance and the suggested payments to settle up, and record settle-ups (repayments) of any valid amount
- add, edit or delete any group bill or settle-up, and see every change in the group's activity log
- remove a member whose balance is 0.00, leave the group when their own balance is 0.00, and restore removed members
- as the last member with an account, leave after a warning, which permanently deletes the group

They must never:
- see or open a group they don't belong to, including a group they've been removed from
- remove another member, or leave themselves, while that member's balance isn't 0.00. The one exception is the last member with an account leaving, which deletes the group after a warning.
- record a bill whose payer isn't one of the people who took part in it
- edit or delete a bill or settle-up that includes a removed member, until that member is restored
- change the group's currency after the group is created
- create a brand-new member by entering an invite code; only current members add new names

## Host

A **Host** is someone who installs and runs their own copy of the app. This is either a reviewer checking the project on their own computer, or someone running it on a server so their friends can use it. They don't need to know how the app works inside, but they need it to start reliably by following the README, with nothing to buy or sign up for.

They can:
- install it with only free software (Node.js LTS and Docker), start its own PostgreSQL database container, and start the app by following the README
- run it on a server, configured only through settings the app owns (port, `DATABASE_URL`, session secret), with a self-hosted PostgreSQL database
- run all of the app's automated tests with one command, against a separate test database that never touches real data

They must never:
- need a paid account, an API key or any third-party cloud or paid service to install, run, test or deploy the app. The PostgreSQL database is self-hosted and runs in their own container.
- lose saved data by restarting the app or the database container

## How the roles differ

| Need | Solo diner | Group member | Host |
|---|---|---|---|
| Main question | "What do I owe for this bill?" | "Who owes whom across all our bills?" | "Does it run and work as promised?" |
| Who sees the data | Only them | Only the group's current members | Doesn't use bill data |
| Splitting | None, one person pays everything | Equal or by items, among the people who took part | — |
| Payer and balances | Not needed | One payer per bill, running balances, settle-ups | — |
| Changing records | Their own bills only | Any group bill or settle-up, with every change logged | — |
| Account needed | Yes | Yes, to log in; friends without accounts appear as name-only members | No app account needed to install or run |

## Notes

- **One person can hold several roles.** The same account can keep solo bills (Solo diner) and belong to groups (Group member).
- **Name-only members are not a role.** Friends who never sign up exist only as names inside a group. They can be chosen as a participant, and as the payer of bills they took part in, but they never use the app themselves unless they later create an account and claim their name.
