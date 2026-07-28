# Building a real .apk (do this on your own machine)

I can't compile an actual `.apk` from this chat — that needs the Android SDK,
Gradle, and Java build tools installed locally (Android Studio bundles all
of them), plus a real internet connection to Google's Maven/Gradle
repositories. None of that is available in this sandbox. But your project is
already set up for it with `capacitor.config.json` — here's exactly what to
run once you're on your own computer.

## 0. Prerequisites

- [Android Studio](https://developer.android.com/studio) installed (it sets
  up the Android SDK for you)
- Node.js (already required for the server)
- Your server (`server.js`) deployed somewhere reachable from your phone over
  the internet (Render, Railway, Fly.io, a VPS, etc.) - a `localhost` URL
  won't work, since your phone can't reach your computer's localhost.

## 1. Point the app at your deployed backend

This app's UI (`public/mobile`) is bundled directly into the Android app -
it does **not** load live from a URL at runtime, so there's no tunnel to keep
running. The only thing that needs a real network address is the API calls
(login, borrow/return, inventory).

Edit `public/mobile/js/config.js` and replace the placeholder with your
deployed backend's URL:

```js
const API_BASE_URL = 'https://your-actual-server.example.com';
```

That's it - `capacitor.config.json` doesn't need a `server.url` entry; the app
just ships `public/mobile` as its own local content.

> If you ever change `public/css/style.css` (the shared look used by both the
> desktop dashboard and the mobile app), run `npm run sync-mobile-css`
> afterwards - the mobile app keeps its own copy at
> `public/mobile/css/style.css` so it stays fully self-contained once bundled.

## 2. Install Capacitor and add the Android platform

```bash
cd inventory-management-system
npm install -D @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
npx cap sync android
```

Run `npx cap sync android` again any time you change files in
`public/mobile` (including after editing `config.js`) so the Android project
picks up the latest copy.

## 3. Build the APK

Easiest: open it in Android Studio and build from there:

```bash
npx cap open android
```

Then in Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

Or from the command line, once the `android/` folder exists:

```bash
cd android
./gradlew assembleDebug        # macOS/Linux
.\gradlew.bat assembleDebug    # Windows PowerShell/cmd
```

Your installable file will be at:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Copy that to your phone (email it to yourself, use `adb install`, USB
transfer, etc.) and tap it to install. You'll need to allow "install from
unknown sources" for a debug build, since it isn't signed for the Play Store.

If you change the `AndroidManifest.xml` (e.g. permissions) or `config.js`,
uninstall the old copy of the app from your phone before reinstalling the new
build - that avoids stale permission grants or cached content.

## Note on how this works

This is a standalone native app: its HTML/CSS/JS is bundled straight into the
APK (via `webDir: "public/mobile"` in `capacitor.config.json`), so opening the
app doesn't depend on your computer, a tunnel, or any specific network being
up. Only the actual data operations - logging in, scanning/adding equipment,
completing a borrow or return, viewing inventory - reach out over the network
to your deployed backend and its MongoDB database. That backend is the same
one the desktop dashboard (`public/dashboard.html`) already talks to, so both
the phone app and the web app work off the same live data.
