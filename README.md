# Bill Splitter

Split any bill to the exact cent, on your own or with friends, and keep a running tab of who owes whom.

- **Solo bills:** total a bill with tax, other charges (such as a service or delivery fee) and tip, then keep it in your history.
- **Groups:** record shared bills, split equally or by what each person had. See balances and the fewest payments to settle up, and invite each friend with their own link.
- **Self-contained:** the app and its PostgreSQL database run on your own computer or server. No cloud service, paid service, email address or API key is needed.

![The Dashboard, showing what you owe and what you're owed across your groups](docs/screenshots/dashboard.png)

## Contents

1. [Set up a new computer](#1-set-up-a-new-computer)
2. [Install and run the app](#2-install-and-run-the-app)
3. [Troubleshooting](#3-troubleshooting)
4. [User guide: every feature](#4-user-guide-every-feature)
5. [Running the tests](#5-running-the-tests)
6. [Running on a server](#6-running-on-a-server)
7. [Project layout and documents](#7-project-layout-and-documents)

---

## 1. Set up a new computer

You need three free tools. Install each one once.

| Tool | Why the app needs it | Version |
|---|---|---|
| [Git](https://git-scm.com/downloads) | Downloads the code | Any recent version |
| [Node.js](https://nodejs.org/) (includes `npm`) | Runs the app | LTS, version 22 or newer |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine on Linux) | Runs the app's PostgreSQL database | Any recent version with `docker compose` |

You also need a current web browser: Chrome, Edge, Firefox or Safari. Nothing else is required: no accounts, keys or paid services. Docker Desktop is free for personal use, and you can skip its optional sign-in.

### Windows 10 or 11

1. **Git:** download "Git for Windows" from <https://git-scm.com/downloads/win> and install it with the default options. It also installs **Git Bash**, a terminal in which every command in this README works exactly as written.
2. **Node.js:** download the **LTS** "Windows Installer (.msi)" from <https://nodejs.org/en/download> and install it with the default options.
3. **Docker Desktop:** download it from <https://www.docker.com/products/docker-desktop/> and install it. If it asks to turn on WSL 2, say yes, and restart the computer when asked.
4. Open **Docker Desktop** from the Start menu and wait until it shows that the engine is running.
5. Open **Git Bash** from the Start menu and use it for the commands below.

### macOS

1. **Git:** open the Terminal app and run `xcode-select --install`, then follow the prompts. If Git is already installed, it says so.
2. **Node.js:** download the **LTS** "macOS Installer (.pkg)" from <https://nodejs.org/en/download> and install it.
3. **Docker Desktop:** download the version for your chip (Apple silicon or Intel) from <https://www.docker.com/products/docker-desktop/>, drag it to Applications and open it. Wait until it shows that the engine is running.
4. Use the **Terminal** app for the commands below.

### Linux (Ubuntu or Debian)

Run these commands in a terminal:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
```

Install Node.js LTS from NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
```

Install Docker Engine, which includes `docker compose`:

```bash
curl -fsSL https://get.docker.com | sudo sh
```

Let your user run Docker without `sudo`:

```bash
sudo usermod -aG docker $USER
```

Then log out and back in.

### Check that everything is installed

Run each command. Each one should print a version number:

```bash
git --version
node --version
npm --version
docker --version
docker compose version
```

`node --version` must show `v22` or higher. If a command isn't found, see [Troubleshooting](#3-troubleshooting).

---

## 2. Install and run the app

All of the app's code lives in the `src` folder, so you run every command from there.

### First time only

1. **Download the code** and go into its `src` folder:

   ```bash
   git clone https://github.com/Sanaarshad544/sana-arshad-calculator.git
   cd sana-arshad-calculator/src
   ```

   You can also download a ZIP instead: on [the GitHub page](https://github.com/Sanaarshad544/sana-arshad-calculator), choose **Code → Download ZIP**, unzip it, and open a terminal in its `src` folder.

2. **Copy the example settings.** The values in `.env.example` are for your own computer only:

   ```bash
   cp .env.example .env
   ```

   In Windows Command Prompt, use `copy .env.example .env` instead.

3. **Start the database.** Make sure Docker Desktop is open first. The first time, Docker downloads PostgreSQL 18 and creates two databases: `bill_splitter` for the app and `bill_splitter_test` for the automated tests.

   ```bash
   docker compose up -d
   ```

4. **Install the app's packages.** This takes a minute or two:

   ```bash
   npm install
   ```

5. **Start the app:**

   ```bash
   npm run dev
   ```

   When it's ready, it prints `Bill Splitter is running at http://localhost:3000`.

6. **Open <http://localhost:3000>** in your browser and choose **Create an account**.

The app creates its own database tables the first time it starts, so there's no manual database setup.

### Every time after that

1. Open Docker Desktop (on Linux, Docker is already running).
2. In a terminal, go to the `src` folder and start the database and the app:

   ```bash
   cd sana-arshad-calculator/src
   docker compose up -d
   npm run dev
   ```

3. Open <http://localhost:3000>.

To stop the app, press **Ctrl+C** in the terminal where it's running. To stop the database as well, run `docker compose stop` or `docker compose down`.

### Your data

- Everything you save is kept in a Docker volume called `pgdata`. It survives restarting the app, restarting the computer, and `docker compose down`.
- **Warning:** `docker compose down -v` permanently deletes that volume and **all saved data**. Use plain `docker compose down` to stop the database and keep your data.
- The database only accepts connections from your own computer, never from other machines on the network.

### Trying it on your phone

While the app runs on your computer, a phone on the same Wi-Fi can open it at `http://<your computer's IP address>:3000`, for example `http://192.168.1.20:3000`. If your computer asks whether to allow incoming connections for Node.js, allow them on private networks. This is only for trying the app at home; to use it for real with friends, see [Running on a server](#6-running-on-a-server).

---

## 3. Troubleshooting

| What you see | What to do |
|---|---|
| `Can't reach the database. Start it with: docker compose up -d` | The database isn't running. Open Docker Desktop, wait until it's running, then run `docker compose up -d` in the `src` folder. |
| `Cannot connect to the Docker daemon` or `docker: command not found` | Docker Desktop isn't open yet, or was just installed. Open it, wait until it's running, then open a new terminal. On Linux, log out and back in after the `usermod` step. |
| `Missing settings: DATABASE_URL, SESSION_SECRET` | The `.env` file is missing. In the `src` folder, run `cp .env.example .env`. |
| `EADDRINUSE` or "address already in use" for port 3000 | Something else uses port 3000. In `src/.env`, change `PORT=3000` to another number, such as `PORT=3001`, and open that address instead. |
| `docker compose up -d` fails with "port is already allocated" for 5432 | Another PostgreSQL is installed on your computer. In `src/.env`, add the line `POSTGRES_PORT=5433`, and change `:5432/` to `:5433/` in both `DATABASE_URL` and `TEST_DATABASE_URL`. Then run `docker compose up -d` again. |
| `npm warn EBADENGINE`, or other errors that mention the Node.js version | Your Node.js is older than version 22. Install the current LTS from <https://nodejs.org/>, then run `npm install` again. |
| PowerShell says "running scripts is disabled on this system" | Use Git Bash or Command Prompt instead of PowerShell. |
| `npm install` fails behind a company proxy or firewall | It downloads packages from the public npm registry, so try again on a network that allows that. |

---

## 4. User guide: every feature

The screenshots in this guide use sample data: an account called **ali** and friends called Sara, Omar, Ghania and Zain, in two groups, **Weekend trip** (in Rs) and **Flat** (in $).

### 4.1 Finding your way

Once you log in, the sidebar on the left takes you to the four parts of the app:

- **Dashboard:** what you owe and are owed, your groups and your latest solo bills.
- **Solo bills:** bills just for you.
- **Groups:** your groups of friends, their shared bills and balances.
- **Settings:** your username, light or dark appearance, and **Log out**.

The page you're on is highlighted in the sidebar. On a phone, the sidebar becomes a **Menu** button at the top of the screen, which opens the same four links.

<img src="docs/screenshots/phone-menu.png" alt="On a phone, the Menu button opens the four links" width="320">

The app is in English, and amounts always show two decimals and a thousands comma, with the currency symbol in front: `$1,234.50`, `Rs 400.00`.

### 4.2 Your account

#### Create an account

On the log-in page, choose **Create an account**.

- **Username:** 3 to 30 English letters, numbers or underscores, such as `omar_99`. Usernames aren't case-sensitive, so `Sana` and `sana` are the same account.
- **Password:** at least 8 characters, of any kind (up to 128). Press the **eye** button to see what you've typed, and press it again to hide it.
- No email address or phone number is ever needed.

![The sign-up page](docs/screenshots/sign-up.png)

#### Save your recovery code

Right after you sign up, the app shows a **recovery code**. It is the only way to reset your password if you forget it, and it is never shown again. Press **Copy code** and keep it somewhere safe, then press **I've saved it, continue**.

![The recovery code shown once after sign-up](docs/screenshots/recovery-code.png)

#### Log in and log out

Enter your username and password on the log-in page. If either is wrong, you see "Username or password is incorrect", which doesn't say which one was wrong.

After 5 wrong passwords in a row, each next try has to wait, starting at 30 seconds and growing to 1, 2, 5 and then 15 minutes. Nobody is ever locked out for good: once the wait is over, the right password works.

You stay logged in for 30 days after you last used the app. To log out, go to **Settings** and press **Log out**.

![The log-in page](docs/screenshots/log-in.png)

#### Forgot your password?

On the log-in page, choose **Forgot your password?**. Enter your username, your recovery code and a new password, then press **Reset password**. You're logged in with the new password, and a **new** recovery code is shown, also only once. The old code stops working.

![Resetting a password with the recovery code](docs/screenshots/reset-password.png)

#### Privacy

Your solo bills are visible only to you. A group's bills, balances and activity are visible only to its current members. Anyone who isn't logged in is sent to the log-in page.

### 4.3 The Dashboard

You land on the Dashboard after you log in.

- **You owe / You're owed:** your totals across all your groups. Each currency gets its own line, because Rs and $ are never added together.
- Under each total, **who** you owe or who owes you, such as "From Ghania, Rs 7,531.00", with the group's name. Press the group's name to open it.
- **Your groups:** each group with your own balance in it.
- **Latest solo bills:** your newest solo bills first.
- **New solo bill** and **New group bill** buttons at the top.

When you have no groups or solo bills yet, each section explains what to do next and offers a button for it. See the screenshot at the top of this README.

### 4.4 Solo bills

A solo bill is just for you: you enter what you bought, and the app gives you the exact total.

#### Total a bill

Press **New solo bill** on the Dashboard or on the **Solo bills** page.

1. **Currency:** pick one of $, €, £, ¥, ₹, Rs, PKR, ₩, ₺, R$, CHF, AED and SAR, or choose **Other** and type your own symbol of up to 3 characters with no digits, such as `kr`. The currency is only the symbol shown next to amounts: nothing is converted. Once the bill is saved, its currency can't be changed.
2. **Bill name (optional):** if you leave it empty, the bill is named after its date, such as "Bill – 22 Oct 2026".
3. **Items:** type each item's name and price.
   - **Item names are optional:** an empty one shows as "Item 1", "Item 2" and so on.
   - **Add a line:** press **+ Add item**.
   - **Remove a line:** press the **×** next to it.
   - **Typing with the keyboard:** Enter in a name moves to its price. Enter in a price moves to the next line, adding one if needed. Enter on an empty last line calculates.
   - **Empty lines:** a line with no name and no price is left out.
4. **Tax, other charges and tip:** each has one box and a switch between **%** and the currency symbol (an amount).
   - Leave a box empty for none.
   - Tapping the switch also puts the cursor in the box.
   - Other charges is for anything else on the bill, such as a service, delivery or table fee.
   - **Tip is a % of:** a % tip can be worked out on **Items only** (the default) or on **Items + tax**.
5. **Calculate:** press **Calculate** to see the subtotal, tax, other charges, tip and total. Each % line shows its rate, such as "Tax (8.25%)" or "Tip (15% of items + tax)".

On a wide screen, **Calculate**, the results and **Save bill** sit beside the form. On a narrower screen, they're under it.

![A new solo bill with its results](docs/screenshots/solo-bill-new.png)

How the charges are worked out:

- **Tax %** and **other charges %** are a % of the items subtotal only.
- Tax is never charged on other charges or the tip, and a tip is never worked out on other charges.
- Each charge is rounded to the nearest cent separately (half a cent rounds up).
- **Total** = items subtotal + tax + other charges + tip.

#### When something is wrong

If a box holds something the app can't use, pressing **Calculate** or **Save bill** shows a message right under that box, and no result appears. Typing in the box clears its message. Examples:

- A price of "abc".
- A tax of 120%.
- A price with 3 decimals.
- A bill with no items.

![Messages under a wrong price and a tax over 100%](docs/screenshots/solo-bill-errors.png)

Changing anything after a result is shown hides the old result, so you never act on an out-of-date total. Press **Calculate** again to see the new one.

#### Save it and find it again

Press **Save bill**. While it saves, the button says "Saving…" and can't be pressed twice. You're taken to your **Solo bills** history, where the bill appears at the top marked **Saved**, and a "Bill saved" message shows in the corner for a few seconds.

![The solo bill history with the new bill marked Saved](docs/screenshots/solo-bills-list.png)

#### Open, edit or delete a saved bill

Press a bill in your history to see it as a read-only receipt. It shows each item, the subtotal, tax, other charges and tip (with their rates) and the total.

![A saved solo bill shown as a receipt](docs/screenshots/solo-bill-receipt.png)

- **Edit bill** opens the form with everything as saved. Change what you need, press **Calculate** to check, and **Save bill**. **Cancel** goes back to the receipt. A saved bill keeps its currency. To use a different one, delete the bill and add it again with the right currency.

  ![Editing a saved bill, with its currency fixed](docs/screenshots/solo-bill-edit.png)

- **Delete** asks you to confirm first. **Cancel** keeps the bill, and **Delete bill** removes it for good.

  ![The confirmation before deleting a bill](docs/screenshots/confirm-delete.png)

### 4.5 Groups

A group is a lasting circle of friends who share costs again and again, such as flatmates or a trip.

#### Create a group

Go to **Groups** and press **Create group**.

- **Group name:** up to 50 characters.
- **Currency:** the same list as solo bills, or **Other**.

You join the group under your username. You can rename yourself on the Members tab later, as **ali** became "Ali" in these screenshots.

![Creating a group](docs/screenshots/group-create.png)

The **Groups** page lists your groups with your own balance in each. **Use an invite code** is for joining your friends' groups when they send you a code (see [4.7](#47-joining-with-your-own-invite)).

![The Groups page](docs/screenshots/groups.png)

#### The group page

Open a group to see:

- **Currency:** the group's currency symbol, with a small **ⓘ** button that explains it.
- **Edit group** and **Add bill** buttons at the top.
- **Balances:** each member's running balance.
  - **Green with "+" and "is owed":** money owed to that member.
  - **Red with "−" and "owes":** money that member owes.
  - The balances always add up to exactly 0.00.
- **Suggested payments:** the fewest payments that would settle everyone up, such as "Ghania pays Ali Rs 7,531.00", each with a **Record this payment** button.
- Four tabs:
  - **Bills:** the group's bills.
  - **Settle-ups:** payments between members.
  - **Members:** who's in the group, plus invites.
  - **Activity:** a log of every change.

![A group page with balances, suggested payments and the bill list](docs/screenshots/group-page.png)

#### What the currency means

Press the **ⓘ** next to "Currency" for a reminder:

- The currency is only a symbol shown next to amounts. Nothing is converted between currencies.
- Changing it in **Edit group** changes the symbol on every bill in the group, and the numbers stay exactly the same.

![The currency note](docs/screenshots/currency-info.png)

#### Edit a group

Press **Edit group** to change the group's name or currency, then press **Save changes**. The change shows everywhere at once and is recorded in the activity log.

![Editing a group's name and currency](docs/screenshots/edit-group.png)

There's no "delete group" button. A group is deleted only when its last member with an account leaves it (see [Leave a group](#leave-a-group)).

### 4.6 Members and invites

The **Members** tab lists everyone in the group.

- **"has an account":** people who use the app themselves.
- **"not joined yet":** friends you added by name. Each of them has their own **invite code** and **Copy link** button.
- **Removed members:** people who were removed or who left, each with a **Restore** button.
- **Leave group:** at the bottom of the tab.

![The Members tab with invite codes, adding people and removed members](docs/screenshots/members.png)

#### Add a friend by name

Type their name under **Add a friend by name** and press **Add member**.

- Names can be up to 30 characters. Each name can be used once per group: "omar" and "Omar" count as the same name, even for a removed member.
- A group can have up to 50 current members. Removed members don't count.
- Your friend doesn't need an account: you can include them in bills straight away.

An **Invite** box appears with your friend's own invite code and link.

![The invite box shown right after adding a friend](docs/screenshots/invite-new-friend.png)

#### Send a friend their invite

Each friend who hasn't joined has their **own** invite code (12 letters and numbers, shown in groups of four) and link. There is no group-wide code, so nobody ever has to pick their name from a list.

- **Copy link** copies the invite link, ready to paste into a message.
- **Share** (on phones) opens your phone's share menu.
- If the browser can't copy (for example when you open the app over plain `http` from another device), the link is shown in a box so you can copy it by hand.
- You can also just send the code. Your friend types it under **Use an invite code**.

One invite covers **all** of that friend's groups. So a code is shown only to members who are in every group that friend is in. Anyone else sees "Only someone who's in all of Omar's groups can send their invite."

A friend's code changes in two cases, so an old link can't let the wrong person in:

- Someone with an account leaves or is removed from one of their groups.
- The friend is added to a group that someone who could see their code isn't in.

An old link then shows "That invite link isn't valid", so send the new one.

#### Add someone from your other groups

**Or add someone from your other groups** lists the people in your other groups. Pick one and press **Add to group**.

- **A friend who hasn't joined:** they become the **same person** in both groups, with one invite that covers both.
- **Someone with an account:** they get access to the group straight away.
- **Name already taken:** if their usual name is already used in this group, you're asked for a different name for them here.

#### Rename a member

Press **Rename** next to anyone, type the new name and press **Save name**, or press **Cancel** or Esc to stop. The new name shows everywhere, including old bills, and the old name becomes free.

![Renaming a member](docs/screenshots/rename-member.png)

#### Remove and restore members

- **Remove** works only when that member's balance is exactly 0.00. Otherwise you see "Settle this member's balance before removing them".
- **Past bills don't change:** a removed member moves to **Removed members** and shows as "Omar (removed)" on old bills. Every total and balance stays exactly the same.
- **They lose access:** if they had an account, the group disappears from their list at once. Their account and solo bills are untouched.
- **Locked bills:** bills and payments that include a removed member are read-only until that member is restored.
- **Restore:** brings them back with their full history. Any current member can do it.

#### Leave a group

**Leave group** is at the bottom of the Members tab.

- **Your balance isn't 0.00:** you first see "Settle your balance before leaving".
- **Your balance is 0.00:** you move to Removed members, the group disappears from your list, and your old bills stay as they were.
- **You're the last member with an account:** you're warned that leaving permanently deletes the group, with all its bills, payments and history. **Cancel** keeps everything. **Leave** deletes it, and its address then shows "This group no longer exists". This is the only way a group is ever deleted.

### 4.7 Joining with your own invite

This is what your friend sees when they open the invite link you sent them. It greets them by name and lists every group they've been added to.

- **I'm new here:** they create an account (and save their recovery code), and all those groups are linked to it at once.
- **I have an account:** they log in, and the groups are linked to the account they already have.

![An invite link, as the invited friend sees it](docs/screenshots/invite-page.png)

If your friend only has the code, they create an account (or log in) and go to **Groups → Use an invite code**. They can type the code in any letter case, with or without spaces or dashes, or paste the whole link.

![Entering an invite code](docs/screenshots/use-invite-code.png)

Special cases:

- **A used invite** shows "This invite has already been used", without saying whose it was.
- **A mistyped or changed code** shows "That invite link isn't valid. Check the code and try again."
- **Already in all of the invite's groups:** someone who opens a friend's link to test it sees that the invite is for someone else, with no Join button.
- **Already in some of the groups:** the app warns them not to join if they're not that friend, and asks them to confirm before anything changes.
- **Already a member of one of the groups:** that group is skipped when joining, and they're told so.

### 4.8 Group bills

To add a bill, press **Add bill** on the group page. From the Dashboard, **New group bill** first asks which group the bill is for.

![Choosing a group for a new group bill](docs/screenshots/choose-group.png)

The group bill form has everything the solo bill form has (items, tax, other charges, tip and **Calculate**), plus:

- **Who took part:** a name chip for each current member, all ticked to start. Tap a chip to untick or tick that person. **Everyone** ticks or unticks them all.
- **Who paid:** the one person who paid the bill. You start as the payer, and only people who took part can be chosen.
- **How to split:** a switch between **Equally** and **By items**. The line under it says what the chosen way means.
- **Currency:** the group's currency, with the same **ⓘ** note as the group page.

#### Split equally

Everyone who took part pays the same share of the total. If the total doesn't divide exactly, the leftover cents go one each to the first people in the list, marked with a "+1 cent" badge. The shares always add up exactly to the total.

![A group bill split equally](docs/screenshots/group-bill-equal.png)

#### Split by items

With **By items**, each item has **Shared by** chips. Tick who had it, or tap **Everyone** for something everyone shared.

- **Shared items:** an item's price is split between the people who shared it.
- **Tax, other charges and tip:** each is split in proportion to how much each person's items cost.
- **Each person's share:** the results show everyone's total, with their items, tax, other charges and tip.
- **Unticking someone from the bill:** they're removed from every item, and ticking them again brings their ticks back.
- **An item with nobody ticked:** shows "Choose who shared this item" when you press **Calculate**.

![A group bill split by items, with each person's share](docs/screenshots/group-bill-by-items.png)

#### Save, open, edit and delete

**Save bill** takes you back to the group's bill list with the new bill marked **Saved**, and updates everyone's balances.

Press a bill in the list to see it as a read-only receipt. It shows:

- every item and who shared it;
- the subtotal, tax, other charges, tip and total;
- who paid, and each person's share.

![A saved group bill shown as a receipt](docs/screenshots/group-bill-receipt.png)

- **Edit bill:** opens the form with everything as saved. Saving recalculates the bill and the balances.
- **Delete:** asks you to confirm first, then removes the bill and updates the balances.
- **Who can change bills:** any current member can edit or delete any bill in the group, not just their own.
- **Bills with a removed member:** a bill that includes someone who has been removed shows no **Edit bill** button, and **Delete** explains "Restore Omar to change this bill".

### 4.9 Balances and settling up

Each bill credits the person who paid with the whole total and charges everyone who took part their share. For example, Sara paid Rs 990.00 for "Tea stall" and her own share was Rs 264.00. Her balance went up by Rs 726.00, and Ali, Omar and Ghania's balances went down by their shares.

To record that someone paid someone back:

- Press **Record this payment** next to a suggested payment. The form opens already filled in, with who paid, who received it and the amount. Change the amount if they paid a different sum, then press **Record payment**.
- Or open the **Settle-ups** tab and press **Record a payment** to fill it in yourself.

![Recording a payment, filled in from a suggestion](docs/screenshots/record-payment.png)

A payment is only a record: the app never moves real money. Paying back more than you owe flips the debt the other way. The **Settle-ups** tab lists every payment. Press one to change its amount or people, or to delete it.

![The Settle-ups tab](docs/screenshots/settle-ups.png)

### 4.10 Activity log

The **Activity** tab lists every change in the group, newest first, with who made it and when. It covers:

- creating the group, renaming it or changing its currency;
- adding, renaming, removing and restoring members, and friends joining with their invite;
- adding, editing and deleting bills and payments. An edit shows what changed, such as "60.00 → 65.00".

![The group's activity log](docs/screenshots/activity.png)

### 4.11 Settings and appearance

**Settings** shows your username, the appearance setting and **Log out**.

- **Device (follow my device):** the default. The app is light or dark to match your computer or phone.
- **Light** or **Dark:** always that look. The choice is saved with your account, so it follows you to any computer.

![The Settings page](docs/screenshots/settings.png)

![The Dashboard in dark appearance](docs/screenshots/dashboard-dark.png)

### 4.12 On a phone

Every page works on a phone screen, from 360 pixels wide, with nothing cut off or scrolling sideways. On narrow screens, the results and **Save bill** sit under the form, and **Calculate** scrolls the results into view.

<img src="docs/screenshots/phone-group.png" alt="A group page on a phone" width="320">

### 4.13 Things the app does to help

- **Leaving a form with unsaved changes:** clicking a link or going back asks "You have unsaved changes. Leave without saving?". **Stay** keeps everything you typed, and **Leave** discards it. Closing or reloading the tab shows the browser's own warning. If you had already pressed **Save bill**, that save still finishes.

  ![The unsaved changes question](docs/screenshots/unsaved-changes.png)

- **Corner messages:** short messages such as "Bill saved", "Payment recorded" or "Member removed" appear in the corner for 5 seconds after an action.
- **No double saves:** a button says "Saving…" and can't be pressed again until the save finishes.
- **Loading:** grey placeholder shapes show while a page loads.
- **Confirming:** anything you can't undo (delete, remove, leave) asks you to confirm first. The dangerous button is red, and **Cancel** is the safe choice.
- **Your typing is kept:** if a save fails (for example, the connection drops), you see "Couldn't save — check your connection" and keep everything you typed. Nothing is ever half-saved.
- **Leaving while something saves:** if you go to another page while a save or delete is still going, it still finishes, you stay where you went, and that page updates to show it. If it fails, a red corner message says what didn't happen, such as "Bill not saved. Check your connection.", and stays for 10 seconds.
- **Keyboard and screen readers:**
  - Every feature works with the keyboard alone, with a visible focus outline.
  - Every field has a label, messages are read out with their field, and results and corner messages are announced.
  - Pages still work at 200% zoom.
- **Phone keyboards:** amount boxes open the number keyboard. Pressing Enter after a price starts the next item.

### 4.14 Rules and limits at a glance

| What | Allowed |
|---|---|
| Username | 3 to 30 English letters, numbers or underscores; not case-sensitive |
| Password | 8 to 128 characters of any kind |
| Prices and payment amounts | 0.01 to 1,000,000.00, at most 2 decimals. "1,000.50" is read as 1000.50, while "1.000,50" isn't accepted |
| Items per bill | 1 to 200. Each price is limited, not the total, so a bill can total up to 1,000,000,000.00 |
| Tax and tip | Empty (none), a % from 0 to 100 with at most 2 decimals, or an amount from 0.00 to 1,000,000.00 |
| Other charges | Empty or 0 (none), a % from 0.01 to 100, or an amount from 0.01 to 1,000,000.00 |
| Bill name | Optional, up to 60 characters |
| Item name | Optional, up to 40 characters |
| Group name | 1 to 50 characters |
| Member name | 1 to 30 characters, unique in the group (any letter case) |
| Group size | 1 to 50 current members (removed members don't count) |
| Currency | $, €, £, ¥, ₹, Rs, PKR, ₩, ₺, R$, CHF, AED, SAR, or your own symbol of 1 to 3 characters with no digits |

All maths is done in whole cents, so results are exact. The shares of every bill always add up exactly to its total.

---

## 5. Running the tests

The tests need the database container running (`docker compose up -d`).

1. **Once only:** download the three test browsers (Chromium, Firefox and WebKit, which is Safari's engine):

   ```bash
   npx playwright install chromium firefox webkit
   ```

   On Linux, add `--with-deps` to also install the system libraries the browsers need.

2. **Run every test** with one command from the `src` folder:

   ```bash
   npm test
   ```

   This runs the money maths, the input checks, the server, and the browser tests in all three browsers, including automatic accessibility checks.

The tests only use the separate `bill_splitter_test` database, which is wiped and rebuilt at the start of every run. Your own data in `bill_splitter` is never touched.

---

## 6. Running on a server

The same app runs on any server with Node.js LTS and a self-hosted PostgreSQL 18 database. You can use the same `docker-compose.yml` there, with your own database password.

1. **Settings:** set the app's three settings as environment variables, or in `src/.env`:
   - `PORT`: the port to listen on, for example `3000`.
   - `DATABASE_URL`: your database, for example `postgres://user:password@127.0.0.1:5432/bill_splitter`.
   - `SESSION_SECRET`: a long random value that protects logins, for example the output of `openssl rand -hex 32`.
2. **Build and start** the app from the `src` folder:

   ```bash
   npm install
   npm run build
   npm start
   ```

3. **HTTPS:** serve the app over HTTPS, for example behind a reverse proxy such as Caddy or nginx. In production, login cookies are marked secure, so they're only sent over HTTPS.

When a new version of the app starts, it updates the database tables automatically and keeps existing data.

The app protects logins by itself, with no outside service. Passwords are stored only as secure hashes. After 5 wrong passwords for a username, each next try has to wait. Only a few password checks run at once, so a flood of log-in attempts can't slow the app down for everyone.

---

## 7. Project layout and documents

```text
README.md          this guide
docs/              product documents and the screenshots used above
src/               all of the app's code
  client/          the web pages (React)
  server/          the server and its database queries (Express)
  shared/          rules and money maths used by both
  tests/           unit, server and browser tests
  docker/          database setup used by docker-compose.yml
```

The product documents describe:

- who the app is for, in [app roles](docs/app-roles.md);
- what they need to get done, in [jobs to be done](docs/jobs-to-be-done.md);
- every [user story](docs/user-stories.md), with its acceptance criteria and whether it's implemented today.
