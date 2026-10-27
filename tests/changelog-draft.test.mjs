import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractScript, makeRepo, mockGithub, read, runScript } from './harness.mjs';

const script = extractScript('changelog-draft.yml', 'prepare');
const pullRequest = { number: 99, title: 'release 1.3.0', base: { ref: 'master' } };

const RST_CHANGELOG = '1.2.0 (01-06-2026)\n------------------\n\n- Vorige release (#1)\n';

// Issues covering every category, from the milestone, a PR's closing references and a branch name.
const github = () => mockGithub({
  milestones: [{ number: 5, title: '1.3.0', html_url: 'https://github.com/m/5' }],
  milestoneIssues: [
    { number: 10, title: 'API endpoint verwijderd', labels: [{ name: 'Breaking' }, { name: 'bug' }] },
    { number: 11, title: 'Fout bij opslaan', labels: [], type: { name: 'Bug' } },
    { number: 12, title: 'Nieuwe zoekfilter', labels: [], type: { name: 'Feature' } },
    { number: 13, title: 'Upgrade Python', labels: [], type: { name: 'Task' } },
    { number: 14, title: 'Docs bijwerken', labels: [], type: null },
    { number: 15, title: 'Zoeken op adres', labels: [{ name: 'enhancement' }] },
    { number: 30, title: 'A PR, not an issue', labels: [], pull_request: {} },
  ],
  mergedPrs: [
    {
      number: 40, title: 'Fix validatie', merged: true, baseRefName: 'develop', headRefName: 'bugfix/16_validatie',
      closingIssuesReferences: { nodes: [{
        number: 16, title: 'Validatie telefoonnummer', repository: { nameWithOwner: 'OnroerendErfgoed/demo' },
        labels: { nodes: [{ name: 'fix' }] }, issueType: null,
      }] },
    },
    {
      number: 41, title: 'Kaartlaag', merged: true, baseRefName: 'develop', headRefName: 'feature/17_kaartlaag',
      closingIssuesReferences: { nodes: [] },
    },
    {
      number: 42, title: 'Bump dependencies', merged: true, baseRefName: 'develop', headRefName: 'chore/deps',
      closingIssuesReferences: { nodes: [] },
    },
  ],
  issues: { 17: { number: 17, title: 'Kaartlaag toevoegen', labels: [], type: { name: 'Feature' } } },
});

const EXPECTED_SECTIONS = [
  '💥 Breaking changes',
  '',
  '- API endpoint verwijderd (#10)',
  '',
  '🐛 Bugs',
  '',
  '- Fout bij opslaan (#11)',
  '- Validatie telefoonnummer (#16)',
  '',
  '✨ Features',
  '',
  '- Nieuwe zoekfilter (#12)',
  '- Upgrade Python (#13)',
  '- Zoeken op adres (#15)',
  '- Kaartlaag toevoegen (#17)',
  '',
  '🧹 Other',
  '',
  '- Docs bijwerken (#14)',
].join('\n');

const DATE = /\d{2}-\d{2}-\d{4}/;

test('groups issues by category in an rst changelog and bumps the version', async () => {
  const dir = makeRepo({
    'CHANGES.rst': RST_CHANGELOG,
    'pyproject.toml': '[project]\nname = "demo"\nversion = "1.2.0"\n',
  });
  const { outputs, failures } = await runScript(script, { dir, github: github(), pullRequest });

  assert.deepEqual(failures, []);
  assert.equal(outputs.version, '1.3.0');
  assert.equal(outputs.changelog, EXPECTED_SECTIONS);
  const changelog = read(dir, 'CHANGES.rst').replace(DATE, 'DATE');
  assert.equal(changelog, `1.3.0 (DATE)\n------------------\n\n${EXPECTED_SECTIONS}\n\n${RST_CHANGELOG}`);
  assert.match(read(dir, 'pyproject.toml'), /version = "1\.3\.0"/);

  const comment = read(dir, 'release-comment.md');
  assert.match(comment, /🐛 Bugs/);
  assert.match(comment, /Bump dependencies \(#42\)/); // unlinked PR listed
});

test('finds a nested changelog and detects underline headings in a .md file', async () => {
  const dir = makeRepo({
    'proces/CHANGES.md': '3.8.0 (28-07-2026)\n------------------\n\n - Mail naar gemeente (#1309)\n',
    'proces/node_modules/x/CHANGELOG.md': '## 1.0.0\n',
    'roles/vendor.cron/CHANGELOG.md': '## 9.9.9\n',
  });
  const { failures } = await runScript(script, { dir, github: github(), pullRequest });

  assert.deepEqual(failures, []);
  const changelog = read(dir, 'proces/CHANGES.md');
  assert.match(changelog, /^1\.3\.0 \(\d{2}-\d{2}-\d{4}\)\n-{18}\n\n💥 Breaking changes\n/);
  assert.match(changelog, /\n3\.8\.0 \(28-07-2026\)\n/);
  assert.equal(read(dir, 'roles/vendor.cron/CHANGELOG.md'), '## 9.9.9\n');
});

test('uses markdown headings one level deeper for categories in a markdown changelog', async () => {
  const dir = makeRepo({ 'CHANGELOG.md': '# Changelog\n\n## 1.2.0 (01-06-2026)\n\n- Vorige release (#1)\n' });
  const { failures } = await runScript(script, { dir, github: github(), pullRequest });

  assert.deepEqual(failures, []);
  const changelog = read(dir, 'CHANGELOG.md');
  assert.match(changelog, /^# Changelog\n\n## 1\.3\.0 \(\d{2}-\d{2}-\d{4}\)\n\n### 💥 Breaking changes\n\n- API endpoint verwijderd \(#10\)\n\n### 🐛 Bugs\n/);
  assert.match(changelog, /- Docs bijwerken \(#14\)\n\n## 1\.2\.0/);
});

test('updates only the changelog given in changelog-path', async () => {
  const dir = makeRepo({ 'CHANGES.txt': RST_CHANGELOG, 'HISTORY.rst': RST_CHANGELOG });
  const { failures } = await runScript(script, {
    dir, github: github(), pullRequest, env: { CHANGELOG_PATH: 'HISTORY.rst' },
  });

  assert.deepEqual(failures, []);
  assert.match(read(dir, 'HISTORY.rst'), /^1\.3\.0/);
  assert.equal(read(dir, 'CHANGES.txt'), RST_CHANGELOG);
});

test('leaves the changelog alone when the version is already present', async () => {
  const existing = '1.3.0 (20-10-2026)\n------------------\n\n- Al klaar (#2)\n';
  const dir = makeRepo({ 'CHANGES.rst': existing });
  const { failures } = await runScript(script, { dir, github: github(), pullRequest });

  assert.deepEqual(failures, []);
  assert.equal(read(dir, 'CHANGES.rst'), existing);
});

test('fails when changelog-path points to a missing file', async () => {
  const dir = makeRepo({ 'CHANGES.rst': RST_CHANGELOG });
  const { failures } = await runScript(script, {
    dir, github: github(), pullRequest, env: { CHANGELOG_PATH: 'proces/CHANGES.rst' },
  });

  assert.deepEqual(failures, ['Changelog not found: proces/CHANGES.rst']);
});

// Sub-issues: #21 under the released #20; #22 and #23 (via #61) under the unreleased
// collection #60; #25 under #70 in another repository; #24 has no parent.
const subIssueGithub = (options = {}) => mockGithub({
  milestones: [{ number: 5, title: '1.3.0', html_url: 'https://github.com/m/5' }],
  milestoneIssues: [
    { number: 20, title: 'Nieuwe kaart', labels: [], type: { name: 'Feature' } },
    { number: 21, title: 'Kaart legende', labels: [], type: { name: 'Bug' } },
    { number: 22, title: 'Exporteer PDF', labels: [], type: { name: 'Task' } },
    { number: 23, title: 'Exporteer CSV', labels: [], type: null },
    { number: 24, title: 'Crash bij login', labels: [], type: { name: 'Bug' } },
    { number: 25, title: 'Subtaak elders', labels: [], type: null },
  ],
  issueNodes: {
    I20: { number: 20, title: 'Nieuwe kaart', type: 'Feature' },
    I21: { number: 21, title: 'Kaart legende', type: 'Bug', parent: 'I20' },
    I22: { number: 22, title: 'Exporteer PDF', type: 'Task', parent: 'I60' },
    I23: { number: 23, title: 'Exporteer CSV', parent: 'I61' },
    I25: { number: 25, title: 'Subtaak elders', parent: 'X70' },
    I60: { number: 60, title: 'Exports', type: 'Collection' },
    I61: { number: 61, title: 'Export deel', type: 'Task', parent: 'I60' },
    X70: { number: 70, title: 'Gedeelde login', type: 'Bug', repo: 'OnroerendErfgoed/other' },
  },
  ...options,
});

test('lists sub-issues under their top-level parent issue', async () => {
  const dir = makeRepo({ 'CHANGES.txt': RST_CHANGELOG });
  const { outputs, failures, warnings } = await runScript(script, { dir, github: subIssueGithub(), pullRequest });

  assert.deepEqual(failures, []);
  assert.deepEqual(warnings, []);
  const expected = [
    '🐛 Bugs',
    '',
    '- Crash bij login (#24)',
    '- Gedeelde login (OnroerendErfgoed/other#70)',
    '  - Subtaak elders (#25)',
    '',
    '✨ Features',
    '',
    '- Nieuwe kaart (#20)',
    '  - Kaart legende (#21)',
    '- Exports (#60)',
    '  - Exporteer PDF (#22)',
    '  - Exporteer CSV (#23)',
  ].join('\n');
  assert.equal(outputs.changelog, expected);
  assert.equal(read(dir, 'CHANGES.txt').replace(DATE, 'DATE'), `1.3.0 (DATE)\n------------------\n\n${expected}\n\n${RST_CHANGELOG}`);
  assert.match(read(dir, 'release-comment.md'), /- Exports \(#60\)\n {2}- Exporteer PDF \(#22\)/);
});

test('puts blank lines around sub-issue lists in an rst changelog', async () => {
  const dir = makeRepo({ 'CHANGES.rst': RST_CHANGELOG });
  const { failures } = await runScript(script, { dir, github: subIssueGithub(), pullRequest });

  assert.deepEqual(failures, []);
  const expected = [
    '🐛 Bugs',
    '',
    '- Crash bij login (#24)',
    '- Gedeelde login (OnroerendErfgoed/other#70)',
    '',
    '  - Subtaak elders (#25)',
    '',
    '✨ Features',
    '',
    '- Nieuwe kaart (#20)',
    '',
    '  - Kaart legende (#21)',
    '',
    '- Exports (#60)',
    '',
    '  - Exporteer PDF (#22)',
    '  - Exporteer CSV (#23)',
  ].join('\n');
  assert.equal(read(dir, 'CHANGES.rst').replace(DATE, 'DATE'), `1.3.0 (DATE)\n------------------\n\n${expected}\n\n${RST_CHANGELOG}`);
});

test('nests sub-issues under markdown category headings', async () => {
  const dir = makeRepo({ 'CHANGES.md': '## 1.2.0 (01-06-2026)\n\n- Vorige release (#1)\n' });
  const { failures } = await runScript(script, { dir, github: subIssueGithub(), pullRequest });

  assert.deepEqual(failures, []);
  assert.match(read(dir, 'CHANGES.md'), /### ✨ Features\n\n- Nieuwe kaart \(#20\)\n {2}- Kaart legende \(#21\)\n- Exports \(#60\)\n/);
});

test('lists sub-issues separately when the parent lookup fails', async () => {
  const dir = makeRepo({ 'CHANGES.txt': RST_CHANGELOG });
  const { outputs, failures, warnings } = await runScript(script, {
    dir, github: subIssueGithub({ parentLookupError: 'Resource not accessible' }), pullRequest,
  });

  assert.deepEqual(failures, []);
  assert.deepEqual(warnings, ['Could not look up parent issues, listing sub-issues separately: Resource not accessible']);
  assert.match(outputs.changelog, /🐛 Bugs\n\n- Kaart legende \(#21\)\n- Crash bij login \(#24\)\n/);
  assert.doesNotMatch(outputs.changelog, /Exports|^ {2}-/m);
});

test('fails for a PR title that is not "release x.y.z"', async () => {
  const dir = makeRepo({ 'CHANGES.rst': RST_CHANGELOG });
  const { failures } = await runScript(script, {
    dir, github: github(), pullRequest: { ...pullRequest, title: 'release candidate' },
  });

  assert.deepEqual(failures, ['PR title "release candidate" does not match "release x.y.z".']);
});
