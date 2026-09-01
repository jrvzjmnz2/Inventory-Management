# Office Equipment Inventory Management System

A small full-stack app (Node.js + Express + MongoDB, vanilla JS frontend) for
tracking office equipment: who has what, borrowing, and returning.

## Features

- **Login page** — sign-in now happens at the AI Hub, not here (see "Single sign-on
  with the AI Hub" below). This app still has its own `/api/auth/register` endpoint
  for creating new employee accounts, at `public/register.html`.
- **Borrow tab** — type an Equipment ID to add it to a cart. Items already borrowed by
  someone else are rejected with the current borrower's name shown, so you can pick
  another item. Below the equipment cart, a **Miscellaneous Items** checklist lists all
  6 consumables (Masking Tape, Duct Tape, Zip Tie, Stickers, Printer Cable, HDMI Cable);
  check the ones you're taking and use the +/- stepper to set the amount for each. A
  **Purpose** dropdown (Entractiv, Fulfillment, Timing, Bib Production, Office & Admin,
  Kit Claiming) is required before completing a borrow that includes equipment, and is
  saved against every item in that transaction. Pressing **Complete** marks every
  equipment item in the cart `Unavailable`, assigns it to the logged-in employee, and
  records the chosen Purpose. **Export to Word** then downloads a `.docx` listing
  everything currently borrowed by that employee (including Purpose), plus the
  miscellaneous items just logged.
- **Return tab** — type an Equipment ID to add it to a return cart. Pressing **Complete**
  sets those items back to `Available`, clears the assigned Employee ID, and clears the
  Purpose.
- **View Inventory tab** — a live table of every piece of equipment: ID, item, status,
  an **editable Comment field** (click in, edit, then press Enter or click away to save),
  current borrower, and Purpose (if any).

## Data model

The app talks to MongoDB directly through the official `mongodb` Node.js
driver (no ODM/schema layer) via a single shared connection in `db.js`.
Collection and database names are configured through environment variables
rather than hardcoded, so they're set explicitly in `.env`:

- `MONGO_URI` — your connection string (Atlas `mongodb+srv://` or local `mongodb://`)
- `MONGO_DB_NAME` — which database on that cluster/instance to use (defaults to `inventory`)

The core `equipment` collection has these fields:

| Field           | Type    | Notes                                              |
|-----------------|---------|-----------------------------------------------------|
| equipmentId     | String  | unique, e.g. `EQ001`                                 |
| item            | String  | display name, e.g. "Dell Laptop"                     |
| status          | String  | `Available` or `Unavailable`                         |
| comment         | String  | free text, e.g. specs/condition                      |
| additionalInfo  | String  | free text, editable from the View Inventory tab      |
| employeeId      | String  | current borrower's ID, or `null`                     |
| purpose         | String  | one of the 6 fixed options below, or `null`          |
| event           | String  | free text entered alongside Purpose, or `null`       |
| lastBorrowedBy  | String  | ID of whoever last borrowed it (survives a return)   |
| lastBorrowedAt  | Date    | when that last borrow happened (survives a return)   |

Purpose options (chosen from a dropdown on the Borrow tab, required whenever
equipment is included in a borrow transaction): `Entractiv`, `Fulfillment`,
`Timing`, `Bib Production`, `Office & Admin`, `Kit Claiming`. Along with
`employeeId` and `event`, it's cleared back to `null` whenever the item is
returned — `lastBorrowedBy`/`lastBorrowedAt` are intentionally left alone so
history isn't lost.

Two supporting collections make the app work end-to-end without adding columns
to the table above:
- `employees` — employeeId, name, hashed password (used for login only).
- `misclogs` — records of miscellaneous items borrowed, used for the Word export.

Collection names are defined once in `constants.js` if you ever need to point
this at differently-named collections.

## Requirements

- [Node.js](https://nodejs.org) v18 or later
- A MongoDB database — either a hosted cluster (e.g. MongoDB Atlas) or MongoDB
  running locally on port `27017`. The app reads the connection string from
  `MONGO_URI` and the database name from `MONGO_DB_NAME` in `.env`.

### Troubleshooting: `querySrv ECONNREFUSED`

If you see `Failed to connect to MongoDB: querySrv ECONNREFUSED ...`, your
network is blocking or failing the special `SRV` DNS record that
`mongodb+srv://` connection strings depend on (common on some ISPs, routers,
VPNs, and corporate networks) — it's unrelated to your credentials or the app
code. `db.js` already forces Node to use Google/Cloudflare DNS (`8.8.8.8`,
`1.1.1.1`) instead of your system's default resolver, which fixes this in
most cases.

To see exactly what's being blocked, run:

```bash
npm run check-dns
```

This tests the same SRV lookup against your system's default DNS, Google, and
Cloudflare. If Google/Cloudflare succeed, the fix above should already have
you connecting. If **all three fail**, DNS traffic itself is being blocked
outbound on your network — get the "standard connection string" (non-SRV,
looks like `mongodb://host1:27017,host2:27017,host3:27017/...`) from Atlas's
Database → Connect → Drivers screen instead, and use that as `MONGO_URI`;
it skips the SRV lookup entirely.

### On the native MongoDB driver

This project talks to MongoDB using the official `mongodb` driver directly
(`^6.x`) rather than an ODM like Mongoose. `db.js` opens one shared
`MongoClient` connection on startup and also (re-)creates unique indexes on
`employees.employeeId` and `equipment.equipmentId` every time the server
starts — this is what used to be handled by Mongoose's `unique: true` schema
option. Index creation is safe to repeat; it only warns (rather than
crashing) if there's pre-existing duplicate data to resolve first.

**Don't run `npm install` right after pulling these changes without also
deleting your old `package-lock.json`** if you still have one from before —
it will reference the now-removed `mongoose` package. A fresh `npm install`
regenerates it correctly.

## Setup

```bash
cd inventory-management-system
npm install
cp .env.example .env
```

Edit `.env` and set `MONGO_URI` to your database's connection string — an
Atlas `mongodb+srv://` URI, or a local `mongodb://localhost:27017/...` URI if
you're running MongoDB yourself — and `MONGO_DB_NAME` to the database you
want to use on that cluster/instance. Then seed some sample data:

```bash
npm run seed
```

This creates 3 sample employees and 10 sample pieces of equipment. Sample login:

```
Employee ID: EMP001
Password:    password123
```

(EMP002 and EMP003 use the same password.)

`seed.js` refuses to run if it finds existing employees or equipment already
in the target database, so it can't accidentally wipe real data — pass
`--force` (`npm run seed -- --force`) if you genuinely want to reset it.

## Single sign-on with the AI Hub

Employees now sign in once, at the AI Hub, not here. This app's role is to accept a
one-time hand-off token from the Hub and turn it into its own session cookie - see
`/sso` in `server.js` and `middleware/auth.js`.

Add these to `.env` (already present if you copied `.env.example` after this change):

| Variable            | What it's for                                                            |
|---------------------|----------------------------------------------------------------------------|
| `SSO_SHARED_SECRET`  | Must be **identical** to the AI Hub's own `SSO_SHARED_SECRET`.             |
| `SESSION_SECRET`     | Random value, signs this app's own login cookie. Not shared with the Hub.  |
| `HUB_URL`            | Where the Hub is reachable - `http://localhost:5173` in dev.               |

With both apps running locally and those secrets matching, opening this app directly
(no session yet) should redirect to the Hub's login screen; clicking its tile on the Hub
after logging in there should land straight on `/dashboard.html`, skipping any local login
form. The AI Hub's own README has a step-by-step checklist for testing the whole flow.

## Running

```bash
npm start
```

Then open **http://localhost:3000** in your browser. Without a session you'll be sent
to the AI Hub's login screen (`HUB_URL` in `.env`) rather than a local login page - see
"Single sign-on with the AI Hub" below.

For development with auto-restart on file changes:

```bash
npm run dev
```

## Project structure

```
inventory-management-system/
├── server.js              Express app entry point, connects to MongoDB
├── seed.js                 Populates sample employees + equipment
├── db.js                    Shared MongoClient connection + index setup
├── constants.js              Collection names, Purpose/Misc-item option lists
├── routes/
│   ├── auth.js               /api/auth/login, /api/auth/register
│   ├── equipment.js           /api/equipment, /api/equipment/:id
│   ├── borrow.js               /api/borrow/complete, /api/borrow/misc-items
│   ├── return.js                /api/return/complete
│   └── export.js                 /api/export/:employeeId (generates .docx)
└── public/
    ├── index.html            Login page
    ├── dashboard.html         Borrow / Return / View Inventory tabs
    ├── css/style.css
    ├── js/
    │   ├── login.js
    │   └── dashboard.js
    └── mobile/                Mobile web app (same backend, own frontend)
```

## Mobile app

`public/mobile/` is a mobile-optimized version of the same app (bottom nav,
larger tap targets, a barcode Scan button on the Borrow tab) served by the
same backend — visit `/mobile/index.html` on a phone's browser.

It's a full **installable PWA**: it has a web app manifest and service
worker, so Chrome on Android will offer an **"Add to Home Screen" / "Install
app"** prompt. That gives you a real home-screen icon and a standalone
app-like window with no browser chrome — no build step required, just visit
the page.

If you specifically need a `.apk` file (e.g. to sideshare it without a URL),
see **`CAPACITOR.md`** for step-by-step instructions to wrap it with
[Capacitor](https://capacitorjs.com) — that requires Android Studio on your
own machine and isn't something that can be produced from this chat.

⚠️ Camera access for the barcode scanner requires HTTPS (or `localhost`) —
plain HTTP will silently fail to open the camera.



When you add an Equipment ID to the Borrow cart, the client immediately checks
its status. If it's already `Unavailable`, the request is rejected right there and
the current borrower's name is shown. The server also re-checks every item's status
at the moment you press **Complete** (not just when it was added to the cart), so if
two employees try to borrow the same item at nearly the same time, the second one
gets a clear conflict message instead of silently overwriting the first.

## Notes on the Word export

Export bundles two things for the logged-in employee into a single `.docx`:
1. Every equipment item where `status = Unavailable` and `employeeId` matches them.
2. Every miscellaneous item they've logged that hasn't been included in a previous
   export yet (so re-exporting later won't duplicate old entries).

## Security note

This is built for a trusted internal office tool. Passwords are hashed with bcrypt.
Every API route except `/api/auth/*` now requires a valid session cookie
(`middleware/auth.js`), issued either by logging in through the AI Hub or by the
`/sso` hand-off route - previously these routes trusted whatever `employeeId` the
request body claimed, which anyone calling the API directly could fake. The one
exception still worth knowing about: borrow/reserve/return still accept a target
`employeeId` in the request body for the Admin "acting on behalf of" feature - only
the *admin* privilege check itself (`routes/equipment.js`'s `requireAdmin`) was
switched to trust the verified session instead of the request body. There's still
no rate limiting - add that if this is ever exposed beyond employees on a trusted
network.
