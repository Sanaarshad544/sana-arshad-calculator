# Bill Splitting Calculator

## What It Is

A web app for splitting and tracking bills, exact to the cent.

- **Solo bills:** enter your items, tax, any other charges (such as a service, delivery or table fee) and tip, press **Calculate**, and see exactly what you owe. Save bills to a private history, then reopen, edit or delete them.
- **Groups:** keep lasting groups of friends. Any member can record a bill, say who paid and who took part, and split it equally or by what each person had (shared items included). The app keeps running balances, suggests the fewest payments to settle up, and records repayments. Every change is listed in the group's activity log.
- **Accounts:** a username and password, with a one-time recovery code for resetting a forgotten password. No email address or phone number is needed.
- **Exact money:** all maths uses whole cents, and every invalid entry gets a clear message instead of a wrong result.

The app is self-contained. It uses no third-party cloud or paid service: accounts, data and calculations all live in the app and its own PostgreSQL database, which runs in a Docker container on your computer or server.

The product documents are in [`docs/`](docs): who the app is for ([app roles](docs/app-roles.md)), what they need to get done ([jobs to be done](docs/jobs-to-be-done.md)), and every [user story](docs/user-stories.md) with its acceptance criteria and whether it is implemented today.

## Who It's For

- **Solo diners and shoppers** who want to know the exact amount to pay, tax, fees and tip included, and keep a record of what they spent.
- **Groups of friends** who share costs again and again (meals, trips, groceries) and want to know at any time who owes whom.
- **Hosts:** anyone who wants to try the app on their own computer, or run it on a server for their friends, using only free software.

It works in the current version of Chrome, Edge, Firefox and Safari, on a computer or a phone.

## Prerequisites

Two free tools:

- **[Node.js](https://nodejs.org/) LTS** (version 22 or later), which includes `npm`.
- **[Docker](https://docs.docker.com/get-started/get-docker/)** with Docker Compose, to run the database. Docker Desktop is free for personal use; on Linux, Docker Engine works too.

You don't need any account, API key or paid service.

## Installation

All the code lives in the `src` folder, so run every command from there.

1. Get the code and go into the `src` folder:

   ```bash
   git clone <this repository's address> bill-splitter
   cd bill-splitter/src
   ```

2. Copy the example settings. The values in `.env.example` are for your own computer only:

   ```bash
   cp .env.example .env
   ```

3. Start the database. The first time, Docker downloads PostgreSQL 18 and creates two databases: `bill_splitter` for the app and `bill_splitter_test` for the automated tests.

   ```bash
   docker compose up -d
   ```

4. Install the app's packages:

   ```bash
   npm install
   ```

The app creates its own tables the first time it starts, so there is no manual database setup.

## Running the App

From the `src` folder:

```bash
npm run dev
```

Then open the address it prints, normally <http://localhost:3000>, and create an account.

If the database isn't running, the app stops with "Can't reach the database. Start it with: docker compose up -d".

### Your data

- Your data is kept in a Docker volume, so it survives restarting the app, restarting the computer, and `docker compose down`.
- **Warning:** `docker compose down -v` permanently deletes the volume and **all saved data**. Use plain `docker compose down` to stop the database and keep your data.
- The database port only accepts connections from your own computer, not from other machines on the network.

### Running the tests

The tests need the database container running. The first time only, download the three test browsers (Chromium, Firefox and WebKit, which is Safari's engine):

```bash
npx playwright install chromium firefox webkit
```

Then run every test (money maths, input checks, server, and the browser tests in all three browsers, including automatic accessibility checks) with one command:

```bash
npm test
```

The tests only use the separate `bill_splitter_test` database, which is wiped and rebuilt at the start of every run. Your own data in `bill_splitter` is never touched.

### Running on a server

The same app runs on any server with Node.js LTS and a self-hosted PostgreSQL 18 database. You can use the same `docker-compose.yml` there, with your own database password.

1. Set the app's three settings as environment variables (or in `src/.env`):
   - `PORT`: the port to listen on, for example `3000`.
   - `DATABASE_URL`: your database, for example `postgres://user:password@127.0.0.1:5432/bill_splitter`.
   - `SESSION_SECRET`: a long random value that protects logins, for example the output of `openssl rand -hex 32`.
2. Build and start the app from the `src` folder:

   ```bash
   npm install
   npm run build
   npm start
   ```

3. Serve it over HTTPS, for example behind a reverse proxy such as Caddy or nginx. In production, login cookies are marked secure, so they are only sent over HTTPS.

When a new version of the app starts, it updates the database's tables automatically and keeps existing data.

The app protects logins by itself, with no outside service. After 5 wrong passwords for a username, each next try has to wait (30 seconds, growing to 15 minutes), and only a few password checks run at once, so a flood of logins can't slow the app down for everyone. Nobody is ever locked out for good.
