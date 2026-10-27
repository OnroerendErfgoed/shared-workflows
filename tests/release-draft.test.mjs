import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractScript, makeRepo, mockGithub, runScript } from './harness.mjs';

const script = extractScript('release-draft.yml', 'release');
const pullRequest = { number: 99, title: 'release 1.3.0', merge_commit_sha: 'abc123' };

const CHANGELOG = [
  '1.3.0 (26-10-2026)',
  '------------------',
  '',
  '💥 Breaking changes',
  '',
  '- API endpoint verwijderd (#10)',
  '',
  '🐛 Bugs',
  '',
  '- Fout bij opslaan (#11)',
  '',
  '1.2.0 (01-06-2026)',
  '------------------',
  '',
  '- Vorige release (#1)',
  '',
].join('\n');

test('creates a draft release from a nested changelog with category headings', async () => {
  const dir = makeRepo({ 'proces/CHANGES.rst': CHANGELOG });
  const github = mockGithub();
  const { outputs, failures } = await runScript(script, { dir, github, pullRequest });

  assert.deepEqual(failures, []);
  assert.equal(github.calls.createRelease.length, 1);
  const release = github.calls.createRelease[0];
  assert.equal(release.tag_name, '1.3.0');
  assert.equal(release.draft, true);
  assert.equal(release.prerelease, false);
  assert.equal(release.target_commitish, 'abc123');
  assert.equal(release.body, [
    '### 💥 Breaking changes',
    '',
    '- API endpoint verwijderd (#10)',
    '',
    '### 🐛 Bugs',
    '',
    '- Fout bij opslaan (#11)',
  ].join('\n'));
  assert.deepEqual(outputs, {
    version: '1.3.0',
    tag_name: '1.3.0',
    html_url: 'https://github.com/o/r/releases/tag/1.3.0',
  });
});

test('takes the version from the changelog when the PR title has none, and applies tag-prefix', async () => {
  const dir = makeRepo({ 'CHANGES.rst': CHANGELOG });
  const github = mockGithub();
  const { outputs, failures } = await runScript(script, {
    dir, github, pullRequest: { ...pullRequest, title: 'Merge develop' }, env: { TAG_PREFIX: 'v', PRERELEASE: 'true' },
  });

  assert.deepEqual(failures, []);
  assert.equal(outputs.tag_name, 'v1.3.0');
  assert.equal(github.calls.createRelease[0].prerelease, true);
});

test('updates an existing draft release', async () => {
  const dir = makeRepo({ 'CHANGES.rst': CHANGELOG });
  const github = mockGithub({ releases: [{ id: 7, tag_name: '1.3.0', draft: true }] });
  const { failures } = await runScript(script, { dir, github, pullRequest });

  assert.deepEqual(failures, []);
  assert.equal(github.calls.updateRelease[0].release_id, 7);
  assert.equal(github.calls.createRelease.length, 0);
});

test('fails when the release is already published', async () => {
  const dir = makeRepo({ 'CHANGES.rst': CHANGELOG });
  const github = mockGithub({ releases: [{ id: 7, tag_name: '1.3.0', draft: false, html_url: 'https://x' }] });
  const { failures } = await runScript(script, { dir, github, pullRequest });

  assert.deepEqual(failures, ['Release 1.3.0 is already published: https://x']);
});

test('keeps markdown category headings as they are', async () => {
  const dir = makeRepo({ 'CHANGES.md': '## 1.3.0 (26-10-2026)\n\n### 🐛 Bugs\n\n- Fout (#11)\n\n## 1.2.0 (01-06-2026)\n' });
  const github = mockGithub();
  const { failures } = await runScript(script, { dir, github, pullRequest });

  assert.deepEqual(failures, []);
  assert.equal(github.calls.createRelease[0].body, '### 🐛 Bugs\n\n- Fout (#11)');
});

test('keeps sub-issues nested under their parent issue', async () => {
  const section = '✨ Features\n\n- Exports (#60)\n\n  - Exporteer PDF (#22)\n  - Exporteer CSV (#23)\n\n- Nieuwe kaart (#61)';
  const dir = makeRepo({ 'CHANGES.rst': `1.3.0 (26-10-2026)\n------------------\n\n${section}\n` });
  const github = mockGithub();
  const { failures } = await runScript(script, { dir, github, pullRequest });

  assert.deepEqual(failures, []);
  assert.equal(github.calls.createRelease[0].body, `### ${section}`);
});
