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
