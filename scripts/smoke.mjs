import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-profile-pro-smoke-"));
const codexHome = path.join(temp, ".codex");
const sessionDir = path.join(codexHome, "sessions", "2026", "06", "02");
const output = path.join(temp, "usage.json");

await fs.mkdir(sessionDir, { recursive: true });
await fs.writeFile(path.join(sessionDir, "rollout-test.jsonl"), [
  JSON.stringify({ timestamp: "2026-06-02T10:00:00.000Z", type: "response_item", payload: { type: "turn_context", model: "gpt-5.5" } }),
  JSON.stringify({ timestamp: "2026-06-02T10:01:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 100, reasoning_output_tokens: 20, total_tokens: 1100 }, last_token_usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 100, reasoning_output_tokens: 20, total_tokens: 1100 } } } }),
  JSON.stringify({ timestamp: "2026-06-02T10:02:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1800, cached_input_tokens: 500, output_tokens: 180, reasoning_output_tokens: 40, total_tokens: 1980 }, last_token_usage: { input_tokens: 800, cached_input_tokens: 100, output_tokens: 80, reasoning_output_tokens: 20, total_tokens: 880 } } } })
].join("\n") + "\n", "utf8");

await run("node", ["--check", "CodexProfilePro/app.js"], root);
await run("node", ["--check", "CodexProfilePro/fast-codex-usage-export.mjs"], root);
await run("node", ["CodexProfilePro/fast-codex-usage-export.mjs", output], root, {
  CODEX_HOME: codexHome,
  PROFILE_EXPORT_END_DATE: "2026-06-02",
});

const payload = JSON.parse(await fs.readFile(output, "utf8"));
const provider = payload.providers?.[0];
const day = provider?.daily?.find((item) => item.date === "2026-06-02");
assert(day, "expected 2026-06-02 daily output");
assert(day.total === 1980, `expected delta total 1980, got ${day.total}`);
assert(day.breakdown?.[0]?.name === "gpt-5.5", "expected gpt-5.5 breakdown");
assert(provider.insights.streaks.current >= 1, "expected active streak");

console.log("smoke ok");

function run(command, args, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
      shell: process.platform === "win32"
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with ${code}`));
    });
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
