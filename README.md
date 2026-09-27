# Sift

A Mac app that tidies up your photo library. It finds duplicates, burst shots, blurry photos and junk across all your folders and drives, picks the best shot of each burst, and helps you clean up quickly without risking anything.

- **One library, many places.** Add folders on your Mac and on external drives; Sift shows them as one library. Drives that are unplugged stay browsable from cache.
- **Similar & Bursts.** Groups shots of the same moment and ranks them by focus, composition, faces, exposure and resolution, using Apple's on-device Vision AI. You confirm each group with one key.
- **Duplicates.** Byte-for-byte identical files anywhere in your sources. By default it keeps the copy in your main library that has the original name.
- **Blurry, Junk, Large Videos.** Covers out-of-focus shots, screenshots, pocket shots, receipts, tiny images, and the biggest videos.
- **Smart search.** Search for things like “beach”, “dog”, “2024”, “screenshots” or a camera name. Everything runs locally.
- **Safe by design.** Nothing is deleted on its own. Removed items go to a **Review Bin**, then to the **macOS Trash** only when you confirm, and every batch can be **restored** in one click.

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
| `npm run dev` | Development app with hot reload |
| `npm run build` | Typecheck, compile the Swift helper, bundle the app into `out/` |
| `npm start` | Run the bundled app from `out/` |
| `npm run dist` | Build a `.dmg` into `dist/` (not tested yet) |
| `npm run build:native -- --force` | Recompile the Swift helper |

**Testing without touching your real library:** set `SIFT_DATA_DIR` to use a separate index, e.g. `SIFT_DATA_DIR=/tmp/sift-test npm run dev`.

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
