#!/usr/bin/env python3
"""Render a conservative reader-facing tracker from inventory and defect JSON."""

from __future__ import annotations

import collections
import datetime
import html
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "docs/stabilization"
MODES = ("guest", "member", "admin")
TOOL_SURFACE = "Tools / registered executor"


def read():
    inventory = json.loads((BASE / "inventory.json").read_text())
    defects = {data["id"]: data for path in sorted((BASE / "defects").glob("*.json"))
               if (data := json.loads(path.read_text()))}
    return inventory, defects


def read_coverage_audit():
    path = BASE / "reports/coverage-audit-20261001.json"
    return json.loads(path.read_text()) if path.exists() else {}


def inventory_source_delta(inventory):
    """Find changed source paths since the inventory base; exact anchor matching is only a triage hint."""
    source_sha = inventory.get("source_sha")
    if not source_sha:
        return {}
    try:
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
        changed = subprocess.check_output(["git", "diff", "--name-only", source_sha, head, "--", "src"],
                                          cwd=ROOT, text=True, stderr=subprocess.DEVNULL).splitlines()
    except subprocess.CalledProcessError:
        return {"inventory_source_sha": source_sha, "available": False,
                "interpretation": "Git could not compare the inventory source snapshot with the current revision."}
    anchors = []
    for feature in inventory["features"]:
        paths = set(feature.get("entry_points", [])) | set(feature.get("source_anchors", []))
        anchors.append(paths)
    matched = []
    unmatched = []
    for path in changed:
        direct = any(path in paths or any(anchor.endswith("/") and path.startswith(anchor) for anchor in paths)
                     for paths in anchors)
        (matched if direct else unmatched).append(path)
    return {
        "available": True,
        "inventory_source_sha": source_sha,
        "reviewed_head": head,
        "changed_src_files": len(changed),
        "exact_anchor_matches": len(matched),
        "without_direct_anchor": len(unmatched),
        "unmatched_path_examples": unmatched[:50],
        "interpretation": "A direct anchor miss is only a census-review hint. Feature inventory anchors are not an exhaustive dependency graph, so it does not prove an omitted feature or behavior."
    }


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
        note = "No recorded result for this role"
        if "deferred" in feature.get("surface", "").lower():
            note += "; this surface is assigned to a later wave"
        return "Unverified", note
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
    coverage_audit = read_coverage_audit()
    generated_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    features = inventory["features"]
    grouped = groups(features)
    total_cases = sum(len(f["cases"]) for f in features)
    total_controls = sum(len(f["controls"]) for f in features)
    intro = ("A feature is fully verified for a role only when every applicable case explicitly passes and every "
             "inventoried control has a mapped case. A pass on one case does not verify the whole feature. "
             "Unrecorded results remain unverified. Matrix passes retain their original build boundary; they count as "
             "current-build acceptance only when a receipt-bound report says so. A fixed or closed defect does not "
             "itself prove native behavior.")
    summary = []
    for surface, items in grouped.items():
        counts = {mode: collections.Counter(feature_status(f, mode) for f in items) for mode in MODES}
        case_counts = {mode: collections.Counter(
            result_status(c, mode, f)[0] for f in items
            if f.get("applicability", {}).get(mode, {}).get("applicable", False)
            for c in f["cases"] if mode in c.get("modes", [])) for mode in MODES}
        active_defects = {did for f in items for did in defect_links(f, defects)
                          if defects.get(did, {}).get("state") not in ("closed", "retest-pass")}
        summary.append((surface, items, counts, case_counts, active_defects))
    def case_digest(counter):
        return (f"{counter['Pass']} pass · {counter['Partial']} partial · {counter['Fail']} fail · "
                f"{counter['Unverified']} unverified · {counter['Deferred']} deferred")
    # Inventory-wide counts are computed here so the tracker never repeats a hand-maintained snapshot.
    slot_counts = collections.Counter()
    mode_slot_counts = {mode: collections.Counter() for mode in MODES}
    explicit_unverified_slots = 0
    no_result_slots = 0
    feature_role_pairs = 0
    fully_verified_pairs = 0
    procedure_gaps = collections.Counter()
    for feature in features:
        covered = {cid for case in feature["cases"] for cid in case.get("control_ids", [])}
        controls_complete = all(control["id"] in covered for control in feature["controls"])
        for case in feature["cases"]:
            if not case.get("steps"):
                procedure_gaps["missing_steps"] += 1
            if not case.get("expected"):
                procedure_gaps["missing_expected"] += 1
            if not case.get("control_ids"):
                procedure_gaps["missing_control_links"] += 1
            for mode in case.get("modes", []):
                if not feature.get("applicability", {}).get(mode, {}).get("applicable", False):
                    continue
                status, _ = result_status(case, mode, feature)
                slot_counts[status] += 1
                mode_slot_counts[mode][status] += 1
                raw_result = case.get("results", {}).get(mode)
                if not isinstance(raw_result, dict):
                    no_result_slots += 1
                elif raw_result.get("status") == "unverified":
                    explicit_unverified_slots += 1
        for mode, applicability in feature.get("applicability", {}).items():
            if not applicability.get("applicable"):
                continue
            feature_role_pairs += 1
            cases = [case for case in feature["cases"] if mode in case.get("modes", [])]
            if cases and controls_complete and all(result_status(case, mode, feature)[0] == "Pass" for case in cases):
                fully_verified_pairs += 1
    defect_counts = collections.Counter(defect.get("state", "missing") for defect in defects.values())
    inventory_updated = inventory.get("updated_at", "date not recorded")

    md_lines = ["# Extension stabilization status", "",
                f"Generated {generated_at} from inventory.json and defects/*.json. Inventory updated {inventory.get('updated_at', 'date not recorded')}. "
                f"{len(features)} features · {total_cases} cases · {total_controls} controls · {len(defects)} linked defect records.", "",
                intro, "", "## Current coverage snapshot", "",
                f"Applicable case-by-role slots: **{sum(mode_slot_counts[m].total() for m in MODES)}** — " +
                " · ".join(f"{name}: {slot_counts[name]}" for name in ("Pass", "Partial", "Fail", "Unverified", "N/A")) + ".",
                f"Unverified splits into **{explicit_unverified_slots} explicitly marked unverified** and **{no_result_slots} with no result record**.",
                f"Full feature-role pairs: **{fully_verified_pairs}/{feature_role_pairs}**. Procedure gaps: " +
                f"{procedure_gaps['missing_steps']} cases without steps, {procedure_gaps['missing_expected']} without expected outcomes, " +
                f"{procedure_gaps['missing_control_links']} without control links.",
                "A recorded pass is historical or bounded until its evidence explicitly binds it to the current artifact. " +
                "The current release receipt and scoped native results are listed separately in the checklist.", "",
                "## Tab and surface overview", "",
                "| Tab or surface | Features | Guest cases | Member cases | Admin cases | All-role case slots | Active defects |",
                "| --- | ---: | --- | --- | --- | --- | ---: |"]
    for surface, items, counts, case_counts, active_defects in summary:
        md_lines.append(f"| [{md(surface)}](#{surface.lower().replace(' ', '-').replace('/', '').replace('(', '').replace(')', '')}) | {len(items)} | " +
                        " | ".join(f"{case_digest(case_counts[m])}; {counts[m]['Pass']}/{len(items) - counts[m]['N/A']} full" for m in MODES) +
                        " | " + ", ".join(f"{k.lower()} {sum(case_counts[m][k] for m in MODES)}" for k in ("Pass", "Partial", "Fail", "Unverified", "N/A")) +
                        f" | {len(active_defects)} |")
    md_lines += ["", "Role counts include only case-role combinations listed in each case. The all-role column includes every applicable recorded or unrecorded slot. Open each feature for case evidence, defects, and next action.", ""]
    if coverage_audit:
        current = coverage_audit.get("current_verified_checkpoint", {})
        md_lines += ["## Current artifact and bounded acceptance", "",
                     f"**Release:** {current.get('source_release', 'not recorded')} at `{current.get('release_commit', 'commit not recorded')}`. " +
                     current.get("release_claim", "Release gate status not recorded."),
                     f"**Local artifact:** {current.get('local_artifact', 'No receipt recorded.')}",
                     f"**Native evidence:** {current.get('native_notes', 'No current native evidence overlay recorded.')}",
                     "These current-build checks supplement the inventory matrix; they do not promote unobserved cases or certify whole features.", ""]
    for surface, items, _, _, _ in summary:
        md_lines += [f"## {surface}", ""]
        if surface == TOOL_SURFACE:
            md_lines += ["Registered tools are executor capabilities, listed separately from the visible Tools tab. Their planned manual cases are not native passes.", ""]
        for feature in items:
            md_lines += [feature_markdown(feature, defects), ""]
    (BASE / "STATUS.md").write_text("\n".join(md_lines))

    # Concise action sheet generated from the same inventory and current evidence overlay.
    checklist = ["# Stabilization checklist", "",
                 f"Generated {generated_at} from inventory.json, defect records, and the current coverage audit. Inventory updated {inventory_updated}.", "",
                 "## Current truth", "",
                 f"- Scope: {len(features)} feature records, {total_cases} cases, {total_controls} controls, {sum(mode_slot_counts[m].total() for m in MODES)} applicable case-role slots.",
                 f"- Case results: " + ", ".join(f"{k.lower()} {slot_counts[k]}" for k in ("Pass", "Partial", "Fail", "Unverified", "N/A")) +
                 f"; {explicit_unverified_slots} explicitly unverified and {no_result_slots} with no result record. Missing results count as unverified, including later-wave surfaces.",
                 f"- Fully verified feature-role pairs: {fully_verified_pairs}/{feature_role_pairs} under the rule that every applicable case passes and every control maps to a case.",
                 f"- Procedure gaps: {procedure_gaps['missing_steps']} missing steps; {procedure_gaps['missing_expected']} missing expected outcomes; {procedure_gaps['missing_control_links']} missing control links.",
                 "- Defect states: " + ", ".join(f"{state} {defect_counts[state]}" for state in ("closed", "retest-pass", "fixed", "in-fix", "open") if defect_counts[state]) + ". A fixed or closed defect is not a feature-level UI pass.", "",
                 "## Current-build evidence", ""]
    if coverage_audit:
        current = coverage_audit.get("current_verified_checkpoint", {})
        checklist += [f"- **Release {current.get('source_release', 'unknown')}:** {current.get('release_claim', 'No release-gate evidence recorded.')}",
                      f"- **Artifact:** {current.get('local_artifact', 'No receipt recorded.')}",
                      f"- **Scoped native acceptance:** {current.get('native_notes', 'No current native acceptance recorded.')}",
                      "- These receipts establish only the named checks on the named artifact. Other inventory passes keep their recorded historical build boundary.", ""]
        source_delta = inventory_source_delta(inventory) or coverage_audit.get("source_delta_since_inventory", {})
        if source_delta:
            checklist += ["## Inventory freshness review", "",
                          f"Since inventory source `{source_delta.get('inventory_source_sha')}`, **{source_delta.get('changed_src_files')} `src/` paths changed** through `{source_delta.get('reviewed_head')}`. " +
                          f"A direct path-anchor comparison matched {source_delta.get('exact_anchor_matches')} and left {source_delta.get('without_direct_anchor')} without an exact inventory anchor.",
                          source_delta.get("interpretation", "This is a review signal only; absence of an exact anchor does not establish an omitted feature."), ""]
    priorities = coverage_audit.get("major_gaps_and_next_actions", [])
    if priorities:
        checklist += ["## Next test priorities", ""]
        for item in priorities:
            scope = item.get('scope', 'Scope')
            gap = item.get('gap', '')
            if scope == "Coverage model / all contained surfaces":
                gap = (f"{fully_verified_pairs} of {feature_role_pairs} applicable feature-role pairs meet the full-verification rule. "
                       f"The inventory records {slot_counts['Pass']} pass, {explicit_unverified_slots} explicit unverified, "
                       f"{slot_counts['Partial']} partial, {slot_counts['Fail']} fail, {slot_counts['N/A']} not applicable, "
                       f"and {no_result_slots} slots with no result. A pass retains its original build boundary.")
            elif scope == "Executable test procedures":
                tool_cases = sum(len(f["cases"]) for f in features if f["surface"] == TOOL_SURFACE)
                gap = (f"{procedure_gaps['missing_steps']} cases lack steps, {procedure_gaps['missing_expected']} lack expected outcomes, "
                       f"and {procedure_gaps['missing_control_links']} lack control links. The registered-executor surface has "
                       f"{tool_cases} cases; its live catalog parity does not prove runtime behavior.")
            checklist.append(f"- **{scope}** — {gap} Next: {item.get('next', '')}")
        checklist.append("")
    checklist += ["## Per-surface case totals", "",
                  "Pass and partial counts are recorded results; unverified includes explicit unverified and no-result slots. These are case-role slots, not whole-feature certifications.", "",
                  "| Surface | Features | Pass | Partial | Fail | Unverified | N/A |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for surface, items, _, case_counts, _ in summary:
        vals = {name: sum(case_counts[m][name] for m in MODES) for name in ("Pass", "Partial", "Fail", "Unverified", "N/A")}
        checklist.append(f"| {md(surface)} | {len(items)} | {vals['Pass']} | {vals['Partial']} | {vals['Fail']} | {vals['Unverified']} | {vals['N/A']} |")
    checklist += ["", "See [STATUS.md](STATUS.md) for case-level statuses, recorded evidence, linked defects, and surface details.", ""]
    (BASE / "CHECKLIST.md").write_text("\n".join(checklist))

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
