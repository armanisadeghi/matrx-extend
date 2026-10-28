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


def _render_daily(daily, name='release-daily-20261027.json', extra=None, module=tracker):
    """Exercise the real selector and all three final surfaces on captured receipts."""
    original = module.BASE
    inventory, defects = tracker.read()
    with tempfile.TemporaryDirectory() as directory:
        module.BASE = Path(directory)
        reports = module.BASE / 'reports'
        reports.mkdir()
        for captured in ('store-release-followthrough-20261011.json', 'store577-submission-20261020.json'):
            (reports / captured).write_text((original / 'reports' / captured).read_text())
        (reports / name).write_text(json.dumps(daily))
        for filename, payload in (extra or {}).items():
            (reports / filename).write_text(json.dumps(payload))
        try:
            module.render(inventory, defects)
            return {filename: (module.BASE / filename).read_text()
                    for filename in ('STATUS.md', 'CHECKLIST.md', 'STATUS.html')}
        finally:
            module.BASE = original


def _captured_daily():
    return json.loads((tracker.BASE / 'reports/release-daily-20261027.json').read_text())


def _assert_daily_surfaces(outputs, daily, name='release-daily-20261027.json'):
    dashboard = daily['current_private_observation']
    for filename, output in outputs.items():
        plain = re.sub('<[^>]+>', '', html.unescape(output)).replace('**', '')
        section = plain.split('Current Store release observations', 1)[1].split('Historical audit checkpoint', 1)[0]
        assert dashboard['at_start'] in section and dashboard['at_end'] in section
        assert f"Published package {dashboard['published_version']}" in section
        assert f"Draft package {dashboard['draft_version']}" in section
        assert f"Published view: {dashboard['published_status']}" in section
        assert f"Draft view: {dashboard['draft_status']}" in section
        assert dashboard['pending_scope'] in section
        if dashboard['pending_version'] is not None:
            assert f"Pending package {dashboard['pending_version']}" in section
        else:
            assert 'Pending package None' not in section
            assert 'Pending package none' not in section
        assert 'current rendered listing unverified' in section
        assert 'mail absence does not establish pending state' in section
        assert 'reports/' + name in output
        assert 'Published package 0.2.205' not in section
        if filename == 'STATUS.html':
            assert f'<a href="reports/{name}">daily Store record</a>' in output


def test_completed_authenticated_daily_supersedes_captured_pending_submission():
    # Removing release-daily discovery must fail on the actual newer authenticated receipt.
    daily = _captured_daily()
    _assert_daily_surfaces(_render_daily(daily), daily)


def test_authenticated_daily_uses_observed_bracket_and_variable_dashboard_values():
    daily = _captured_daily()
    daily['at'] = '2026-10-19T01:00:00Z'  # Preflight/report times cannot rank private evidence.
    daily['completed_at'] = '2026-11-30T01:00:00Z'
    daily['last_authenticated_private_observation']['published_version'] = '0.2.205'
    current = daily['current_private_observation']
    current.update(published_version='0.3.12', draft_version='0.3.18',
                   overall_status='Pending review', draft_status='This draft is pending review.',
                   published_status='Published package remains available.', pending_version='0.3.18',
                   pending_scope='Pending review displayed in inspected primary views.')
    _assert_daily_surfaces(_render_daily(daily), daily)


def test_actual_observation_order_and_la_day_preserve_submission_utc_contract():
    daily = _captured_daily()
    current = daily['current_private_observation']
    # Equal instants with an explicit non-UTC offset stay valid for the LA filename day.
    current.update(at_start='2026-10-27T00:30:23.392-07:00', at_end='2026-10-27T00:30:33.363-07:00')
    _assert_daily_surfaces(_render_daily(daily), daily)
    # LA23:59 is the next UTC day and still belongs to this daily window.
    current.update(at_start='2026-10-28T06:59:58Z', at_end='2026-10-28T06:59:59Z')
    _assert_daily_surfaces(_render_daily(daily), daily)
    submission = json.loads((tracker.BASE / 'reports/store577-submission-20261020.json').read_text())
    submission['observed_at_utc'] = '2026-10-28T07:30:00Z'
    extra = {'store577-submission-20261028.json': submission}
    outputs = _render_daily(daily, extra=extra)
    for output in outputs.values():
        assert 'reports/store577-submission-20261028.json' in output
        assert '2026-10-28T07:30:00Z' in output
    newer = _captured_daily()
    newer['current_private_observation'].update(at_start='2026-10-28T08:00:00Z', at_end='2026-10-28T08:00:01Z')
    extra['release-daily-20261028.json'] = newer
    _assert_daily_surfaces(_render_daily(daily, extra=extra), newer, 'release-daily-20261028.json')


def test_incomplete_or_foreign_daily_never_overwrites_valid_private_evidence():
    mutations = [
        {'schema': True}, {'schema': 99}, {'status': 'UI_RUNNING'},
        {'current_private_observation': None}, {'current_private_observation': []},
    ]
    dashboard_mutations = [
        {'item_id': 'unknown-item'}, {'published_version': None}, {'draft_version': 'not-semver'},
        {'published_version': 577}, {'overall_status': []}, {'draft_status': ''},
        {'published_status': False}, {'pending_scope': None}, {'pending_version': False},
        {'at_start': '2026-10-27T07:30:34Z'}, {'at_end': '2026-10-27T07:30:22Z'},
        {'at_start': '2026-10-27T07:30:23'}, {'at_end': '2026-10-27T07:30:33'},
        {'at_end': 'invalid'}, {'at_end': '2026-10-28T07:00:00Z'},
    ]
    for mutation in mutations:
        daily = _captured_daily()
        daily.update(mutation)
        for output in _render_daily(daily).values():
            assert 'reports/store577-submission-20261020.json' in output
            assert 'reports/release-daily-20261027.json' not in output
    for mutation in dashboard_mutations:
        daily = _captured_daily()
        daily['current_private_observation'].update(mutation)
        for output in _render_daily(daily).values():
            assert 'reports/store577-submission-20261020.json' in output
            assert 'reports/release-daily-20261027.json' not in output
    for missing in ('at_end', 'pending_version', 'pending_scope'):
        daily = _captured_daily()
        del daily['current_private_observation'][missing]
        for output in _render_daily(daily).values():
            assert 'reports/store577-submission-20261020.json' in output


def test_daily_guards_catch_in_memory_omission_and_constant_result_mutants():
    import types
    source_path = Path(__file__).with_name('generate-stabilization-tracker.py')
    source = source_path.read_text()
    needle = 'glob("release-daily-????????.json")'
    assert source.count(needle) == 1
    omitted = types.ModuleType('omitted_daily_reader')
    omitted.__file__ = str(source_path)
    exec(compile(source.replace(needle, 'glob("omitted-daily-????????.json")'), str(source_path), 'exec'), omitted.__dict__)
    daily = _captured_daily()
    try:
        _assert_daily_surfaces(_render_daily(daily, module=omitted), daily)
    except AssertionError:
        pass
    else:
        raise AssertionError('Daily omission mutation escaped the captured-receipt guard')
    # Correct first payload cannot mask a fixed-version answer on the second payload.
    constant = types.ModuleType('constant_daily_reader')
    constant.__file__ = str(source_path)
    exec(compile(source, str(source_path), 'exec'), constant.__dict__)
    original_base = constant.BASE
    with tempfile.TemporaryDirectory() as directory:
        constant.BASE = Path(directory)
        (constant.BASE / 'reports').mkdir()
        (constant.BASE / 'reports/release-daily-20261027.json').write_text(json.dumps(daily))
        fixed_lines = constant.current_store_release_lines()
    constant.BASE = original_base
    constant.current_store_release_lines = lambda: fixed_lines
    alternate = _captured_daily()
    alternate['current_private_observation'].update(published_version='0.3.12', draft_version='0.3.18')
    try:
        _assert_daily_surfaces(_render_daily(alternate, module=constant), alternate)
    except AssertionError:
        pass
    else:
        raise AssertionError('Constant-result mutation escaped the alternate-payload guard')


def test_direct_ci_python_invocation_propagates_seeded_assertion_failure():
    import subprocess
    import sys
    # Scratch-only seed uses the same direct script entry point. Remove other test
    # functions at runtime so this does not recursively execute or repeat the suite.
    script = Path(__file__).read_text()
    marker = "if __name__ " + "== '__main__':"
    assert script.count(marker) == 1
    seed = """for _name in list(globals()):
    if _name.startswith('test_'):
        del globals()[_name]
def test_seeded_assertion_failure():
    raise AssertionError('seeded direct-CI failure')

"""
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        target = root / Path(__file__).name
        target.write_text(script.replace(marker, seed + marker))
        (root / 'generate-stabilization-tracker.py').write_text(Path(__file__).with_name('generate-stabilization-tracker.py').read_text())
        result = subprocess.run([sys.executable, str(target)], text=True, capture_output=True, check=False)
    output = result.stdout + result.stderr
    assert result.returncode == 1, output
    assert 'seeded direct-CI failure' in output, output
    assert 'Ran 1 test' in output and 'FAILED (failures=1)' in output, output


if __name__ == '__main__':
    import sys
    import unittest
    tests = [unittest.FunctionTestCase(value) for name, value in sorted(globals().items())
             if name.startswith('test_') and callable(value)]
    result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(tests))
    sys.exit(0 if result.wasSuccessful() else 1)
