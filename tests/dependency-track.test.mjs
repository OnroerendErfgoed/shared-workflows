import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractScript, makeRepo, mockGithub, read, runScript } from './harness.mjs';

const scoreScript = extractScript('dependency-track.yml', 'score');
const issuesScript = extractScript('dependency-track.yml', 'issues');

// Impact 5, exposure 3: Risicoscore = 5 x (CVSS weight + exploitability + 3).
const SCORE_ENV = { ICR_B: '5', ICR_I: '2', ICR_C: '1', EXPOSURE: '3', EPSS_THRESHOLD: '0.1' };
const ISSUE_ENV = {
  TICKET_LEVEL: 'Hoog',
  TICKET_LABELS: 'security,dependencies',
  RUN_URL: 'https://github.com/o/r/actions/runs/1',
  REF_NAME: 'master',
  IS_PR: 'false',
};

const component = (name, version, type = 'pypi') => ({ name, version, purl: `pkg:${type}/${name}@${version}` });
const finding = (comp, vulnerability) => ({ component: comp, vulnerability: { severityRank: 2, severity: 'MEDIUM', ...vulnerability } });

const requests = component('requests', '2.25.0');
const jinja2 = component('jinja2', '2.11.0');
const lodash = component('lodash', '4.17.20', 'npm');

// One issue in three sources (GitHub, OSV referencing the GHSA, NVD aliased by the GHSA), plus
// a second, unrelated advisory for the same component.
const BACKEND = [
  finding(requests, { source: 'GITHUB', vulnId: 'GHSA-aaaa-bbbb-cccc', aliases: [{ cveId: 'CVE-2024-1111' }], cvssV3BaseScore: 7.5, severityRank: 1, severity: 'HIGH' }),
  finding(requests, { source: 'OSV', vulnId: 'PYSEC-2024-1', references: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', epssScore: 0.3 }),
  finding(requests, { source: 'NVD', vulnId: 'CVE-2024-1111', cvssV3BaseScore: 9.1, severityRank: 0, severity: 'CRITICAL' }),
  finding(requests, { source: 'GITHUB', vulnId: 'GHSA-dddd-eeee-ffff', cvssV3BaseScore: 5.3 }),
  finding(jinja2, { source: 'GITHUB', vulnId: 'GHSA-1111-2222-3333', cvssV3BaseScore: 3.1, severityRank: 3, severity: 'LOW' }),
];
const FRONTEND = [
  finding(lodash, { source: 'GITHUB', vulnId: 'GHSA-xxxx-yyyy-zzzz', cvssV3BaseScore: 7.2, isKev: true }),
];

const findingsFile = (backend = BACKEND, frontend = FRONTEND) => JSON.stringify({
  parentUrl: 'https://dt/projects/p',
  projects: [
    { label: 'backend', name: 'demo-backend', version: '1.0.0', url: 'https://dt/projects/b', findings: backend },
    { label: 'frontend', name: 'demo-frontend', version: '1.0.0', url: 'https://dt/projects/f', findings: frontend },
  ],
});

async function scored(files = { 'dt-findings.json': findingsFile() }, env = SCORE_ENV) {
  const dir = makeRepo(files);
  const result = await runScript(scoreScript, { dir, github: mockGithub(), env });
  return { dir, ...result, data: JSON.parse(read(dir, 'dt-scored.json')) };
}

test('merges the GHSA, PYSEC and CVE records of one issue and scores it', async () => {
  const { data, outputs, failures } = await scored();
  assert.deepEqual(failures, []);
  const merged = data.findings.find((f) => f.ids.includes('GHSA-aaaa-bbbb-cccc'));
  assert.deepEqual(merged.ids, ['GHSA-aaaa-bbbb-cccc', 'CVE-2024-1111', 'PYSEC-2024-1']);
  assert.deepEqual(merged.sources, ['GITHUB', 'NVD', 'OSV']);
  assert.equal(merged.severity, 'CRITICAL');
  assert.equal(merged.cvss, 9.1);
  assert.equal(merged.epss, 0.3);
  // CVSS 9.1 -> 4, EPSS 0.3 >= 0.1 -> 2, exposure 3, impact max(5, 2, 1) = 5.
  assert.equal(merged.risk, 45);
  assert.equal(merged.level, 'Kritiek');
  assert.equal(data.findings.length, 4);
  assert.equal(outputs['max-risk'], '45');
  assert.equal(outputs['max-level'], 'Kritiek');
});

test('applies the CVSS, KEV and EPSS weights and the level boundaries', async () => {
  const { data } = await scored();
  const byId = Object.fromEntries(data.findings.map((f) => [f.ids[0], f]));
  // KEV -> 3, CVSS 7.2 -> 3: 5 x (3 + 3 + 3) = 45.
  assert.equal(byId['GHSA-xxxx-yyyy-zzzz'].risk, 45);
  assert.equal(byId['GHSA-xxxx-yyyy-zzzz'].project, 'frontend');
  // CVSS 5.3 -> 2, no EPSS -> 1: 5 x 6 = 30.
  assert.equal(byId['GHSA-dddd-eeee-ffff'].risk, 30);
  assert.equal(byId['GHSA-dddd-eeee-ffff'].level, 'Hoog');
  // CVSS 3.1 -> 1: 5 x 5 = 25.
  assert.equal(byId['GHSA-1111-2222-3333'].level, 'Hoog');
  assert.deepEqual(data.findings.map((f) => f.risk), [45, 45, 30, 25]);
});

test('uses the severity when there is no CVSS score, and 4 when that is unknown too', async () => {
  const backend = [
    finding(requests, { source: 'GITHUB', vulnId: 'GHSA-low0-0000-0000', severity: 'LOW', severityRank: 3 }),
    finding(jinja2, { source: 'OSV', vulnId: 'PYSEC-0000-1', severity: null, severityRank: null }),
  ];
  const { data } = await scored({ 'dt-findings.json': findingsFile(backend, []) },
    { ...SCORE_ENV, ICR_B: '1', EXPOSURE: '1' });
  assert.deepEqual(data.findings.map((f) => [f.ids[0], f.wCvss, f.risk, f.level]),
    [['PYSEC-0000-1', 4, 12, 'Laag-middel'], ['GHSA-low0-0000-0000', 1, 6, 'Laag-middel']]);
});

test('does not merge an OSV record that references several GHSAs', async () => {
  const backend = [
    finding(requests, { source: 'GITHUB', vulnId: 'GHSA-aaaa-bbbb-cccc' }),
    finding(requests, { source: 'OSV', vulnId: 'PYSEC-2024-9', references: 'GHSA-aaaa-bbbb-cccc GHSA-dddd-eeee-ffff' }),
  ];
  const { data } = await scored({ 'dt-findings.json': findingsFile(backend, []) });
  assert.equal(data.findings.length, 2);
});

test('reports no findings as risk 0, level none', async () => {
  const { outputs, summary } = await scored({ 'dt-findings.json': findingsFile([], []) });
  assert.equal(outputs['max-risk'], '0');
  assert.equal(outputs['max-level'], 'none');
  assert.match(summary, /0 findings/);
});

test('rejects ICR and exposure values out of range', async () => {
  await assert.rejects(scored(undefined, { ...SCORE_ENV, ICR_C: '6' }), /ICR_C must be an integer 1-5/);
  await assert.rejects(scored(undefined, { ...SCORE_ENV, EXPOSURE: '0' }), /EXPOSURE must be an integer 1-3/);
});

async function issues({ repoIssues = [], env = {}, existingLabels = [] } = {}) {
  const { dir } = await scored();
  const github = mockGithub({ repoIssues, existingLabels });
  const result = await runScript(issuesScript, { dir, github, env: { ...ISSUE_ENV, ...env } });
  return { github, ...result };
}

test('creates one issue per library with all its advisories', async () => {
  const { github, failures, outputs } = await issues();
  assert.deepEqual(failures, []);
  // Highest risk first, then by name; requests has two advisories, jinja2 is Hoog.
  assert.deepEqual(github.calls.createIssue.map((i) => i.title), [
    'Update lodash (Kritiek: 1 advisory)',
    'Update requests (Kritiek: 2 advisories)',
    'Update jinja2 (Hoog: 1 advisory)',
  ]);
  const requestsIssue = github.calls.createIssue[1];
  assert.deepEqual(requestsIssue.labels, ['security', 'dependencies']);
  assert.match(requestsIssue.body, /<!-- dependency-track-library: pkg:pypi\/requests -->/);
  assert.match(requestsIssue.body, /\[GHSA-aaaa-bbbb-cccc\]\(https:\/\/github.com\/advisories\/GHSA-aaaa-bbbb-cccc\) = \[CVE-2024-1111\]/);
  assert.match(requestsIssue.body, /GHSA-dddd-eeee-ffff/);
  assert.match(requestsIssue.body, /\| 2\.25\.0 \| backend \|/);
  assert.equal(outputs.created, '100,101,102');
  assert.deepEqual(github.calls.listForRepo[0], { owner: 'OnroerendErfgoed', repo: 'demo', state: 'all', labels: 'security', per_page: 100 });
});

test('only creates issues from ticket-level', async () => {
  const { github } = await issues({ env: { TICKET_LEVEL: 'Kritiek' } });
  assert.deepEqual(github.calls.createIssue.map((i) => i.title.split(' (')[0]), ['Update lodash', 'Update requests']);
});

test('updates the open issue of a library instead of creating a second one', async () => {
  const open = { number: 7, state: 'open', title: 'old', body: 'old\n<!-- dependency-track-library: pkg:pypi/requests -->' };
  const { github, outputs } = await issues({ repoIssues: [open] });
  assert.equal(github.calls.updateIssue.length, 1);
  assert.equal(github.calls.updateIssue[0].issue_number, 7);
  assert.equal(github.calls.updateIssue[0].title, 'Update requests (Kritiek: 2 advisories)');
  assert.ok(!github.calls.createIssue.some((i) => i.title.startsWith('Update requests')));
  assert.equal(outputs.updated, '7');
});

test('leaves an issue closed as not planned alone', async () => {
  const closed = { number: 8, state: 'closed', state_reason: 'not_planned', body: '<!-- dependency-track-library: pkg:npm/lodash -->' };
  const { github } = await issues({ repoIssues: [closed] });
  assert.equal(github.calls.updateIssue.length, 0);
  assert.ok(!github.calls.createIssue.some((i) => i.title.startsWith('Update lodash')));
});

test('reopens a completed issue on a scheduled run, but not on a pull request', async () => {
  const closed = { number: 9, state: 'closed', state_reason: 'completed', body: '<!-- dependency-track-library: pkg:npm/lodash -->' };
  const nightly = await issues({ repoIssues: [closed] });
  assert.deepEqual(nightly.github.calls.updateIssue.map((i) => [i.issue_number, i.state]), [[9, 'open']]);
  assert.match(nightly.github.calls.createComment[0].body, /Reopened: still vulnerable on master/);
  assert.equal(nightly.outputs.reopened, '9');

  const pr = await issues({ repoIssues: [closed], env: { IS_PR: 'true', REF_NAME: 'PR #5' } });
  assert.equal(pr.github.calls.updateIssue.length, 0);
  assert.ok(!pr.github.calls.createIssue.some((i) => i.title.startsWith('Update lodash')));
});

test('accepts labels that already exist', async () => {
  const { failures, github } = await issues({ existingLabels: ['security', 'dependencies'] });
  assert.deepEqual(failures, []);
  assert.equal(github.calls.createLabel.length, 2);
  assert.equal(github.calls.createIssue.length, 3);
});
