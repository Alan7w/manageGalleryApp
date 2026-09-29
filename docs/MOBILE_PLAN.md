# Sift for iPhone and Android — plan

Status: proposed 2026-09-29, waiting for approval. Nothing here is built yet.

## Goal

A phone app that cleans up **the phone's own gallery**: bursts and similar shots with a best-shot pick, duplicates, blurry photos, junk (screenshots, pocket shots), large videos. Same rules as the Mac app: nothing is deleted without review, and deletions go to the phone's own **Recently Deleted** (30 days), so they can be undone. Everything runs on the phone, with no server and no account.

Priority: 1) your own iPhone, 2) close friends on iPhone and Android. If the phone app can't be shared, the Mac app already can.

## Stack

- **Expo (React Native) + TypeScript**, one codebase for iPhone and Android.
- **Shared with the Mac app:** grouping (clustering), best-shot scoring, junk rules and types move into `src/shared/core/` as plain TypeScript. The desktop keeps working as before; the phone app imports the same files.
- **Phone libraries:** `expo-media-library` (read the gallery, delete to Recently Deleted), `expo-sqlite` (the index), `expo-image` + FlashList (fast grids), Reanimated + Gesture Handler (swipe culling).
- **Native analyzer module** (Expo Modules API), one per platform:
  - **iPhone (Swift):** a port of `native/analyzer` using Apple Vision, the same engine as the Mac, so the same quality: feature prints for similarity, aesthetic score (iOS 18+), face quality, labels for search, focus, exposure.
  - **Android (Kotlin):** Google ML Kit (labels, faces with eyes-open and smiling scores) and MediaPipe Image Embedder (similarity), with focus and exposure computed directly. There's no aesthetic score on Android, so best-shot picking leans on focus, faces and exposure (the scoring code already handles a missing aesthetic score).

## Repo layout

The Mac app stays at the root, untouched. The phone app goes in `mobile/` with its own `package.json`, and shares `src/shared/core/` through Metro's `watchFolders`.

## Phone-specific details

- **iCloud "Optimize Storage":** many originals aren't on the phone. Analysis uses the small previews the phone always has, so it works offline and doesn't download originals.
- **Duplicates:** detected from pixel size, date, file size and a visual hash first; exact file hashing only for photos that are on the device.
- **Screenshots:** iOS and Android tag screenshots, so Junk is more accurate than on the Mac.
- **Deleting:** iOS shows "Allow Sift to delete N photos?", Android 11+ shows a similar system dialog; items go to Recently Deleted for 30 days.
- **Permissions:** Sift needs full photo access. With "limited access" it will explain what's missing.
- **Big libraries:** analysis runs while the app is open, with progress and resume. Background processing can come later.

## Milestones

| # | What | Result |
| --- | --- | --- |
| 0 | You: install Xcode, sign in with your Apple ID, connect your iPhone | Can build to your phone |
| 1 | Move shared logic to `src/shared/core/`; Mac app unchanged | One copy of the rules |
| 2 | Expo app skeleton, gallery access, grid, index | Browse your gallery in Sift |
| 3 | iPhone analyzer (Swift/Vision), Similar & Bursts review, Review Bin, delete | **Usable on your iPhone** |
| 4 | Blurry, Junk, Large Videos, Duplicates | Feature parity with the Mac |
| 5 | Android analyzer (Kotlin), APK build | Works on Android |
| 6 | Sharing: TestFlight (iPhone), APK (Android); phone chapter in the guidebook | Friends can install |

## Getting it onto phones

### Your iPhone during development (free)

Xcode with your own Apple ID installs Sift over the cable. iOS asks you to turn on **Developer Mode** once (Settings → Privacy & Security). Limits of a free Apple ID: the app stops opening after **7 days** until it's reinstalled, and it only works for your own devices. Fine for building and testing; not for daily use or friends.

### Using your friend's developer account

Yes, this works, but **not by signing in with his Apple ID and password**. Apple's terms don't allow sharing an Apple ID, two-factor codes go to his phone, and it would put his account at risk. The proper ways:

- **App Store Connect API key (recommended):** in App Store Connect → Users and Access → Integrations, he creates a key with the *App Manager* (or Admin) role and sends you the `.p8` file, Key ID and Issuer ID. Expo's build service (EAS) uses it to create the signing certificate and upload builds. He can revoke it at any time. As far as I know this works for both individual and organization accounts; we'll confirm with his account when we get there.
- **Or he adds you as a user** in App Store Connect so you can manage testers. On an *individual* account that doesn't cover signing, so the API key is still needed for building.

What it means for him: Sift appears under **his name** as the developer, his account is responsible for it, it uses up to 100 of his device slots if we use ad hoc, and if his membership lapses, the builds stop working.

Two ways to deliver, both through his account:

- **TestFlight (recommended):** friends install Apple's TestFlight app and tap a link, with no device registration and updates arriving automatically. The first build of each version gets a short Apple beta review (usually about a day). Each build works for **90 days**, so we upload a fresh one before it expires (can be automated).
- **Ad hoc:** each iPhone must be registered (friends open a link to register), then install from a link. No Apple review, works for about a year, up to 100 iPhones per year on his account. Every new friend needs a new build.

### Android (free)

We build an `.apk` signed with our own key and share it (Drive, Telegram, AirDrop to a Mac…). Friends allow "Install unknown apps" once; Play Protect may warn about an unknown developer. Updates install over the old version.

To check before release: Google has announced it will require sideloaded apps on certified Android phones to come from **verified developers**, starting late 2026 in a few countries and more widely in 2027, with a free option for hobbyists. We'll check the current rules for your friends' countries when we get to milestone 6.

## Mac ↔ iPhone (later, free)

The practical way to connect the two is through **iCloud Photos**, with no servers and no cost:

- **On the Mac:** add "Apple Photos library" as a source (roadmap item 6) using PhotoKit. With iCloud Photos on, the Mac's Photos library mirrors the iPhone, so cleaning it on the Mac's big screen cleans the iPhone too; deletions sync to Recently Deleted everywhere.
- The Swift Vision code written for the iPhone is reused for this.
- Analysis uses Photos' previews, so it works with "Optimize Mac Storage".
- Deleting goes through Photos' own confirmation.

Effort: medium. Risk to check first: whether PhotoKit works from Sift's helper process, or has to run inside the app itself.

Not planned: syncing decisions ("kept", "not similar") between devices. It would need iCloud sync (paid developer account) or a local-network link, which is a lot of work for little gain when both devices clean the same iCloud library.
