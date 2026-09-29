# Sift

A Mac app that tidies up your photo library. It finds duplicates, burst shots, blurry photos and junk across all your folders and drives, picks the best shot of each burst, and helps you clean up quickly without risking anything.

- **One library, many places.** Add folders on your Mac and on external drives; Sift shows them as one library. Drives that are unplugged stay browsable from cache.
- **Similar & Bursts.** Groups shots of the same moment and ranks them by focus, composition, faces, exposure and resolution, using Apple's on-device Vision AI. You confirm each group with one key.
- **Duplicates.** Byte-for-byte identical files anywhere in your sources. By default it keeps the copy in your main library that has the original name.
- **Blurry, Junk, Large Videos.** Covers out-of-focus shots, screenshots, pocket shots, receipts, tiny images, and the biggest videos.
- **Smart search.** Search for things like “beach”, “dog”, “2024”, “screenshots” or a camera name. Everything runs locally.
- **Safe by design.** Nothing is deleted on its own. Removed items go to a **Review Bin**, then to the **macOS Trash** only when you confirm, and every batch can be **restored** in one click.

**Using Sift:** see the illustrated guidebook in [`docs/guide/`](docs/guide/index.html) (install, first steps, every screen, shortcuts, FAQ). **Phone version:** see [`docs/MOBILE_PLAN.md`](docs/MOBILE_PLAN.md).

## Requirements

- macOS 14 or newer (the aesthetic score needs macOS 15+)
- Node.js 22+
- Xcode Command Line Tools (`xcode-select --install`), which compile the small Swift helper

## Getting started

```sh
npm install
npm run dev      # compiles the Swift helper if needed, then starts the app with hot reload
```

On the first launch, click **Add Folder or Drive…**, or drag folders from Finder onto the window.

| Script | What it does |
| --- | --- |
| `npm run install:app` | Build `Sift.app` and install it into `/Applications` (replaces an older Sift) |
| `npm run dist` | Build `dist/Sift-<version>-arm64.dmg` to share |
| `npm run setup:signing` | One time: create the signing certificate so macOS remembers Sift's permissions |
| `npm run dev` | Development app with hot reload (dev server on port 5319) |
| `npm run build` | Typecheck, compile the Swift helper, bundle the app into `out/` |
| `npm start` | Run the bundled app from `out/` |
| `npm run build:native -- --force` | Recompile the Swift helper |
| `npm run build:icon` | Regenerate `resources/icon.icns` after editing `resources/icon.svg` |

**Testing without touching your real library:** set `SIFT_DATA_DIR` to use a separate index, e.g. `SIFT_DATA_DIR=/tmp/sift-test npm run dev`.

## Installing on your Mac

```sh
npm run install:app
```

This builds Sift, copies it to `/Applications`, and opens it. After that, launch Sift from Launchpad, Spotlight or the Dock like any other app. No terminal or dev server is needed. Run the same command again after pulling changes to update it.

The installed app and `npm run dev` share the same library (`~/Library/Application Support/Sift`), so only one of them can run at a time.

### Keeping permissions across updates

macOS remembers which folders and drives you let Sift read, per app signature. Run this once per Mac that builds Sift:

```sh
npm run setup:signing
```

It creates a self-signed certificate, **Sift Local Signing**, in its own keychain at `~/.sift-signing` (your login keychain and trust settings are untouched). Every build is then signed with it (`scripts/sign-app.mjs`), so macOS asks for access only once, not after every update. Without it, builds get a free ad-hoc signature and work the same, but permissions are asked again after each update.

Back up `~/.sift-signing` if you move to a new Mac: a new certificate means everyone is asked once more. To remove it: `security delete-keychain ~/.sift-signing/sift-signing.keychain-db && rm -rf ~/.sift-signing`.

## Sharing with friends

`npm run dist` creates `dist/Sift-<version>-arm64.dmg`. Send that file (AirDrop, Drive, Telegram…). It runs on Apple Silicon Macs with macOS 14 or newer.

Sift isn't signed with a paid Apple Developer ID, so the first time a friend opens it, macOS says it can't verify the app. To allow it once:

1. Open the `.dmg` and drag **Sift** to **Applications**.
2. Open Sift. When macOS warns, click **Done**.
3. Go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to the Sift message. Confirm with your password.

After that, Sift opens normally. (Alternative for people comfortable with the Terminal: `xattr -dr com.apple.quarantine /Applications/Sift.app`.)

## How it works

```
┌──────────────── Renderer (React + TypeScript) ────────────────┐
│ src/renderer — views, virtualized grids, culling, viewer      │
│ talks only to window.sift (typed in src/shared/types.ts)      │
└──────────────────────────────┬────────────────────────────────┘
                     IPC (src/preload, src/main/ipc.ts)
┌──────────────────────────────┴────────────────────────────────┐
│ Main process (Node)                                           │
│  scanner.ts   walk sources, sync the index (only changes)     │
│  engine.ts    pipeline: scan → analyze → hash → progress      │
│  groups.ts    duplicates + similar groups, best-shot scoring  │
│  grouping/    clustering, run in a worker thread              │
│  trash.ts     Trash / restore with a log for undo             │
│  db.ts        SQLite index (node:sqlite, no native modules)   │
│  protocol.ts  sift://thumb/<id>, sift://media/<id>            │
└──────────────────────────────┬────────────────────────────────┘
                 JSON lines over stdin/stdout (analyzer.ts)
┌──────────────────────────────┴────────────────────────────────┐
│ native/analyzer/main.swift — ImageIO · Vision · AVFoundation  │
│ thumbnails, EXIF, focus/exposure, visual fingerprint,         │
│ aesthetics, faces, labels, SHA-256, previews, Move to Trash   │
└───────────────────────────────────────────────────────────────┘
```

### How similar shots are grouped

1. **Same moment:** photos taken within the *burst window* (60 s by default) that look alike, measured by Apple Vision's feature print, with a difference hash as a fallback.
2. **Same picture saved twice:** near-identical difference hash at any date, which catches exports, resized copies and messenger re-uploads. Hash buckets are used so large libraries are never compared pair-by-pair.
3. **Best shot:** within a group, score = focus (40%) + Vision aesthetic score (30%) + face quality (15%) + exposure (10%) + resolution (5%). Copies with far fewer pixels than the original are penalised. Focus is measured per tile, so a portrait with a blurred background still counts as sharp.

The strictness and burst window are adjustable in **Settings**, and groups update live.

### What Sift never touches

- Apple Photos libraries (`*.photoslibrary`) and other apps' bundles (Lightroom, Final Cut, iMovie…) are skipped while scanning.
- Hidden files and `~/Library` are skipped.
- Files only move to the Trash (or, on drives without one, into a `Sift Removed` folder at the source root) after you confirm in the Review Bin.

## Where data lives

`~/Library/Application Support/Sift/`: `library.db` (the index) and `cache/` (thumbnails and previews). Deleting that folder resets Sift; your photos are unaffected.

## Roadmap

- [x] Multi-folder / multi-drive library, incremental scanning
- [x] Duplicates, Similar & Bursts with best-shot picking and keyboard culling
- [x] Blurry, Junk, Large Videos, Review Bin, Trash with undo
- [x] Local smart search (Vision labels, dates, cameras, folders)
- [ ] Organize by date: move keepers into one tidy `Year/Month` library
- [ ] Apple Photos / iPhone library as a source (PhotoKit)
- [ ] Natural-language search (“kids playing in the snow”) with an on-device CLIP model
- [ ] Find similar to this photo, map view, people
