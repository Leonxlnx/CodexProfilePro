# CodexProfilePro

CodexProfilePro is a local, cross-platform desktop dashboard for Codex usage. It turns local Codex session logs into a profile-style activity page with token heatmaps, streaks, task stats, cost estimates, tray access, and hourly refresh.

## Download

Get the latest build from the release page:

[CodexProfilePro v1.0.8](https://github.com/Leonxlnx/CodexProfilePro/releases/tag/v1.0.8)

- Windows: use `CodexProfilePro.Setup.1.0.8.exe` for the installer, or `CodexProfilePro.1.0.8.exe` for portable use.
- macOS: use `CodexProfilePro-1.0.8-universal.dmg`, or the universal ZIP.
- Linux: use `CodexProfilePro-1.0.8.AppImage`, or `codex-profile-pro_1.0.8_amd64.deb`.

## Use Guide

1. Install or open the app for your platform.
2. CodexProfilePro reads local Codex logs from `~/.codex/sessions/**/*.jsonl`.
3. Use the refresh button in the bottom-left corner to rebuild the data immediately.
4. Keep the app running in the tray for hourly background refresh.
5. Use `Edit` in the top-right corner to set your local name, handle, plan, and profile picture.
6. Use `Share` in the top-right corner to generate a compact PNG profile card that can be copied or saved.

If no Codex logs exist on the machine, the app opens but the dashboard can be empty until Codex creates session logs.

## Features

- Native desktop app for Windows, macOS, and Linux
- Daily, weekly, cumulative, and API-equivalent cost heatmaps
- Local-only Codex log parsing from `~/.codex/sessions/**/*.jsonl`
- Hourly refresh while the desktop app is running
- Incremental refresh for large Codex log folders
- Windows tray support with manual refresh
- Editable local profile settings
- Shareable PNG profile cards using the local profile and current activity data
- Private usage data kept out of Git by default

## Data And Privacy

CodexProfilePro does not upload usage data. It reads local session logs and writes generated dashboard data into the app user-data folder.

Packaged desktop builds write usage data here:

```text
Windows: %APPDATA%\codex-profile-pro\slopmeter.json
macOS: ~/Library/Application Support/codex-profile-pro/slopmeter.json
Linux: ~/.config/codex-profile-pro/slopmeter.json
```

If your Codex logs are not under `~/.codex`, set `CODEX_HOME` to the correct Codex data folder before launching the app.

## Profile Settings

Profile data is not hardcoded into the release. Each machine can configure its own profile with the in-app `Edit` button.

Saved profile settings live in the app user-data folder:

```text
profile.json
profile-avatar.<ext>
```

Environment overrides are also supported:

```text
CODEX_PROFILE_NAME
CODEX_PROFILE_HANDLE
CODEX_PROFILE_PLAN
CODEX_PROFILE_AVATAR
```

The app checks environment overrides first, then local profile settings, then safe profile fields from local Codex state. If none exist, it falls back to `Codex User` with no profile picture.

## Refresh Data Manually

For development or source checkout usage:

```powershell
npm run sync
```

The exporter reads:

```text
~/.codex/sessions/**/*.jsonl
```

It writes:

```text
CodexProfilePro/slopmeter.json
```

## Cost Estimates

The Cost tab is an API-equivalent estimate. It uses official OpenAI API pricing where available:

- `gpt-5.5`
- `gpt-5.4`
- `gpt-5.4-mini`
- `gpt-5.3-codex`

`GPT-5.3-Codex-Spark` is treated as a `gpt-5.3-codex` estimate because OpenAI marks Spark credit rates as research-preview/not final.

## Run From Source

```powershell
npm install
npm start
```

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

To verify share-card rendering in Electron:

```powershell
npm run verify:share
```
