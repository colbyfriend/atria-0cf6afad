# Atria snapshot refresh — procedure

This is the exact, mechanical procedure to (re)generate `data.json`, the snapshot the
PWA reads. It is run by a Claude agent because only Claude can call the Meta connector.
The same procedure is used by the scheduled refresh agent.

**Connector tool:** `mcp__ea0e2fa9-b8ef-4daf-a827-49ed508e3976__ads_get_ad_entities`
**Ad account id:** `1675016859991849`
**Working dir:** the `atria-mobile/` folder. Load the tool first:
`ToolSearch → "select:mcp__ea0e2fa9-b8ef-4daf-a827-49ed508e3976__ads_get_ad_entities"`

## Field sets (use verbatim)
- **ACCT_FIELDS** = `["amount_spent","impressions","reach","frequency","cpm","cpc","ctr","clicks","purchase_roas","actions:omni_purchase","actions:link_click"]`
- **CAMP_FIELDS** = `["id","name","amount_spent","impressions","reach","frequency","cpm","cpc","ctr","clicks","purchase_roas","actions:omni_purchase","actions:link_click"]`
- **DAILY_FIELDS** = `["id","name","amount_spent","impressions","clicks","reach","purchase_roas","actions:omni_purchase"]`
- **AD_FIELDS** = `["id","name","campaign_id","amount_spent","impressions","reach","frequency","cpm","cpc","ctr","clicks","purchase_roas","actions:omni_purchase","actions:link_click","video_p25_watched_actions","video_p50_watched_actions","video_p75_watched_actions","video_p95_watched_actions","video_p100_watched_actions","video_thruplay_watched_actions","creative_id"]`
- **AD_FIELDS_LITE** = `["id","name","campaign_id","amount_spent","impressions","reach","clicks","purchase_roas","actions:omni_purchase","actions:link_click"]`
- **BK_FIELDS** = `["id","name","amount_spent","impressions","reach","clicks","purchase_roas","actions:omni_purchase"]`  (campaign level — `campaign_id` is not a valid field there; the campaign id comes back as `id`)

## The 9 ranges
`today, yesterday, last_7d, last_14d, last_30d, last_90d, this_month, last_month, maximum`

## Per range `<RG>` — make 15 calls, dump each to a raw slot file

First: `mkdir -p _data/<RG>/raw`

**Capture rule (applies to EVERY call below).** The tool returns either inline JSON
`{"ad_entities":"[...]","summary":{...}}`, OR a message `Output has been saved to <PATH>`.
- If saved to a file: `jq -r '.ad_entities' '<PATH>' > _data/<RG>/raw/<slot>.json`
- If inline: write the full tool JSON to `_data/<RG>/raw/_tmp.json` (Write tool), then
  `jq -r '.ad_entities' _data/<RG>/raw/_tmp.json > _data/<RG>/raw/<slot>.json`
- Verify each: `jq -e 'type=="array"' _data/<RG>/raw/<slot>.json >/dev/null && echo OK`

### Current period (param: `date_preset:"<RG>"`)
| slot | level | fields | extra |
|---|---|---|---|
| `acct_cur` | account | ACCT_FIELDS | — |
| `camp_cur` | campaign | CAMP_FIELDS | `sort:"amount_spent_descending", limit:60` |
| `campdaily_cur` | campaign | DAILY_FIELDS | `time_increment:"1", limit:400` |
| `ads_cur` | ad | AD_FIELDS | `sort:"amount_spent_descending", limit:300` |

### Compute the previous window from `acct_cur`
```
node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const r=(a[0]||{});const ds=new Date(r.date_start),de=new Date(r.date_stop);if(isNaN(ds)||isNaN(de)){console.log("");process.exit(0)}const len=Math.round((de-ds)/864e5)+1;const pu=new Date(ds);pu.setDate(pu.getDate()-1);const ps=new Date(pu);ps.setDate(ps.getDate()-(len-1));const f=d=>d.toISOString().slice(0,10);console.log(JSON.stringify({since:f(ps),until:f(pu)}))' _data/<RG>/raw/acct_cur.json
```
This prints e.g. `{"since":"2026-05-22","until":"2026-06-04"}`. Use that exact string as the
`time_range` param below. If it prints empty (no data), write `[]` to `acct_prev.json`,
`camp_prev.json`, `ads_prev.json` and skip the 3 previous calls.

### Previous period (param: `time_range:'<the JSON above>'`)
| slot | level | fields | extra |
|---|---|---|---|
| `acct_prev` | account | ACCT_FIELDS | — |
| `camp_prev` | campaign | CAMP_FIELDS | `limit:60` |
| `ads_prev` | ad | AD_FIELDS_LITE | `sort:"amount_spent_descending", limit:300` |

### Breakdowns (param: `date_preset:"<RG>"`, every call: `level:"campaign", fields:BK_FIELDS, limit:500`)
IMPORTANT: breakdowns MUST be fetched at `level:"campaign"` (not `ad`) — the ad level does not
return the dimension value, but the campaign level returns one row per (campaign × dimension value)
with the dimension field populated (e.g. `publisher_platform`, `age`).
| slot | breakdowns |
|---|---|
| `bk_publisher_platform` | `["publisher_platform"]` |
| `bk_platform_position` | `["platform_position"]` |
| `bk_impression_device` | `["impression_device"]` |
| `bk_age` | `["age"]` |
| `bk_gender` | `["gender"]` |
| `bk_agegender` | `["age","gender"]` |
| `bk_country` | `["country"]` |
| `bk_region` | `["region"]` |

If a breakdown returns empty, write `[]` to that slot — do not retry without breakdowns.

After the 15 slot files exist and verify as arrays, the range is done. Remove `_tmp.json`.

## Assemble (run once, after all needed ranges have their raw/ files)
```
node _data/build_all.mjs
```
This pre-aggregates the breakdowns and writes `data.json` at the repo root, stamping
`metadata.generated_at` with the current time. Print its output to confirm row counts.
