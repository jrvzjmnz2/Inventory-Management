# Deploying the backend to Render

This walks through putting `server.js` on Render so it's reachable from
anywhere (not just your own machine) - which the standalone mobile app needs,
and which also gives the web dashboard a stable HTTPS URL instead of
`localhost`.

Your MongoDB data isn't moving - it's already on Atlas. This only deploys the
Node/Express app that talks to it.

## 0. Prerequisites

- A GitHub account (Render deploys from a Git repo)
- A [Render](https://render.com) account (free to sign up)
- Your MongoDB Atlas cluster's connection string (the same `MONGO_URI` you
  have in your local `.env` file)

## 1. Push the project to GitHub

Render builds from a Git repository, and this project isn't in one yet.

```bash
cd inventory-management-system
git init
git add .
git commit -m "Initial commit"
```

`.gitignore` already excludes `node_modules/` and `.env`, so your real
database credentials won't be committed.

Create a new repository on GitHub (github.com → New repository), then:

```bash
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git branch -M main
git push -u origin main
```

## 2. Let Render reach your MongoDB Atlas cluster

Render's outbound IPs aren't fixed on the free/starter plans, so Atlas needs
to accept connections from anywhere:

1. Log into [MongoDB Atlas](https://cloud.mongodb.com)
2. Go to your project → **Network Access**
3. **Add IP Address** → **Allow Access from Anywhere** (`0.0.0.0/0`) → Confirm

(If you'd rather not open it to all IPs, Render's paid plans support static
outbound IPs you can allowlist instead - not necessary to start.)

## 3. Create the Web Service on Render

1. Log into [Render](https://dashboard.render.com)
2. **New** → **Web Service**
3. Connect your GitHub account if you haven't already, then select the repo
   you just pushed
4. Fill in the settings:

   | Field | Value |
   | --- | --- |
   | Name | `inventory-management-system` (or anything you like) |
   | Region | whichever is closest to you |
   | Branch | `main` |
   | Root Directory | leave blank |
   | Runtime | `Node` |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | **Free** (fine to start - see the note below) |

## 4. Add your environment variables

Still on the same setup screen (or under **Environment** after creating the
service), add:

| Key | Value |
| --- | --- |
| `MONGO_URI` | your real Atlas connection string, e.g. `mongodb+srv://admin_test:testadmin@inventorymanagement.xzkep1r.mongodb.net/?appName=inventoryManagement` |
| `MONGO_DB_NAME` | `inventory` |

Don't add `PORT` - Render assigns its own port automatically and `server.js`
already reads it via `process.env.PORT`, falling back to 3000 only when
that's not set (i.e. when you run it locally).

## 5. Deploy

Click **Create Web Service**. Render will run `npm install`, then
`npm start`, and show you live build/deploy logs. First deploy usually takes
a couple of minutes.

Once it says **Live**, you'll get a URL like:

```
https://inventory-management-system.onrender.com
```

## 6. Verify it

- Visit `https://<your-app>.onrender.com/` in a browser - you should see the
  login page (the same `public/dashboard.html`/`index.html` your local
  server shows).
- Try logging in, or hit `https://<your-app>.onrender.com/api/equipment`
  directly to confirm it's returning JSON from your Atlas data.
- Check the **Logs** tab on Render if anything fails - a bad `MONGO_URI` or
  a blocked Atlas IP are the most common first-deploy issues, and both show
  up clearly there.

## 7. Point the mobile app at it

Edit `public/mobile/js/config.js`:

```js
const API_BASE_URL = 'https://inventory-management-system.onrender.com';
```

Then, from your own machine:

```bash
npx cap sync android
```

...and rebuild the APK (see `CAPACITOR.md`) and reinstall it on your phone.

## Notes

- **Auto-deploy**: by default Render redeploys automatically every time you
  push to `main`. You can turn this off in the service's settings if you'd
  rather deploy manually.
- **Free tier cold starts**: a free Render web service spins down after
  ~15 minutes of no traffic. The next request after that wakes it back up,
  but takes 30-60 seconds. Fine for testing; if that delay is a problem for
  real day-to-day use (e.g. someone scanning equipment and waiting on the
  first request of the day), upgrade the instance type to a paid plan, which
  stays running continuously.
- **HTTPS**: Render gives you a free HTTPS certificate automatically on the
  `.onrender.com` domain - no extra setup needed.
- **Custom domain**: optional. Under the service's **Settings → Custom
  Domain**, you can point your own domain at it instead of the `.onrender.com`
  one.
- **Seeding data**: if you need to run `npm run seed` against the production
  database, you can do that from your own machine - just make sure your
  local `.env`'s `MONGO_URI` points at the same Atlas cluster Render is
  using (it already does, since there's only one database).
