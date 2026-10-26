# Conteng

A little square whiteboard that sits on your desktop. You and a friend share a board
code; whatever one of you draws shows up on the other's screen as it is drawn, Mac or
Windows. The drawing stays until someone presses Clear.

## Use it

1. Open Conteng. The first time, the setup window asks for your name.
2. **Start a new board** — the code (`conteng-xxxx-xxxx-xxxx`) is copied for you. Send it to your friend.
3. Your friend installs Conteng, pastes the code under **Join a friend's board**, and presses Join.
4. Hover the board for the tools: 6 colours, pen size, eraser (`E`), undo your own last stroke (`⌘Z` / `Ctrl+Z`), clear for both, and settings.
   Drag the top edge to move it, the bottom-right corner to resize it.
5. The dot at the top left: grey offline, amber waiting for your friend, green you are both here.

The menu-bar (Mac) / tray (Windows) icon has the board code, settings, "Open at login" and Quit.

## Where it sits

- **Mac:** one level below normal windows — under every app, above the desktop icons, on every Space. No Dock icon.
- **Windows:** a normal small window with no taskbar button; click the tray icon to bring it back.

## How it works

- Electron 38, one codebase for both systems. `renderer/board.js` draws on a canvas; points are stored as fractions of the board, so boards of any size match.
- Live strokes travel over a **Supabase Realtime broadcast** channel named after the board code (`begin` / `pts` / `end` / `undo` / `clear`), plus presence for "friend is here".
- Finished strokes are saved in the **Sky AI Brain** Supabase project, table `conteng_strokes`. RLS is on with no policies: the app can only use four functions (`conteng_load`, `conteng_add`, `conteng_remove`, `conteng_clear`), each needing the board code. Schema: `supabase/schema.sql`.
- The board code is the only key to a board, so it is long and random.

## Build

```bash
npm install            # also runs tools/vendor.js
npm start              # run from source
npm test               # two copies on one test board: live sync, undo, reopen, eraser, move, resize, clear
npm run dist:mac       # build, sign with the local certificate, install to /Applications
npm run dist:win       # dist/Conteng-Setup-<version>.exe (unsigned)
```

`tools/vendor.js` writes `renderer/config.js` from `CONTENG_SUPABASE_URL` and
`CONTENG_SUPABASE_PUBLISHABLE_KEY` in `~/.claude/.env`; it is git-ignored. Icons come from
`python3 tools/make_icons.py`. `CONTENG_PROFILE=<name> npm start` runs a second copy with
its own settings, for testing two people on one machine.

The Windows installer is not code-signed, so Windows SmartScreen shows "Windows protected
your PC" the first time: **More info → Run anyway**.
