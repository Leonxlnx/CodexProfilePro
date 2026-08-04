import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-profile-pro-smoke-"));
const codexHome = path.join(temp, ".codex");
const sessionDir = path.join(codexHome, "sessions", "2026", "06", "02");
const output = path.join(temp, "usage.json");

await fs.mkdir(sessionDir, { recursive: true });
await fs.writeFile(path.join(sessionDir, "rollout-test.jsonl"), [
  JSON.stringify({ timestamp: "2026-06-02T10:00:00.000Z", type: "response_item", payload: { type: "turn_context", model: "gpt-5.6" } }),
  JSON.stringify({ timestamp: "2026-06-02T10:01:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 400, cache_write_tokens: 200, output_tokens: 100, reasoning_output_tokens: 20, total_tokens: 1100 }, last_token_usage: { input_tokens: 1000, cached_input_tokens: 400, cache_write_tokens: 200, output_tokens: 100, reasoning_output_tokens: 20, total_tokens: 1100 } } } }),
  JSON.stringify({ timestamp: "2026-06-02T10:02:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1800, cached_input_tokens: 500, cache_write_tokens: 300, output_tokens: 180, reasoning_output_tokens: 40, total_tokens: 1980 }, last_token_usage: { input_tokens: 800, cached_input_tokens: 100, cache_write_tokens: 100, output_tokens: 80, reasoning_output_tokens: 20, total_tokens: 880 } } } })
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
assert(day.breakdown?.[0]?.name === "gpt-5.6-sol", "expected gpt-5.6 alias to normalize to Sol");
assert(day.cache?.write === 300, `expected 300 cache-write tokens, got ${day.cache?.write}`);
assert(provider.insights.streaks.current >= 1, "expected active streak");

await runIncrementalExporterSmoke();
await runHeatmapProjectionSmoke();

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

async function runHeatmapProjectionSmoke() {
  const source = await fs.readFile(path.join(root, "CodexProfilePro", "app.js"), "utf8");
  const cells = [];
  const heatmap = createElementStub("heatmap");
  const monthLabels = createElementStub("monthLabels");
  const heatmapWrap = { clientWidth: 900 };
  const elements = new Map([
    ["lifetimeTokens", createElementStub("lifetimeTokens")],
    ["peakTokens", createElementStub("peakTokens")],
    ["longestTask", createElementStub("longestTask")],
    ["currentStreak", createElementStub("currentStreak")],
    ["longestStreak", createElementStub("longestStreak")],
    ["heatmap", heatmap],
    ["monthLabels", monthLabels],
    ["costSummary", createElementStub("costSummary")],
    ["totalCost", createElementStub("totalCost")],
    ["monthCost", createElementStub("monthCost")],
    ["peakCost", createElementStub("peakCost")],
    ["peakCostLabel", createElementStub("peakCostLabel")],
    ["averageCost", createElementStub("averageCost")],
    ["refreshButton", createElementStub("refreshButton")],
    ["tooltip", createElementStub("tooltip")],
  ]);

  heatmap.appendChild = (cell) => cells.push(cell);
  Object.defineProperty(heatmap, "innerHTML", {
    get: () => "",
    set: () => {
      cells.length = 0;
    },
  });

  const context = {
    console,
    Intl,
    setInterval: () => 0,
    window: {
      addEventListener: () => {},
      profileRemake: null,
      innerWidth: 1000,
      innerHeight: 800,
    },
    document: {
      addEventListener: () => {},
      getElementById: (id) => elements.get(id) || createElementStub(id),
      querySelector: (selector) => selector === ".heatmap-wrap" ? heatmapWrap : createElementStub(selector),
      querySelectorAll: () => [],
      createElement: () => createElementStub("created"),
    },
    fetch: async () => ({ ok: false }),
    __cells: cells,
  };

  const testSource = source.replace(/\ninit\(\);\s*\n/, "\n") + `
    function __visibleCellsForMode(mode) {
      state.mode = mode;
      graphStart = dateFromISO("2026-06-01");
      graphEnd = dateFromISO("2026-06-04");
      state.daily = [
        { date: "2026-06-01", total: 100, dateObj: dateFromISO("2026-06-01") },
        { date: "2026-06-02", total: 100, dateObj: dateFromISO("2026-06-02") },
        { date: "2026-06-03", total: 100, dateObj: dateFromISO("2026-06-03") },
        { date: "2026-06-04", total: 100, dateObj: dateFromISO("2026-06-04") },
      ];
      state.byDate = new Map(state.daily.map((item) => [item.date, item]));
      renderHeatmap();
      return globalThis.__cells.map((cell) => ({
        date: cell.dataset.date,
        value: Number(cell.dataset.value),
        future: cell.classList.contains("is-future"),
      }));
    }
    globalThis.__dailyCells = __visibleCellsForMode("daily");
    globalThis.__weeklyCells = __visibleCellsForMode("weekly");
    globalThis.__cumulativeCells = __visibleCellsForMode("cumulative");
    globalThis.__modelCosts = {
      solWithCache: estimateTokenCost("gpt-5.6", { input: 1_000_000, output: 100_000, cache: { input: 100_000, write: 200_000 } }),
      terraOutput: estimateTokenCost("gpt-5.6-terra", { output: 1_000_000 }),
      lunaInput: estimateTokenCost("gpt-5.6-luna", { input: 1_000_000 }),
    };
    state.profile.tokenDisplay = "uncached";
    globalThis.__uncachedTotal = displayedTokenTotal({ total: 1_100, cache: { input: 400, write: 200 } });
  `;

  vm.runInNewContext(testSource, context, { filename: "app.js" });
  const futureDates = ["2026-06-05", "2026-06-06", "2026-06-07"];
  const byDate = (cellsByMode, iso) => cellsByMode.find((cell) => cell.date === iso);

  for (const iso of futureDates) {
    assert(byDate(context.__dailyCells, iso)?.future, `expected daily ${iso} to stay hidden`);
    assert(!byDate(context.__weeklyCells, iso)?.future, `expected weekly ${iso} to render`);
    assert((byDate(context.__weeklyCells, iso)?.value || 0) > 0, `expected weekly ${iso} to be filled`);
    assert(!byDate(context.__cumulativeCells, iso)?.future, `expected cumulative ${iso} to render`);
    assert((byDate(context.__cumulativeCells, iso)?.value || 0) > 0, `expected cumulative ${iso} to be filled`);
  }
  assert(Math.abs(context.__modelCosts.solWithCache - 7.8) < 1e-9, `expected Sol cache-aware cost 7.8, got ${context.__modelCosts.solWithCache}`);
  assert(context.__modelCosts.terraOutput === 12, `expected Terra output cost 12, got ${context.__modelCosts.terraOutput}`);
  assert(context.__modelCosts.lunaInput === 0.2, `expected Luna input cost 0.2, got ${context.__modelCosts.lunaInput}`);
  assert(context.__uncachedTotal === 700, `expected cached input to be excluded, got ${context.__uncachedTotal}`);
}

async function runIncrementalExporterSmoke() {
  const incrementalHome = path.join(temp, ".codex-incremental");
  const incrementalSessionDir = path.join(incrementalHome, "sessions", "2026", "06", "02");
  const incrementalOutput = path.join(temp, "incremental-usage.json");
  await fs.mkdir(incrementalSessionDir, { recursive: true });
  await fs.writeFile(incrementalOutput, JSON.stringify({
    version: "fast-codex-usage-export-1",
    start: "2025-06-02",
    end: "2026-06-02",
    providers: [{
      provider: "codex",
      insights: {
        streaks: { current: 1, longest: 1 },
        mostUsedModel: { name: "gpt-5.5", tokens: { input: 80, output: 20, reasoning: 0, cache: { input: 10, output: 0 }, total: 100 } },
        totalTokens: { input: 80, output: 20, reasoning: 0, cache: { input: 10, output: 0 }, total: 100 },
      },
      daily: [{
        date: "2026-06-01",
        input: 80,
        output: 20,
        reasoning: 0,
        cache: { input: 10, output: 0 },
        total: 100,
        displayValue: 100,
        breakdown: [{ name: "gpt-5.5", tokens: { input: 80, output: 20, reasoning: 0, cache: { input: 10, output: 0 }, total: 100 } }],
      }],
    }],
  }, null, 2), "utf8");
  await fs.utimes(incrementalOutput, new Date("2026-06-02T10:00:00.000Z"), new Date("2026-06-02T10:00:00.000Z"));
  await fs.writeFile(path.join(incrementalSessionDir, "rollout-incremental.jsonl"), [
    JSON.stringify({ timestamp: "2026-06-02T11:00:00.000Z", type: "response_item", payload: { type: "turn_context", model: "gpt-5.5" } }),
    JSON.stringify({ timestamp: "2026-06-02T11:01:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 600, cached_input_tokens: 100, output_tokens: 50, reasoning_output_tokens: 10, total_tokens: 650 }, last_token_usage: { input_tokens: 600, cached_input_tokens: 100, output_tokens: 50, reasoning_output_tokens: 10, total_tokens: 650 } } } }),
  ].join("\n") + "\n", "utf8");

  await run("node", ["CodexProfilePro/fast-codex-usage-export.mjs", incrementalOutput], root, {
    CODEX_HOME: incrementalHome,
    PROFILE_EXPORT_END_DATE: "2026-06-02",
  });

  const payload = JSON.parse(await fs.readFile(incrementalOutput, "utf8"));
  const days = payload.providers?.[0]?.daily || [];
  const previous = days.find((item) => item.date === "2026-06-01");
  const current = days.find((item) => item.date === "2026-06-02");
  assert(previous?.total === 100, `expected previous day to be preserved, got ${previous?.total}`);
  assert(current?.total === 650, `expected current day to be rebuilt incrementally, got ${current?.total}`);
  assert(payload.providers?.[0]?.insights?.streaks?.current === 2, "expected incremental streak to include current day");
}

function createElementStub(id) {
  const classes = new Set();
  return {
    id,
    children: [],
    dataset: {},
    disabled: false,
    hidden: false,
    textContent: "",
    title: "",
    style: {
      setProperty() {},
    },
    classList: {
      add: (name) => classes.add(name),
      toggle: (name, active) => active ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name),
    },
    appendChild(child) {
      this.children.push(child);
    },
    addEventListener() {},
    setAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  };
}
