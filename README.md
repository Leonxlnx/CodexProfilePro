# CodexProfilePro

CodexProfilePro is a local, cross-platform desktop dashboard for Codex token activity.

It renders the profile UI, daily/weekly/cumulative/cost heatmaps, estimated API-equivalent cost, tray access, and automatic hourly refresh from local Codex session logs.

## Features

- Native desktop app with Windows, macOS, and Linux release builds
- Windows tray integration with manual refresh and hourly background refresh
- Daily, weekly, cumulative, and API-equivalent cost heatmaps
- Local-only Codex log parsing from `~/.codex/sessions/**/*.jsonl`
- Dynamic profile label with safe fallbacks and no bundled personal profile photo
- Private usage data kept out of Git by default

## Run locally

```powershell
npm install
npm start
```

## Refresh data

```powershell
npm run sync
```

The fast exporter reads:

```text
~/.codex/sessions/**/*.jsonl
```

It writes:

```text
CodexProfilePro/slopmeter.json
```

Packaged desktop builds write refreshed data to the app user-data folder.

## Profile Display

CodexProfilePro avoids bundling a personal profile photo. It uses safe profile fields from local Codex state when available, supports `CODEX_PROFILE_NAME`, `CODEX_PROFILE_HANDLE`, `CODEX_PROFILE_PLAN`, and `CODEX_PROFILE_AVATAR` overrides, then falls back to the OS/Git user name with a neutral avatar.

## Build

```powershell
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Build each platform on its native OS for best results. The GitHub release workflow builds Windows, macOS, and Linux artifacts on matching runners.

## Test

```powershell
npm test
```

The smoke test creates a fake Codex session log, runs the exporter against it, and verifies the generated usage JSON.

## Releases

GitHub Actions builds release artifacts for:

- Windows: installer and portable executable
- macOS: universal DMG and ZIP
- Linux: AppImage and Debian package

## Cost Estimates

The Cost tab is an API-equivalent estimate. It uses official OpenAI API pricing where available:

- `gpt-5.5`
- `gpt-5.4`
- `gpt-5.4-mini`
- `gpt-5.3-codex`

`GPT-5.3-Codex-Spark` is treated as a `gpt-5.3-codex` estimate because OpenAI marks Spark credit rates as research-preview/not final.
