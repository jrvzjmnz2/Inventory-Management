// Copies public/css/style.css into public/mobile/css/style.css.
//
// The mobile pages used to just link to "../css/style.css", which works fine
// while everything is served live by server.js, but breaks once the mobile
// app is packaged as a standalone Capacitor app - only public/mobile gets
// bundled into the app, so anything outside it 404s. Keeping a local copy in
// sync with this script avoids that, without needing a build tool.
//
// Run this whenever you change public/css/style.css, before `npx cap sync android`.

const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'public', 'css', 'style.css');
const HEADER = `/* This is a copy of ../../css/style.css (the shared desktop stylesheet).

   Why a copy instead of just linking to the original: when this app is
   packaged as a standalone Capacitor Android app, only the contents of
   public/mobile get bundled into the app - a path like "../css/style.css"
   would point outside that bundle and 404 once the app is installed on a
   phone with no dev server/tunnel behind it.

   If you change public/css/style.css, re-run:
     npm run sync-mobile-css
   to copy the changes here too. */

`;
const DEST = path.join(__dirname, '..', 'public', 'mobile', 'css', 'style.css');

const source = fs.readFileSync(SOURCE, 'utf8');
fs.writeFileSync(DEST, HEADER + source);
console.log(`Copied ${SOURCE} -> ${DEST}`);
