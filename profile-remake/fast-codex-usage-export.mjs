import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const DAY_MS = 24 * 60 * 60 * 1000;
const outputPath = process.argv[2] || path.join(process.cwd(), "slopmeter.json");
const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
const sessionsRoot = path.join(codexHome, "sessions");

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromISO(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function exportEndDate() {
  const override = process.env.PROFILE_EXPORT_END_DATE?.trim();
  if (override) {
    const date = dateFromISO(override);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  }

  const end = new Date();
  return new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
}

function normalizeUsage(value) {
  if (!value) return null;
  const input = value.input_tokens ?? 0;
  const cached = value.cached_input_tokens ?? value.cache_read_input_tokens ?? 0;
  const output = value.output_tokens ?? 0;
  const reasoning = value.reasoning_output_tokens ?? 0;
  const total = value.total_tokens ?? 0;
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: total > 0 ? total : input + output,
  };
}

function addUsage(base, delta) {
  return {
    input_tokens: (base?.input_tokens ?? 0) + delta.input_tokens,
    cached_input_tokens: (base?.cached_input_tokens ?? 0) + delta.cached_input_tokens,
    output_tokens: (base?.output_tokens ?? 0) + delta.output_tokens,
    reasoning_output_tokens: (base?.reasoning_output_tokens ?? 0) + delta.reasoning_output_tokens,
    total_tokens: (base?.total_tokens ?? 0) + delta.total_tokens,
  };
}

function subtractUsage(current, previous) {
  return {
    input_tokens: Math.max(current.input_tokens - (previous?.input_tokens ?? 0), 0),
    cached_input_tokens: Math.max(current.cached_input_tokens - (previous?.cached_input_tokens ?? 0), 0),
    output_tokens: Math.max(current.output_tokens - (previous?.output_tokens ?? 0), 0),
    reasoning_output_tokens: Math.max(current.reasoning_output_tokens - (previous?.reasoning_output_tokens ?? 0), 0),
    total_tokens: Math.max(current.total_tokens - (previous?.total_tokens ?? 0), 0),
  };
}

function didRollback(current, previous) {
  if (!previous) return false;
  return (
    current.input_tokens < previous.input_tokens ||
    current.cached_input_tokens < previous.cached_input_tokens ||
    current.output_tokens < previous.output_tokens ||
    current.reasoning_output_tokens < previous.reasoning_output_tokens ||
    current.total_tokens < previous.total_tokens
  );
}

function emptyTotals() {
  return {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { input: 0, output: 0 },
    total: 0,
  };
}

function extractModel(payload) {
  return (
    payload?.model ||
    payload?.model_name ||
    payload?.info?.model ||
    payload?.info?.model_name ||
    payload?.info?.metadata?.model ||
    payload?.metadata?.model ||
    null
  );
}

function normalizeModelName(value) {
  const model = String(value || "gpt-5.5").toLowerCase();
  if (model.includes("spark")) return "spark";
  if (model.includes("codex-auto-review")) return "gpt-5.3-codex";
  if (model.includes("5.5")) return "gpt-5.5";
  if (model.includes("5.4-mini")) return "gpt-5.4-mini";
  if (model.includes("5.4")) return "gpt-5.4";
  return model;
}

function addRawUsage(target, rawUsage) {
  target.input += rawUsage.input_tokens;
  target.output += rawUsage.output_tokens;
  target.reasoning += rawUsage.reasoning_output_tokens;
  target.cache.input += rawUsage.cached_input_tokens;
  target.total += rawUsage.total_tokens;
}

function addDaily(day, rawUsage, modelName) {
  addRawUsage(day, rawUsage);
  const model = normalizeModelName(modelName);
  if (!day.models.has(model)) {
    day.models.set(model, emptyTotals());
  }
  addRawUsage(day.models.get(model), rawUsage);
}

function serializeDay(date, totals) {
  return {
    date,
    input: totals.input,
    output: totals.output,
    cache: totals.cache,
    total: totals.total,
    displayValue: totals.total,
    breakdown: [...totals.models.entries()]
      .sort(([, a], [, b]) => b.total - a.total)
      .map(([name, tokens]) => ({
        name,
        tokens,
      })),
  };
}

function addModelAggregate(modelTotals, day) {
  for (const [model, tokens] of day.models.entries()) {
    if (!modelTotals.has(model)) {
      modelTotals.set(model, emptyTotals());
    }
    modelTotals.get(model).input += tokens.input;
    modelTotals.get(model).output += tokens.output;
    modelTotals.get(model).reasoning += tokens.reasoning || 0;
    modelTotals.get(model).cache.input += tokens.cache.input;
    modelTotals.get(model).cache.output += tokens.cache.output;
    modelTotals.get(model).total += tokens.total;
  }
}

function topModel(modelTotals) {
  const [name, tokens] = [...modelTotals.entries()].sort(([, a], [, b]) => b.total - a.total)[0] || ["codex", emptyTotals()];
  return { name, tokens };
}

function createDailyTotals() {
  return {
    ...emptyTotals(),
    models: new Map(),
  };
}

async function listJsonlFiles(root) {
  const files = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  await walk(root);
  return files;
}

async function processFile(filePath, startDate, endDate, dailyTotals) {
  const stat = await fsp.stat(filePath);
  if (stat.size === 0 || stat.mtime < startDate) {
    return;
  }

  let previousTotals = null;
  let currentModel = null;
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line.includes('"token_count"') && !line.includes('"model"') && !line.includes('"model_name"')) {
      continue;
    }

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const extractedModel = extractModel(entry.payload);
    if (extractedModel) {
      currentModel = extractedModel;
    }

    if (entry.type !== "event_msg" || entry.payload?.type !== "token_count") {
      continue;
    }

    const timestamp = new Date(entry.timestamp);
    if (Number.isNaN(timestamp.getTime()) || timestamp < startDate || timestamp > endDate) {
      continue;
    }

    const info = entry.payload?.info;
    const lastUsage = normalizeUsage(info?.last_token_usage);
    const totalUsage = normalizeUsage(info?.total_token_usage);
    let rawUsage = null;

    if (totalUsage) {
      rawUsage = didRollback(totalUsage, previousTotals)
        ? lastUsage ?? totalUsage
        : subtractUsage(totalUsage, previousTotals);
      previousTotals = totalUsage;
    } else {
      rawUsage = lastUsage;
      if (rawUsage) {
        previousTotals = addUsage(previousTotals, rawUsage);
      }
    }

    if (!rawUsage?.total_tokens) {
      continue;
    }

    const dayKey = isoDate(timestamp);
    if (!dailyTotals.has(dayKey)) {
      dailyTotals.set(dayKey, createDailyTotals());
    }
    addDaily(dailyTotals.get(dayKey), rawUsage, extractedModel || currentModel || "gpt-5.5");
  }
}

function computeStreaks(startIso, endIso, activeDays) {
  let longest = 0;
  let currentRun = 0;
  for (let time = dateFromISO(startIso).getTime(); time <= dateFromISO(endIso).getTime(); time += DAY_MS) {
    const day = isoDate(new Date(time));
    if (activeDays.has(day)) {
      currentRun += 1;
      longest = Math.max(longest, currentRun);
    } else {
      currentRun = 0;
    }
  }

  let current = 0;
  for (let time = dateFromISO(endIso).getTime(); time >= dateFromISO(startIso).getTime(); time -= DAY_MS) {
    const day = isoDate(new Date(time));
    if (!activeDays.has(day)) break;
    current += 1;
  }

  return { current, longest };
}

async function main() {
  const endDate = exportEndDate();
  const startDate = new Date(endDate.getTime() - 365 * DAY_MS);
  const startIso = isoDate(startDate);
  const endIso = isoDate(endDate);

  const files = await listJsonlFiles(sessionsRoot);
  const dailyTotals = new Map();
  for (const file of files) {
    await processFile(file, startDate, endDate, dailyTotals);
  }

  const daily = [...dailyTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, totals]) => serializeDay(date, totals));

  const modelTotals = new Map();
  for (const totals of dailyTotals.values()) {
    addModelAggregate(modelTotals, totals);
  }
  const mostUsedModel = topModel(modelTotals);

  const aggregate = daily.reduce((acc, day) => {
    acc.input += day.input;
    acc.output += day.output;
    acc.cache.input += day.cache.input;
    acc.cache.output += day.cache.output;
    acc.total += day.total;
    return acc;
  }, emptyTotals());

  const activeDays = new Set(daily.map((day) => day.date));
  const streaks = computeStreaks(startIso, endIso, activeDays);
  const payload = {
    version: "fast-codex-usage-export-1",
    start: startIso,
    end: endIso,
    providers: [
      {
        provider: "codex",
        insights: {
          mostUsedModel: {
            name: mostUsedModel.name,
            tokens: mostUsedModel.tokens,
          },
          totalTokens: aggregate,
          recentMostUsedModel: {
            name: mostUsedModel.name,
            tokens: mostUsedModel.tokens,
          },
          streaks,
        },
        daily,
      },
    ],
  };

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);
  console.log(`Days: ${daily.length}; total: ${aggregate.total}; end: ${endIso}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
