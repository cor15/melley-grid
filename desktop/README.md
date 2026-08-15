# Desktop wrapper (Tauri)

The `frontend/` folder is a plain static site, so it can be wrapped as a desktop
app with almost no changes. Tauri is recommended over Electron here — much
smaller install size, and you don't need Node in the shipped app.

## One-time setup

1. Install Rust: https://www.rust-lang.org/tools/install
2. Install the Tauri CLI:
   ```
   npm install -g @tauri-apps/cli
   ```
3. From the project root:
   ```
   npm create tauri-app@latest ai-spreadsheet-desktop
   ```
   When prompted, choose "no framework" and point it at the existing
   `frontend/` folder as the web assets directory (or copy `frontend/*`
   into the generated `src/` folder).

## Pointing at your backend

Edit `frontend/config.js` and set `API_BASE` to your deployed Render URL, e.g.

```js
const API_BASE = "https://ai-spreadsheet-api.onrender.com";
```

The desktop app is just a native window around this static frontend — all
the real work (Claude calls, Supabase reads/writes) still happens on the
Render backend, same as the web version.

## Build

```
npm run tauri build
```

This produces a native installer (.dmg / .msi / .AppImage depending on your
OS) in `src-tauri/target/release/bundle/`.
