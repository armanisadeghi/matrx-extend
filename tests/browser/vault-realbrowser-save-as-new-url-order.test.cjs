'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runner = fs.readFileSync(path.join(__dirname, 'vault-realbrowser-acceptance.cjs'), 'utf8');
const retarget = runner.indexOf("label: 'real_site_fixture_destination'");
const realSiteEvidence = runner.indexOf("'real_site_fill_evidence_unverified'");
const restore = runner.indexOf("label: 'real_site_fixture_destination_restore'");
const saveAsNew = runner.indexOf("checkpoint('save_as_new')");

assert(retarget >= 0, 'real-site fixture retarget missing');
assert(realSiteEvidence > retarget, 'real-site assertions must follow retarget');
assert(restore > realSiteEvidence, 'localhost restoration must follow real-site assertions');
assert(saveAsNew > restore, 'Save as New must follow localhost restoration');
const restoreSlice = runner.slice(restore - 700, restore + 440);
assert.match(restoreSlice, /for \(const fixtureId of \[targetId, \.\.\.otherIds\]\)/);
assert.match(restoreSlice, /body: JSON\.stringify\(\{ login_urls: \[localUrl\] \}\)/);
assert.match(restoreSlice, /restored\?\.id === fixtureId/);
assert.match(restoreSlice, /real_site_fixture_destination_restore_mismatch/);

process.stdout.write('PASS: receipt-owned fixture URLs return to localhost before Save as New\n');
