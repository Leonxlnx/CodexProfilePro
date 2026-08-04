import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const DAY_MS = 24 * 60 * 60 * 1000;
const LARGE_NON_USAGE_LINE_BYTES = 256 * 1024;
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

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
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
  const cached = value.cached_input_tokens ?? value.cache_read_input_tokens ?? value.input_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = value.cache_write_tokens ?? value.cache_write_input_tokens ?? value.input_tokens_details?.cache_write_tokens ?? 0;
  const output = value.output_tokens ?? 0;
  const reasoning = value.reasoning_output_tokens ?? 0;
  const total = value.total_tokens ?? 0;
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    cache_write_tokens: cacheWrite,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: total > 0 ? total : input + output,
  };
}

function addUsage(base, delta) {
  return {
    input_tokens: (base?.input_tokens ?? 0) + delta.input_tokens,
    cached_input_tokens: (base?.cached_input_tokens ?? 0) + delta.cached_input_tokens,
    cache_write_tokens: (base?.cache_write_tokens ?? 0) + delta.cache_write_tokens,
    output_tokens: (base?.output_tokens ?? 0) + delta.output_tokens,
    reasoning_output_tokens: (base?.reasoning_output_tokens ?? 0) + delta.reasoning_output_tokens,
    total_tokens: (base?.total_tokens ?? 0) + delta.total_tokens,
  };
}

function subtractUsage(current, previous) {
  return {
    input_tokens: Math.max(current.input_tokens - (previous?.input_tokens ?? 0), 0),
    cached_input_tokens: Math.max(current.cached_input_tokens - (previous?.cached_input_tokens ?? 0), 0),
    cache_write_tokens: Math.max(current.cache_write_tokens - (previous?.cache_write_tokens ?? 0), 0),
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
    current.cache_write_tokens < previous.cache_write_tokens ||
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
    cache: { input: 0, output: 0, write: 0 },
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
  const model = String(value || "gpt-5.6-sol").toLowerCase();
  if (model.includes("spark")) return "spark";
  if (model.includes("codex-auto-review")) return "gpt-5.3-codex";
  if (model.includes("5.6-luna")) return "gpt-5.6-luna";
  if (model.includes("5.6-terra")) return "gpt-5.6-terra";
  if (model.includes("5.6")) return "gpt-5.6-sol";
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
  target.cache.write += rawUsage.cache_write_tokens;
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
    modelTotals.get(model).cache.write += tokens.cache.write || 0;
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

function cloneTotals(value) {
  return {
    input: value?.input ?? 0,
    output: value?.output ?? 0,
    reasoning: value?.reasoning ?? 0,
    cache: {
      input: value?.cache?.input ?? 0,
      output: value?.cache?.output ?? 0,
      write: value?.cache?.write ?? 0,
    },
    total: value?.total ?? 0,
  };
}

function dailyTotalsFromExisting(payload, resetStartDate) {
  const dailyTotals = new Map();
  const days = payload?.providers?.[0]?.daily;
  if (!Array.isArray(days)) {
    return dailyTotals;
  }

  for (const day of days) {
    if (!day.date) {
      continue;
    }
    const dayDate = dateFromISO(day.date);
    if (Number.isNaN(dayDate.getTime()) || dayDate >= resetStartDate) {
      continue;
    }

    const totals = {
      input: day.input ?? 0,
      output: day.output ?? 0,
      reasoning: day.reasoning ?? 0,
      cache: {
        input: day.cache?.input ?? 0,
        output: day.cache?.output ?? 0,
        write: day.cache?.write ?? 0,
      },
      total: day.total ?? 0,
      models: new Map(),
    };

    if (Array.isArray(day.breakdown)) {
      for (const item of day.breakdown) {
        totals.models.set(normalizeModelName(item.name), cloneTotals(item.tokens));
      }
    }

    if (!totals.models.size && totals.total > 0) {
      totals.models.set("gpt-5.6-sol", cloneTotals(totals));
    }

    dailyTotals.set(day.date, totals);
  }

  return dailyTotals;
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
        try {
          files.push({ path: fullPath, stat: await fsp.stat(fullPath) });
        } catch {
          continue;
        }
      }
    }
  }

  await walk(root);
  return files;
}

async function processFile(file, startDate, endDate, dailyTotals) {
  const filePath = typeof file === "string" ? file : file.path;
  const stat = typeof file === "string" ? await fsp.stat(filePath) : file.stat;
  if (stat.size === 0 || stat.mtime < startDate) {
    return;
  }

  let previousTotals = null;
  let currentModel = null;
  const stream = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 1024 * 1024 });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of lines) {
    const isTokenCountLine = line.includes('"token_count"');
    const mightCarryModel = (
      !isTokenCountLine &&
      line.length < LARGE_NON_USAGE_LINE_BYTES &&
      (line.includes('"model"') || line.includes('"model_name"'))
    );
    if (!isTokenCountLine && !mightCarryModel) {
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
    addDaily(dailyTotals.get(dayKey), rawUsage, extractedModel || currentModel || "gpt-5.6-sol");
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

  const existingPayload = await readExistingPayload(outputPath);
  const existingStat = await readExistingStat(outputPath);
  const canIncremental = (
    process.env.PROFILE_EXPORT_FULL !== "1" &&
    existingPayload?.providers?.[0]?.daily?.length &&
    existingStat
  );
  const resetStartDate = canIncremental
    ? startOfDay(new Date(existingStat.mtimeMs))
    : startDate;
  const processStartDate = resetStartDate < startDate ? startDate : resetStartDate;

  const files = await listJsonlFiles(sessionsRoot);
  const filesToProcess = canIncremental
    ? files.filter((file) => file.stat.mtime >= processStartDate)
    : files;
  const dailyTotals = canIncremental
    ? dailyTotalsFromExisting(existingPayload, processStartDate)
    : new Map();
  for (const file of filesToProcess) {
    await processFile(file, processStartDate, endDate, dailyTotals);
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
    acc.cache.write += day.cache.write || 0;
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
  if (canIncremental) {
    console.log(`Incremental refresh from ${isoDate(processStartDate)}; files: ${filesToProcess.length}/${files.length}`);
  }
}

async function readExistingPayload(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readExistingStat(filePath) {
  try {
    return await fsp.stat(filePath);
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
