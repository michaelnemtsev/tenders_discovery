#!/usr/bin/env node
/*
 * Accumulate daily tender runs into a single aggregate the portal can show
 * as a monthly / all-time view. Zero dependencies.
 *
 * Flow (run this once per day, after the routine writes output/tenders.json):
 *   1. Fold output/tenders.json into output/daily/<run_date>.json (idempotent).
 *   2. Read every output/daily/*.json snapshot in date order.
 *   3. De-duplicate tenders by dedup_key and sources by source_url, tracking
 *      first_seen / last_seen / how many runs each appeared in.
 *   4. Write output/aggregate.json.
 *
 *   node scripts/aggregate.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output");
const DAILY = path.join(OUT, "daily");
const LATEST = path.join(OUT, "tenders.json");
const AGG = path.join(OUT, "aggregate.json");

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; }
}
function minDate(a, b) { return a < b ? a : b; }
function maxDate(a, b) { return a > b ? a : b; }
function month(d) { return (d || "").slice(0, 7); } // YYYY-MM

function tenderKey(t) {
  return t.dedup_key || [t.source_name, t.tender_id, t.title].join("|");
}
function sourceKey(s) {
  return s.source_url || s.source_name;
}

function fold(map, items, keyFn, runDate) {
  (items || []).forEach(function (item) {
    const key = keyFn(item);
    let cur = map.get(key);
    if (!cur) cur = { rec: {}, seen: new Set(), first: runDate, last: runDate };
    cur.seen.add(runDate);
    cur.first = minDate(cur.first, runDate);
    cur.last = maxDate(cur.last, runDate);
    cur.rec = Object.assign(cur.rec, item); // snapshots processed in date order → latest values win
    map.set(key, cur);
  });
}

function finalize(map, latestRun) {
  return Array.from(map.values()).map(function (v) {
    const dates = Array.from(v.seen).sort();
    return Object.assign({}, v.rec, {
      first_seen: v.first,
      last_seen: v.last,
      seen_dates: dates,
      seen_count: dates.length,
      is_new_in_latest: latestRun != null && v.first === latestRun,
      active_in_latest: latestRun != null && v.last === latestRun
    });
  });
}

function main() {
  fs.mkdirSync(DAILY, { recursive: true });

  // 1. Fold the latest run into the daily archive (idempotent — overwrites same date).
  const latest = readJson(LATEST);
  if (latest && latest.run_metadata && latest.run_metadata.run_date) {
    const d = latest.run_metadata.run_date;
    fs.writeFileSync(path.join(DAILY, d + ".json"), JSON.stringify(latest, null, 2));
  }

  // 2. Read all snapshots in ascending date order.
  const files = fs.readdirSync(DAILY).filter(function (f) { return f.endsWith(".json"); }).sort();
  if (!files.length) {
    console.error("No daily snapshots found in output/daily/. Run the search first.");
    process.exit(1);
  }

  const tenderMap = new Map();
  const sourceMap = new Map();
  const runDates = [];
  let lastCoverage = "";
  let latestMeta = {};

  files.forEach(function (f) {
    const snap = readJson(path.join(DAILY, f));
    if (!snap) return;
    const runDate = (snap.run_metadata && snap.run_metadata.run_date) || f.replace(/\.json$/, "");
    runDates.push(runDate);
    if (snap.run_metadata) {
      latestMeta = snap.run_metadata; // files are date-ascending, so the last one wins
      if (snap.run_metadata.coverage_summary) lastCoverage = snap.run_metadata.coverage_summary;
    }
    fold(tenderMap, snap.tenders, tenderKey, runDate);
    fold(sourceMap, snap.discovered_sources, sourceKey, runDate);
  });

  const runs = Array.from(new Set(runDates)).sort();
  const latestRun = runs[runs.length - 1] || null;

  const tenders = finalize(tenderMap, latestRun);
  const sources = finalize(sourceMap, latestRun);

  // Per-month summary, keyed by the month a tender was first discovered.
  const months = {};
  tenders.forEach(function (t) {
    const m = month(t.first_seen);
    if (!m) return;
    if (!months[m]) months[m] = { month: m, new_tenders: 0, active_tenders: 0 };
    months[m].new_tenders++;
  });
  tenders.forEach(function (t) {
    (t.seen_dates || []).forEach(function (d) {
      const m = month(d);
      if (months[m]) months[m].active_tenders = (months[m].active_tenders || 0);
    });
  });

  const aggregate = {
    generated: latestRun,
    runs: runs,
    run_count: runs.length,
    first_run: runs[0] || null,
    latest_run: latestRun,
    latest_coverage_summary: lastCoverage,
    latest_run_metadata: latestMeta,
    months: Object.keys(months).sort().map(function (k) { return months[k]; }),
    tenders: tenders,
    discovered_sources: sources
  };

  fs.writeFileSync(AGG, JSON.stringify(aggregate, null, 2));
  console.log(
    "Aggregated " + runs.length + " run(s) [" + (runs[0] || "-") + " .. " + (latestRun || "-") + "]: " +
    tenders.length + " unique tenders, " + sources.length + " unique sources -> output/aggregate.json"
  );
}

main();
