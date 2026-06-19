/* build_all.mjs — assemble data.json from per-range raw connector dumps.
 *
 * Input  : _data/<range>/raw/*.json   (each = a parsed ad_entities array)
 * Output : data.json                  (what the PWA fetches)
 *
 * Core arrays (account / campaigns / campaignsDaily / ads, current + previous)
 * pass through untouched. Breakdown arrays are pre-aggregated by
 * (campaign_id × dimension value) — this is exactly the grouping the app does
 * at index.html drawBreakdownChart(), so buckets come out identical, while the
 * row count drops from ~1000 (ad×dim) to ~tens. purchase_roas is stored as a
 * spend-weighted average so the app's pv = spend × roas reconstructs Σ(pv_i).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DATA_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DATA_DIR, "..");

const RANGES = ["today","yesterday","last_7d","last_14d","last_30d","last_90d","this_month","last_month","maximum"];

// slot file -> dimension fields to group by. Output key matches the app's
// `args.breakdowns.join(",")` lookup in the callTool resolver.
const BK = {
  publisher_platform: { fields:["publisher_platform"], key:"publisher_platform" },
  platform_position:  { fields:["platform_position"],  key:"platform_position" },
  impression_device:  { fields:["impression_device"],  key:"impression_device" },
  age:                { fields:["age"],                 key:"age" },
  gender:             { fields:["gender"],              key:"gender" },
  agegender:          { fields:["age","gender"],        key:"age,gender" },
  country:            { fields:["country"],             key:"country" },
  region:             { fields:["region"],              key:"region" }
};

// mirrors num() in index.html
const num = v => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const s = String(v);
  if (/not available/i.test(s)) return 0;
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
};

function readArr(p) {
  try { const j = JSON.parse(fs.readFileSync(p, "utf8")); return Array.isArray(j) ? j : []; }
  catch { return []; }
}

function aggBreakdown(rows, fields) {
  const map = new Map();
  for (const r of rows) {
    // Breakdowns are fetched at campaign level, so the campaign id arrives as `id`.
    const campId = r.campaign_id != null ? r.campaign_id : r.id;
    const camp = campId != null ? String(campId) : "";
    const key = camp + "||" + fields.map(f => (r[f] == null ? "" : String(r[f]))).join("|");
    let g = map.get(key);
    if (!g) {
      g = { campaign_id: campId, _spend:0,_impr:0,_reach:0,_clicks:0,_purch:0,_pv:0 };
      for (const f of fields) if (r[f] != null) g[f] = r[f];
      map.set(key, g);
    }
    const spend = num(r.amount_spent), roas = num(r.purchase_roas);
    g._spend += spend; g._impr += num(r.impressions); g._reach += num(r.reach);
    g._clicks += num(r.clicks); g._purch += num(r["actions:omni_purchase"]); g._pv += spend * roas;
  }
  const out = [];
  for (const g of map.values()) {
    const row = { campaign_id: g.campaign_id };
    for (const f of fields) if (g[f] != null) row[f] = g[f];
    row.amount_spent = g._spend;
    row.impressions = g._impr;
    row.reach = g._reach;
    row.clicks = g._clicks;
    row["actions:omni_purchase"] = g._purch;
    row.purchase_roas = g._spend > 0 ? g._pv / g._spend : 0;
    out.push(row);
  }
  return out;
}

const ranges = {};
const report = [];
for (const rg of RANGES) {
  const raw = path.join(DATA_DIR, rg, "raw");
  if (!fs.existsSync(raw)) { report.push(`${rg}: MISSING`); continue; }
  const breakdowns = {};
  for (const [slot, def] of Object.entries(BK)) {
    breakdowns[def.key] = aggBreakdown(readArr(path.join(raw, `bk_${slot}.json`)), def.fields);
  }
  const cur = {
    account: readArr(path.join(raw, "acct_cur.json")),
    campaigns: readArr(path.join(raw, "camp_cur.json")),
    campaignsDaily: readArr(path.join(raw, "campdaily_cur.json")),
    ads: readArr(path.join(raw, "ads_cur.json"))
  };
  const prev = {
    account: readArr(path.join(raw, "acct_prev.json")),
    campaigns: readArr(path.join(raw, "camp_prev.json")),
    ads: readArr(path.join(raw, "ads_prev.json"))
  };
  ranges[rg] = { current: cur, previous: prev, breakdowns };
  report.push(`${rg}: ads=${cur.ads.length} camp=${cur.campaigns.length} daily=${cur.campaignsDaily.length} prevAds=${prev.ads.length} bk=[${Object.entries(breakdowns).map(([k,v])=>k.split(",")[0]+":"+v.length).join(" ")}]`);
}

const out = {
  metadata: {
    generated_at: new Date().toISOString(),
    account_id: "1675016859991849",
    account_name: "OT_gettallboy-CC"
  },
  ranges
};

const outPath = path.join(ROOT, "data.json");
fs.writeFileSync(outPath, JSON.stringify(out));
const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
console.log(report.join("\n"));
console.log(`\nWrote ${outPath} (${kb} KB) · ranges: ${Object.keys(ranges).length}/9`);
