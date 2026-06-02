# Codex Profile

Local desktop profile dashboard for Codex token activity.

It renders the profile UI, daily/weekly/cumulative/cost heatmaps, estimated API-equivalent cost, tray access, and automatic refresh from local Codex session logs.

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
profile-remake/slopmeter.json
```

Packaged desktop builds write refreshed data to the app user-data folder.

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

## Cost Estimates

The Cost tab is an API-equivalent estimate. It uses official OpenAI API pricing where available:

- `gpt-5.5`
- `gpt-5.4`
- `gpt-5.4-mini`
- `gpt-5.3-codex`

`GPT-5.3-Codex-Spark` is treated as a `gpt-5.3-codex` estimate because OpenAI marks Spark credit rates as research-preview/not final.
