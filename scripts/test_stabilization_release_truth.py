"""Guard: a frozen coverage audit must never overwrite newer Store observations."""
import importlib.util
import json
import html
import re
from pathlib import Path
import tempfile

spec = importlib.util.spec_from_file_location('tracker', Path(__file__).with_name('generate-stabilization-tracker.py'))
tracker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tracker)


def test_generated_release_uses_latest_valid_daily_observation():
    inventory, defects = tracker.read()
    original = tracker.BASE
    with tempfile.TemporaryDirectory() as directory:
        tracker.BASE = Path(directory)
        reports = tracker.BASE / 'reports'
        reports.mkdir()
        for name in ('coverage-audit-20261001.json', 'store-release-followthrough-20261010.json', 'store-release-followthrough-20261011.json'):
            (reports / name).write_text((original / 'reports' / name).read_text())
        (reports / 'store-release-followthrough-20261012.json').write_text('{invalid')
        invalid = json.loads((reports / 'store-release-followthrough-20261011.json').read_text())
        invalid['observed_at'] = '2026-10-13T17:25:49Z'
        invalid['private_status'] = []
        (reports / 'store-release-followthrough-20261013.json').write_text(json.dumps(invalid))
        try:
            tracker.render(inventory, defects)
            for name in ('STATUS.md', 'CHECKLIST.md', 'STATUS.html'):
                output = (tracker.BASE / name).read_text()
                assert 'Public listing: 0.2.205' in re.sub('<[^>]+>', '', html.unescape(output)).replace('**', '')
                assert '2026-10-11T17:25:49Z' in output
                assert 'Pending review; Draft package 0.2.479' in output
                if name != 'STATUS.html':
                    assert 'Historical audit checkpoint' in output
                assert 'Public listing does not establish private review state' in output
            # Alternate package observations must reach every view, defeating a fixed version answer.
            alternate = json.loads((reports / 'store-release-followthrough-20261011.json').read_text())
            alternate['public_listing']['rendered_details_version'] = '0.3.12'
            alternate['private_status']['authenticated_dashboard_observation'] = 'Pending review; Draft package 0.3.18; Published package 0.3.12'
            (reports / 'store-release-followthrough-20261011.json').write_text(json.dumps(alternate))
            tracker.render(inventory, defects)
            for name in ('STATUS.md', 'CHECKLIST.md', 'STATUS.html'):
                output = (tracker.BASE / name).read_text()
                assert 'Public listing: 0.3.12' in re.sub('<[^>]+>', '', html.unescape(output)).replace('**', '')
                assert 'Draft package 0.3.18' in output
                assert 'reports/store-release-followthrough-20261011.json' in output
            (reports / 'store-release-followthrough-20261011.json').unlink()
            tracker.render(inventory, defects)
            for name in ('STATUS.md', 'CHECKLIST.md', 'STATUS.html'):
                output = (tracker.BASE / name).read_text()
                assert '2026-10-10T21:52:53Z' in output
                assert '2026-10-10T20:22:00Z' in output
                assert 'current dashboard unavailable' in output
            for path in reports.glob('store-release-followthrough*'):
                path.unlink()
            tracker.render(inventory, defects)
            for name in ('STATUS.md', 'CHECKLIST.md', 'STATUS.html'):
                assert 'No valid dated daily Store record' in (tracker.BASE / name).read_text()
        finally:
            tracker.BASE = original


def test_authenticated_submission_supersedes_older_daily_without_inventing_public_listing():
    inventory, defects = tracker.read()
    original = tracker.BASE
    with tempfile.TemporaryDirectory() as directory:
        tracker.BASE = Path(directory)
        reports = tracker.BASE / 'reports'
        reports.mkdir()
        old = original / 'reports/store-release-followthrough-20261011.json'
        receipt = original / 'reports/store577-submission-20261020.json'
        (reports / old.name).write_text(old.read_text())
        (reports / receipt.name).write_text(receipt.read_text())
        try:
            tracker.render(inventory, defects)
            for name in ('STATUS.md', 'CHECKLIST.md', 'STATUS.html'):
                output = (tracker.BASE / name).read_text()
                plain = re.sub('<[^>]+>', '', html.unescape(output)).replace('**', '')
                assert '2026-10-20T15:26:38Z' in plain
                assert 'Pending review' in plain and '0.2.577' in plain
                assert 'Published package 0.2.205' in plain
                assert 'reports/store577-submission-20261020.json' in output
                assert 'Public listing: 0.2.205' not in plain
                assert '0.2.479' not in plain.split('Current Store release observations', 1)[1].split('\n## ', 1)[0]

            # A later dated daily observation wins over the submission.
            future = json.loads(old.read_text())
            future['observed_at'] = '2026-10-21T17:25:49Z'
            future['public_listing']['rendered_details_version'] = '0.2.578'
            future['private_status']['authenticated_dashboard_observation'] = 'Published package 0.2.578; no pending revision'
            (reports / 'store-release-followthrough-20261021.json').write_text(json.dumps(future))
            tracker.render(inventory, defects)
            for name in ('STATUS.md', 'CHECKLIST.md', 'STATUS.html'):
                output = (tracker.BASE / name).read_text()
                assert '2026-10-21T17:25:49Z' in output
                assert '0.2.578' in output

            (reports / 'store-release-followthrough-20261021.json').unlink()
            for mutation in (
                {'dashboard_submission': {'final_status': 'Unknown'}},
                {'candidate': {'version': '0.2.579'}},
                {'observed_at_utc': '2026-10-21T15:26:38Z'},
                {'primary_item_id': 'unknown-item'},
                {'schema': 99},
            ):
                bad = json.loads(receipt.read_text())
                bad.update(mutation)
                (reports / receipt.name).write_text(json.dumps(bad))
                tracker.render(inventory, defects)
                for name in ('STATUS.md', 'CHECKLIST.md', 'STATUS.html'):
                    output = (tracker.BASE / name).read_text()
                    assert '2026-10-11T17:25:49Z' in output
                    assert 'reports/store577-submission-20261020.json' not in output
            (reports / receipt.name).write_text('{malformed')
            tracker.render(inventory, defects)
            assert '2026-10-11T17:25:49Z' in (tracker.BASE / 'STATUS.md').read_text()
        finally:
            tracker.BASE = original
