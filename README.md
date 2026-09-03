# Office Equipment Inventory Management System

A small full-stack app (Node.js + Express + MongoDB, vanilla JS frontend) for
tracking office equipment: who has what, borrowing, and returning.

## Features

- **No login of its own** — sign-in happens entirely at the AI Hub, with Microsoft
  (see "Single sign-on with the AI Hub" below). This app has no login or registration
  page anymore; opening it without a session redirects to the Hub.
- **Borrow / Reserve tab** — one tab, two steps. Step 2 is locked until step 1 is
  complete, so an event always exists before any equipment is picked.

  **Step 1 — create the event.** Enter an **Event Name** and pick an **Event Type**
  (Kit Claiming, Entractiv, Timing, Fulfillment, Admin), then choose one of:
  - **Borrow** — the start is fixed to the current date and time (shown, not editable);
    you're only asked for the **Return Date / Event End**.
  - **Reserve** — you're asked for both the **Start Date / Event Start** and the
    **Return Date / Event End**.

  Next stays disabled until all of that is valid (name, type, mode, dates in the
  future, end after start — plus the on-behalf Employee ID for Admin). Clicking
  step 2 in the stepper before then is refused with an explanation.

  **Step 2 — select the equipment.** The whole inventory is grouped by the `team`
  column into collapsible sections (`Entractiv`, `Timing`, and `Unassigned` for
  anything not tagged yet). Expanding a team reveals **category tabs**; each category
  is its own card listing that category's items with a checkbox. Ticking a box pools
  the item into the cart shown at the bottom; **Complete** tags every pooled item to
  the employee under the event from step 1.

  Items that are already borrowed or reserved stay visible rather than being hidden:
  the row is highlighted, its checkbox is inert, and it shows the **event name and
  dates** of the hold that already has it, plus who holds it. What's selectable
  differs by mode — a Borrow can take an item that merely has an upcoming (not yet
  started) reservation, or one the borrower has reserved themselves; a Reserve can't.

  A **Miscellaneous Items** checklist sits below the picker with the 8 consumables
  (Masking Tape, Duct Tape, Zip Tie, Stickers, Printer Cable, HDMI Cable, DK-2205,
  Scissors) and a +/- stepper for each. A filter box narrows the picker by ID, item
  or category, and the barcode **Scan** button ticks the scanned item directly.
- **Return tab** — type or scan an Equipment ID to add it to a return cart. Pressing
  **Complete** sets those items back to `Available`, clears the assigned Employee ID,
  and clears the Event Type. An item returned while still inside an active reservation
  window goes back to `Reserved` instead, so nobody else can grab it out from under
  that hold.
- **View Inventory tab** — a live table of every piece of equipment: ID, item, **team**,
  status, an **editable Comment field** (click in, edit, then press Enter or click away
  to save), current borrower, and event. Admin can edit any cell here, including
  assigning an item's Team from a dropdown.

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
| category        | String  | groups items into cards within a team, e.g. "Camera" |
| team            | String  | `Entractiv`, `Timing`, or blank (shown "Unassigned") |
| employeeId      | String  | current borrower's ID, or `null`                     |
| purpose         | String  | the Event Type — one of the 5 options below, or `null` |
| event           | String  | the Event Name entered alongside it, or `null`       |
| lastBorrowedBy  | String  | ID of whoever last borrowed it (survives a return)   |
| lastBorrowedAt  | Date    | when that last borrow happened (survives a return)   |

Event Type options (step 1 of the Borrow/Reserve tab, required whenever equipment
is included): `Kit Claiming`, `Entractiv`, `Timing`, `Fulfillment`, `Admin`. These
are stored in the `purpose` field, which is what this list used to be called — the
name was left alone so no data migration was needed and the Word export keeps
working. Along with `employeeId` and `event`, it's cleared back to `null` whenever
the item is returned — `lastBorrowedBy`/`lastBorrowedAt` are intentionally left
alone so history isn't lost.

`team` is what step 2 of the Borrow/Reserve tab groups the inventory by. Items
without it are grouped under **Unassigned** rather than dropped from the picker, so
nothing becomes un-borrowable just because it hasn't been tagged yet. Assign it from
the View Inventory tab's Team column (Admin only), or via a CSV import that includes
a `team` column. To give every existing document the field explicitly:

```bash
npm run backfill-team
```

That only touches documents missing the field — existing values are never
overwritten — and prints a breakdown by team when it's done.

Two supporting collections make the app work end-to-end without adding columns
to the table above:
- `employees` — see below; the shared identity store the AI Hub also writes to.
- `misclogs` — records of miscellaneous items borrowed, used for the Word export.

`employees` documents now come from two different eras and can have different shapes:

| Field          | Type   | Notes                                                                 |
|----------------|--------|------------------------------------------------------------------------|
| employeeId     | String | this system's own business ID - unique among documents that HAVE one (see below). Used everywhere as the "who is this" identity key (borrowing, reserving, the Admin check). |
| name           | String | display name.                                                          |
| email          | String | set on Microsoft sign-in accounts; unique among documents that have one.|
| microsoftOid   | String | that account's immutable Azure AD object id, for reference.            |
| password       | String | bcrypt hash - legacy leftover on accounts created back when this app had its own registration page. Nothing in *this* app reads it and nothing can create one any more, but the AI Hub can optionally check it: its `ALLOW_PASSWORD_LOGIN` switch turns on a manual employee-ID + password sign-in for exactly these accounts. Leave the hash in place if you want that fallback to work for an account; drop it (`$unset`) if you don't. |
| createdAt / lastLoginAt / updatedAt | Date | bookkeeping, not read by the app. |

Employees now sign in with Microsoft at the AI Hub, which creates or updates this
document by `email` on every sign-in - but never sets `employeeId` itself. That's a
manual step: an admin sets it directly in MongoDB once they know who a new Microsoft
sign-in actually is (`db.employees.updateOne({ email: "..." }, { $set: { employeeId: "..." } })`).
Until that happens, the account can still sign in and look around, but anything keyed on
employeeId won't work for it yet (the dashboard shows a banner explaining this). Because
of that, `employeeId`'s uniqueness is enforced with a **partial** index - it only applies
to documents that actually have a (string) employeeId, so any number of not-yet-tagged
Microsoft accounts can coexist (see `db.js`). If you're tagging an account with an
employeeId some *older*, password-era document already used, clear or delete that old
document's employeeId first - the partial index still won't allow two documents to share
one.

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

Employees now sign in once, at the AI Hub - with Microsoft, not a password - not here.
This app's role is to accept a one-time hand-off token from the Hub and turn it into its
own session cookie - see `/sso` in `server.js` and `middleware/auth.js`.

The old password login and registration flow is **gone**: `public/register.html`,
`public/js/register.js` and `routes/auth.js` (which served `POST /api/auth/register` and
`POST /api/auth/login`) have all been deleted, along with the `bcryptjs` dependency and
the `ACCESS_CODE` env var that gated registration. The only `/api/auth/*` routes left are
`GET /api/auth/me` and `POST /api/auth/logout`, both defined directly in `server.js`, plus
the `GET /logout` hop the Hub's logout chain calls.

New employees need no registration step here at all now - signing in with Microsoft at the
Hub creates their `employees` record, and the Hub asks them for their employee number on
that first sign-in and writes it to that same record (see the Hub's README).

The Hub can also offer a manual employee-ID + password sign-in as a fallback, switched on
and off with its own `ALLOW_PASSWORD_LOGIN` env var. That only works for accounts that
still carry a bcrypt `password` hash from this app's old registration page, and it changes
nothing here: whichever way someone signs in at the Hub, this app still just receives a
hand-off token and mints its own session from it.

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

### Logging out everywhere

Logging out at the Hub also logs out of this app - `GET /logout` is this app's half of
that: it clears this app's own session cookie, then redirects on to whatever `returnTo`
the Hub's logout chain gave it (validated to make sure it actually points back at the
configured `HUB_URL`, since this route takes no session to call). It's a plain page
redirect rather than a background request on purpose - a fetch from the Hub's own domain
can't reliably clear this app's cookie across domains once third-party cookie blocking is
in play, no matter how CORS is configured, but a real top-level navigation to this app's
own domain doesn't run into that at all.

The dashboard's own **Return to Hub** button is unrelated and does *not* log out - it's
just a link back, so returning here later in the same session doesn't ask for a password
again. If a second SSO-enabled tool is ever added on the Hub side, giving it this same
`GET /logout?returnTo=...` contract (clear its own cookie, validate returnTo, redirect) is
all that's needed for the Hub to include it in the same logout chain automatically.

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
├── constants.js              Collection names, Event-type/Team/Misc-item option lists
├── routes/
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

This is built for a trusted internal office tool. Sign-in happens at the Hub, normally with
Microsoft and gated to `@itemhound.com` accounts (checked both by the Azure app
registration's own tenant restriction and independently by the Hub's own domain check).
The Hub's optional `ALLOW_PASSWORD_LOGIN` switch can additionally accept the legacy
bcrypt-hashed passwords described above; while that's on, those accounts are a second way
in that skips the domain restriction, so keep it off unless you need it and make sure no
old seeded demo account (`EMP001`-`EMP003`, password `password123`) still has a hash.
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
