#!/usr/bin/env python3
"""Render a conservative reader-facing tracker from inventory and defect JSON."""

from __future__ import annotations

import collections
import datetime
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "docs/stabilization"
MODES = ("guest", "member", "admin")
TOOL_SURFACE = "Tools / registered executor"


def read():
    inventory = json.loads((BASE / "inventory.json").read_text())
    defects = {data["id"]: data for path in sorted((BASE / "defects").glob("*.json"))
               if (data := json.loads(path.read_text()))}
    return inventory, defects


def esc(value):
    return html.escape(str(value), quote=True)


def md(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def result_status(case, mode, feature):
    applicability = feature.get("applicability", {}).get(mode, {})
    if applicability.get("applicable") is False:
        return "N/A", applicability.get("reason") or "Marked inapplicable in inventory"
    if mode not in case.get("modes", []):
        return "N/A", "Case does not target this role"
    raw_result = case.get("results", {}).get(mode)
    if not isinstance(raw_result, dict):
        if "deferred" in feature.get("surface", "").lower():
            return "Deferred", "Planned for a later testing wave"
        return "Unverified", "No recorded result for this role"
    raw = str(raw_result.get("status", "unverified"))
    names = {"pass": "Pass", "fail": "Fail", "partial": "Partial",
             "unverified": "Unverified", "not-applicable": "N/A",
             "deferred": "Deferred"}
    if raw not in names:
        return "Unverified", f"Unrecognized recorded status: {raw}"
    return names[raw], raw_result.get("detail", "")


def feature_status(feature, mode):
    applicable = [c for c in feature["cases"] if result_status(c, mode, feature)[0] != "N/A"]
    if not applicable:
        return "N/A"
    statuses = [result_status(c, mode, feature)[0] for c in applicable]
    if "Fail" in statuses:
        return "Fail"
    if "Partial" in statuses:
        return "Partial"
    if "Unverified" in statuses:
        return "Unverified"
    if "Deferred" in statuses:
        return "Deferred"
    # A case pass is not full feature proof when inventoried controls lack a case.
    covered = {cid for c in applicable for cid in c.get("control_ids", [])}
    if any(c["id"] not in covered for c in feature["controls"]):
        return "Partial"
    return "Pass"


def control_gaps(feature):
    covered = {cid for case in feature["cases"] for cid in case.get("control_ids", [])}
    return [control for control in feature["controls"] if control["id"] not in covered]


def defect_links(feature, defects):
    ids = set()
    for cell in feature.get("cells", {}).values():
        ids.update(cell.get("defect_ids", []))
    for case in feature["cases"]:
        ids.update(case.get("defect_ids", []))
        ids.update(case.get("linked_defects", []))
    ids.update(did for did, defect in defects.items() if defect.get("feature_id") == feature["id"]
               or feature["id"] in defect.get("related_feature_ids", []))
    return sorted(ids)


def evidence(result):
    if not isinstance(result, dict):
        return []
    return [str(result[k]) for k in ("run_id", "build_variant", "build_receipt", "date", "verified_at", "evidence")
            if result.get(k)]


def next_action(feature, statuses, gaps, defects):
    active = [d for d in defect_links(feature, defects) if defects.get(d, {}).get("state") not in ("closed", "retest-pass")]
    if active:
        return "Resolve linked defect and repeat its affected native case: " + ", ".join(active)
    if gaps:
        return f"Add cases for {len(gaps)} uncovered control(s), then verify them in the extension."
    if "Fail" in statuses:
        return "Repair the failing behavior and repeat the affected case in the extension."
    if "Partial" in statuses:
        return "Finish the missing criteria and repeat the partial case in the extension."
    if "Deferred" in statuses:
        return "Run the deferred wave's role cases when that wave starts."
    if "Unverified" in statuses:
        return "Run the remaining role cases in the extension and attach a result."
    return "No outstanding case in this inventory. Recheck after relevant changes."


def groups(features):
    grouped = collections.OrderedDict()
    for feature in features:
        grouped.setdefault(feature["surface"], []).append(feature)
    return grouped


def case_markdown(case, feature):
    return (f"| {case['id']} {md(case['title'])} | " + " | ".join(
        md(result_status(case, mode, feature)[0]) for mode in MODES) + " | " +
        md(", ".join(case.get("control_ids", [])) or "No control mapped") + " |")


def case_details(case, feature):
    lines = []
    for mode in MODES:
        status, detail = result_status(case, mode, feature)
        result = case.get("results", {}).get(mode, {})
        if status not in ("N/A", "Unverified", "Deferred") or evidence(result) or detail.startswith("Unrecognized"):
            lines.append(f"- {case['id']} · {mode}: {status}. {md(detail)}".rstrip())
            if evidence(result):
                lines.append("  Evidence / build / date recorded: " + md(", ".join(evidence(result))))
    return "\n".join(lines)


def feature_markdown(feature, defects):
    statuses = {mode: feature_status(feature, mode) for mode in MODES}
    gaps = control_gaps(feature)
    lines = [f"### {feature['name']} ({feature['id']})", "",
             "**Role status:** " + " · ".join(f"{mode}: {status}" for mode, status in statuses.items()) +
             f". **Cases:** {len(feature['cases'])}. **Controls:** {len(feature['controls'])}.", "",
             "**Next:** " + next_action(feature, list(statuses.values()), gaps, defects), ""]
    dids = defect_links(feature, defects)
    if dids:
        lines += ["**Linked defects:** " + ", ".join(
            f"[{did}](defects/{did}.json) ({defects.get(did, {}).get('state', 'missing record')})" for did in dids), ""]
    lines += ["| Case | Guest | Member | Admin | Controls exercised by case |",
              "| --- | --- | --- | --- | --- |"]
    lines += [case_markdown(case, feature) for case in feature["cases"]]
    details = [case_details(case, feature) for case in feature["cases"]]
    if any(details):
        lines += ["", "**Recorded case details and evidence:**", ""] + [x for x in details if x]
    if gaps:
        lines += ["", "**Controls without a mapped case:** " + "; ".join(
            f"{c['id']} {md(c.get('label', ''))}" for c in gaps)]
    if feature.get("readiness_gaps"):
        lines += ["", "**Other remaining work:** " + "; ".join(md(x) for x in feature["readiness_gaps"])]
    return "\n".join(lines) + "\n"


def feature_html(feature, defects):
    statuses = {mode: feature_status(feature, mode) for mode in MODES}
    gaps = control_gaps(feature)
    dids = defect_links(feature, defects)
    rows = []
    for case in feature["cases"]:
        cells = []
        for mode in MODES:
            status, detail = result_status(case, mode, feature)
            result = case.get("results", {}).get(mode, {})
            ev = evidence(result)
            ev_html = " · ".join(esc(v) for v in ev)
            cells.append(f'<td><span class="badge {status.lower().replace("/", "")}">{esc(status)}</span>' +
                         (f'<small>{esc(detail)}</small>' if detail else "") +
                         (f'<small>{ev_html}</small>' if ev else "") + '</td>')
        rows.append(f'<tr><th scope="row">{esc(case["title"])}<small>{esc(case["id"])}</small></th>' +
                    "".join(cells) + f'<td><small>{esc(", ".join(case.get("control_ids", [])) or "No control mapped")}</small></td></tr>')
    defect_html = " · ".join(
        f'<a href="defects/{esc(did)}.json">{esc(did)}</a> ({esc(defects.get(did, {}).get("state", "missing record"))})'
        for did in dids) or "None recorded"
    gaps_html = "<br>".join(f'{esc(c["id"])} {esc(c.get("label", ""))}' for c in gaps) or "None"
    readiness = "<br>".join(esc(x) for x in feature.get("readiness_gaps", [])) or "None recorded"
    search = " ".join([feature["name"], feature["surface"], feature["id"]] +
                      [c["title"] for c in feature["cases"]] + dids).lower()
    state = " ".join(statuses.values()).lower()
    return f'''<details class="feature" data-search="{esc(search)}" data-state="{esc(state)}">
<summary><strong>{esc(feature['name'])}</strong><span class="id">{esc(feature['id'])}</span>
<span class="rolebadges">{''.join(f'<span class="badge {v.lower().replace("/", "")}">{esc(m)}: {esc(v)}</span>' for m,v in statuses.items())}</span></summary>
<div class="featurebody"><p><strong>Next:</strong> {esc(next_action(feature, list(statuses.values()), gaps, defects))}</p>
<p>{len(feature['cases'])} cases · {len(feature['controls'])} controls · <strong>Linked defects:</strong> {defect_html}</p>
<div class="tablewrap"><table><thead><tr><th>Case</th><th>Guest</th><th>Member</th><th>Admin</th><th>Mapped controls</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>
<details class="sub"><summary>Remaining control and readiness gaps</summary><p><strong>Controls without a mapped case:</strong><br>{gaps_html}</p><p><strong>Other remaining work:</strong><br>{readiness}</p></details>
</div></details>'''


def render(inventory, defects):
    generated_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    features = inventory["features"]
    grouped = groups(features)
    total_cases = sum(len(f["cases"]) for f in features)
    total_controls = sum(len(f["controls"]) for f in features)
    intro = ("A feature is fully verified for a role only when every applicable case explicitly passes and every "
             "inventoried control has a mapped case. A pass on one case does not verify the whole feature. "
             "Unrecorded results remain unverified. A fixed or closed defect does not itself prove native behavior.")
    summary = []
    for surface, items in grouped.items():
        counts = {mode: collections.Counter(feature_status(f, mode) for f in items) for mode in MODES}
        case_counts = {mode: collections.Counter(result_status(c, mode, f)[0] for f in items for c in f["cases"])
                       for mode in MODES}
        active_defects = {did for f in items for did in defect_links(f, defects)
                          if defects.get(did, {}).get("state") not in ("closed", "retest-pass")}
        summary.append((surface, items, counts, case_counts, active_defects))
    def case_digest(counter):
        return (f"{counter['Pass']} pass · {counter['Partial']} partial · {counter['Fail']} fail · "
                f"{counter['Unverified']} unverified · {counter['Deferred']} deferred")
    md_lines = ["# Extension stabilization status", "",
                f"Generated {generated_at} from inventory.json and defects/*.json. Inventory updated {inventory.get('updated_at', 'date not recorded')}. "
                f"{len(features)} features · {total_cases} cases · {total_controls} controls · {len(defects)} linked defect records.", "",
                intro, "", "## Tab and surface overview", "",
                "| Tab or surface | Feature records | Guest cases | Member cases | Admin cases | Active defects |",
                "| --- | ---: | --- | --- | --- | ---: |"]
    for surface, items, counts, case_counts, active_defects in summary:
        md_lines.append(f"| [{md(surface)}](#{surface.lower().replace(' ', '-').replace('/', '').replace('(', '').replace(')', '')}) | {len(items)} | " +
                        " | ".join(f"{case_digest(case_counts[m])}; {counts[m]['Pass']}/{len(items) - counts[m]['N/A']} full" for m in MODES) +
                        f" | {len(active_defects)} |")
    md_lines += ["", "Counts exclude N/A feature-role combinations from each denominator. Open each feature for cases, evidence, defects, and next action.", ""]
    for surface, items, _, _, _ in summary:
        md_lines += [f"## {surface}", ""]
        if surface == TOOL_SURFACE:
            md_lines += ["Registered tools are executor capabilities, listed separately from the visible Tools tab. Their planned manual cases are not native passes.", ""]
        for feature in items:
            md_lines += [feature_markdown(feature, defects), ""]
    (BASE / "STATUS.md").write_text("\n".join(md_lines))

    table_rows = []
    sections = []
    for index, (surface, items, counts, case_counts, active_defects) in enumerate(summary):
        sid = f"surface-{index}"
        table_rows.append(f'<tr><th scope="row"><a href="#{sid}">{esc(surface)}</a></th><td>{len(items)}</td>' +
                          ''.join(f'<td><strong>{counts[m]["Pass"]}/{len(items)-counts[m]["N/A"]} full</strong><small>{esc(case_digest(case_counts[m]))}</small></td>' for m in MODES) +
                          f'<td>{len(active_defects)}</td></tr>')
        features_html = "".join(feature_html(f, defects) for f in items)
        note = '<p class="hint">Registered executor tools are listed separately from visible Tools tab controls.</p>' if surface == TOOL_SURFACE else ""
        sections.append(f'<details class="surface" id="{sid}" {"" if surface == TOOL_SURFACE else "open"}>'
                        f'<summary><span>{esc(surface)}</span><small>{len(items)} feature(s) · ' +
                        ' · '.join(f'{m} {counts[m]["Pass"]}/{len(items)-counts[m]["N/A"]}' for m in MODES) +
                        f'</small></summary>{note}{features_html}</details>')
    page = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Extension stabilization status</title>
<style>:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#19283c;background:#f5f7fb}*{box-sizing:border-box}body{margin:0}main{max-width:1450px;margin:auto;padding:24px}h1{font-size:2rem;margin:0 0 8px}.lede{max-width:1000px;line-height:1.55;color:#465770}.meta{color:#596a80}a{color:#145ba3}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #dce3ed;padding:10px}thead{background:#eaf0f7}small{display:block;color:#65758a;font-size:.78rem;margin-top:4px;line-height:1.35}.tablewrap{overflow:auto}.summary{border:1px solid #dce3ed;border-radius:12px;overflow:hidden;margin:20px 0}.toolbar{position:sticky;top:0;background:#f5f7fb;padding:12px 0;display:flex;gap:10px;z-index:2;flex-wrap:wrap}input,select{padding:10px;border:1px solid #b9c7d8;border-radius:8px;font:inherit;background:white}input{min-width:min(400px,100%);flex:1}.surface,.feature{background:white;border:1px solid #dce3ed;border-radius:10px;margin:12px 0}.surface>summary,.feature>summary{cursor:pointer;padding:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.surface>summary{font-weight:700;font-size:1.16rem;background:#edf3fb}.surface>summary small{margin-left:auto}.feature>summary strong{font-size:1rem}.featurebody{padding:0 14px 14px}.id{font-size:.75rem;color:#67788e}.rolebadges{display:flex;gap:5px;flex-wrap:wrap;margin-left:auto}.badge{display:inline-block;border-radius:6px;padding:3px 7px;background:#e9edf3;color:#35465a;font-size:.78rem;font-weight:600;white-space:nowrap}.pass{background:#dcf4e5;color:#126238}.fail{background:#ffe0dc;color:#9f251e}.partial{background:#fff0c8;color:#805500}.deferred{background:#e9e4fa;color:#55399a}.unverified{background:#e7edf5;color:#44566e}.na{background:#f1f2f4;color:#67717e}.sub{margin-top:12px}.sub summary{cursor:pointer}.hint{padding:0 14px;color:#61738a}.hidden{display:none!important}@media(max-width:700px){main{padding:12px}.surface>summary small,.rolebadges{margin-left:0}.summary td,.summary th{padding:6px}}</style></head><body><main>
<h1>Extension stabilization status</h1><p class="meta">Generated GENERATED from inventory.json and defects/*.json · Inventory updated DATE · FEATURE features · CASE cases · CONTROL controls · DEFECT defect records</p><p class="lede">INTRO</p>
<div class="toolbar"><input id="search" type="search" placeholder="Search tabs, features, cases, defects" aria-label="Search tracker"><select id="filter" aria-label="Filter feature status"><option value="all">All statuses</option><option value="pass">Pass</option><option value="partial">Partial</option><option value="fail">Fail</option><option value="unverified">Unverified</option><option value="deferred">Deferred</option></select><span id="visible" class="meta"></span></div>
<div class="tablewrap summary"><table><thead><tr><th>Tab or surface</th><th>Feature records</th><th>Guest</th><th>Member</th><th>Admin</th><th>Active defects</th></tr></thead><tbody>ROWS</tbody></table></div><p class="meta">“Full” means all applicable cases passed and all controls have a mapped case. Case counts exclude N/A roles. Active defects include open, in-fix, and fixed awaiting closure; a zero fail count does not erase these issues.</p>
SECTIONS
<script>const search=document.getElementById('search'),filter=document.getElementById('filter'),visible=document.getElementById('visible');function update(){const q=search.value.trim().toLowerCase(),s=filter.value;let count=0;for(const section of document.querySelectorAll('.surface')){let shown=0;const surfaceName=section.querySelector('summary span').textContent.toLowerCase();for(const feature of section.querySelectorAll('.feature')){const hit=(!q||feature.dataset.search.includes(q)||surfaceName.includes(q))&&(s==='all'||feature.dataset.state.split(' ').includes(s));feature.classList.toggle('hidden',!hit);if(hit)shown++}section.classList.toggle('hidden',!shown);if(q&&shown)section.open=true;count+=shown}visible.textContent=count+' features shown'}search.addEventListener('input',update);filter.addEventListener('change',update);update();</script></main></body></html>'''
    page = (page.replace("GENERATED", esc(generated_at))
            .replace("DATE", esc(inventory.get("updated_at", "date not recorded")))
            .replace("FEATURE", str(len(features))).replace("CASE", str(total_cases))
            .replace("CONTROL", str(total_controls)).replace("DEFECT", str(len(defects)))
            .replace("INTRO", esc(intro)).replace("ROWS", "".join(table_rows))
            .replace("SECTIONS", "\n".join(sections)))
    (BASE / "STATUS.html").write_text(page)


if __name__ == "__main__":
    render(*read())
