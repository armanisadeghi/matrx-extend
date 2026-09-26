'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const adapter = path.join(__dirname, 'cleanup-vault-canary.py');
const python = '/Users/armanisadeghi/code/aidream/.venv/bin/python';
const harness = String.raw`
import asyncio
import contextlib
import importlib.util
import io
import json
import sys

spec = importlib.util.spec_from_file_location('cleanup_vault_canary', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
item_id = '11111111-1111-4111-8111-111111111111'
data = {
    'token': 'x' * 20,
    'userId': '22222222-2222-4222-8222-222222222222',
    'organizationId': '33333333-3333-4333-8333-333333333333',
    'createKeys': ['create-key'],
    'baselineIds': [],
    'provenIDs': [item_id],
}

async def identity_ok(token, user_id):
    return None

async def reconciler(user_id, organization_id, create_keys):
    return [{'result_item_id': item_id}]

def run_main(build_error=None, identity_error=None):
    module.parse_stdin = lambda: dict(data)
    module.verify_sources = lambda _: {}
    module.load_reconciler = lambda: reconciler
    module.verify_identity = identity_ok if identity_error is None else identity_error
    if build_error is None:
        module.build_local_app = lambda _: None
    else:
        def fail_build(_):
            raise build_error
        module.build_local_app = fail_build
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        module.main()
    return json.loads(output.getvalue())

bootstrap_type_error = run_main(build_error=TypeError('bootstrap'))
assert bootstrap_type_error == {
    'ok': False,
    'code': 'internal_refused',
    'errorType': 'TypeError',
    'stage': 'build_local_app_bootstrap',
}
other_bootstrap_error = run_main(build_error=RuntimeError('bootstrap'))
assert other_bootstrap_error == {
    'ok': False,
    'code': 'internal_refused',
    'errorType': 'RuntimeError',
}
async def fail_identity(token, user_id):
    raise TypeError('identity')
non_bootstrap_type_error = run_main(identity_error=fail_identity)
assert non_bootstrap_type_error == {
    'ok': False,
    'code': 'internal_refused',
    'errorType': 'TypeError',
}
`;

const result = spawnSync(python, ['-c', harness, adapter], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr || result.stdout);
process.stdout.write('PASS: only build_local_app TypeError emits the distributed-fallback stage\n');
