import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractScript, makeRepo, mockGithub, read, runScript } from './harness.mjs';

const scoreScript = extractScript('dependency-track.yml', 'score');
const issuesScript = extractScript('dependency-track.yml', 'issues');
const sentryScript = extractScript('dependency-track.yml', 'sentry');
const frontendScript = extractScript('dependency-track.yml', 'frontend-sbom');

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

test('shows the calculation of every score in the job summary', async () => {
  const { summary } = await scored();
  assert.match(summary, /Risicoscore = Impact 5 \(max of ICR B\/I\/C\) × \(CVSS weight \+ exploitability \+ exposure 3\)/);
  assert.match(summary, /EPSS >= 0\.1: 2/);
  // GHSA-dddd: CVSS 5.3 -> 2, no EPSS -> 1.
  assert.match(summary, /\| 30 \| 5 × \(2 \+ 1 \+ 3\) \| Hoog \| `requests@2\.25\.0` \| GHSA-dddd-eeee-ffff \|/);
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
  assert.deepEqual(requestsIssue.labels, ['security', 'dependencies', 'backend']);
  assert.deepEqual(github.calls.createIssue[0].labels, ['security', 'dependencies', 'frontend']);
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
  const open = {
    number: 7, state: 'open', title: 'old', body: 'old\n<!-- dependency-track-library: pkg:pypi/requests -->',
    labels: [{ name: 'security' }, { name: 'dependencies' }, { name: 'wontfix-yet' }],
  };
  const { github, outputs } = await issues({ repoIssues: [open] });
  assert.equal(github.calls.updateIssue.length, 1);
  assert.equal(github.calls.updateIssue[0].issue_number, 7);
  assert.equal(github.calls.updateIssue[0].title, 'Update requests (Kritiek: 2 advisories)');
  assert.equal(github.calls.updateIssue[0].labels, undefined); // labels set by hand stay
  assert.deepEqual(github.calls.addLabels, [{ owner: 'OnroerendErfgoed', repo: 'demo', issue_number: 7, labels: ['backend'] }]);
  assert.ok(!github.calls.createIssue.some((i) => i.title.startsWith('Update requests')));
  assert.equal(outputs.updated, '7');
});

test('adds no labels an open issue already has', async () => {
  const open = {
    number: 7, state: 'open', body: '<!-- dependency-track-library: pkg:pypi/requests -->',
    labels: [{ name: 'security' }, { name: 'dependencies' }, { name: 'backend' }],
  };
  const { github } = await issues({ repoIssues: [open] });
  assert.deepEqual(github.calls.addLabels, []);
});

test('labels a library found in the backend and the frontend with both', async () => {
  const shared = component('lodash', '4.17.20', 'npm');
  const backend = [finding(shared, { source: 'GITHUB', vulnId: 'GHSA-xxxx-yyyy-zzzz', cvssV3BaseScore: 7.2 })];
  const frontend = [finding(shared, { source: 'GITHUB', vulnId: 'GHSA-xxxx-yyyy-zzzz', cvssV3BaseScore: 7.2 })];
  const dir = makeRepo({ 'dt-findings.json': findingsFile(backend, frontend) });
  await runScript(scoreScript, { dir, github: mockGithub(), env: SCORE_ENV });
  const github = mockGithub();
  await runScript(issuesScript, { dir, github, env: ISSUE_ENV });
  assert.equal(github.calls.createIssue.length, 1);
  assert.deepEqual(github.calls.createIssue[0].labels, ['security', 'dependencies', 'backend', 'frontend']);
  assert.match(github.calls.createIssue[0].body, /\| 4\.17\.20 \| backend \|[^\n]*\n\| 4\.17\.20 \| frontend \|/);
  // The same advisory in both projects counts once. CVSS 7.2 -> 3, no KEV/EPSS -> 1: 5 x 7 = 35.
  assert.equal(github.calls.createIssue[0].title, 'Update lodash (Hoog: 1 advisory)');
});

test('reopens an issue closed as not planned too: accepted risks are suppressed in Dependency-Track', async () => {
  const closed = { number: 8, state: 'closed', state_reason: 'not_planned', body: '<!-- dependency-track-library: pkg:npm/lodash -->' };
  const { github, outputs } = await issues({ repoIssues: [closed] });
  assert.deepEqual(github.calls.updateIssue.map((i) => [i.issue_number, i.state]), [[8, 'open']]);
  assert.match(github.calls.createComment[0].body, /add a vulnerability policy that suppresses these advisories/);
  assert.equal(outputs.reopened, '8');
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
  const { failures, github } = await issues({ existingLabels: ['security', 'dependencies', 'backend', 'frontend'] });
  assert.deepEqual(failures, []);
  assert.deepEqual(github.calls.createLabel.map((l) => l.name), ['security', 'dependencies', 'backend', 'frontend']);
  assert.equal(github.calls.createIssue.length, 3);
});

const SENTRY_ENV = {
  SENTRY_DSN: 'https://abc123@sentry.example.be/7',
  FAIL_LEVEL: 'Kritiek',
  TICKET_LABELS: 'security,dependencies',
  VERSION: '1.4.2',
  REPOSITORY: 'OnroerendErfgoed/demo',
  REF_NAME: 'master',
  REPO_URL: 'https://github.com/OnroerendErfgoed/demo',
  RUN_URL: 'https://github.com/o/r/actions/runs/1',
};

async function sentry(env = {}) {
  const { dir } = await scored();
  const result = await runScript(sentryScript, { dir, github: mockGithub(), env: { ...SENTRY_ENV, ...env } });
  const sent = result.outputs.send === 'true';
  return {
    ...result,
    url: sent ? read(dir, 'sentry.url') : null,
    envelope: sent ? read(dir, 'sentry.envelope').trimEnd().split('\n').map((line) => JSON.parse(line)) : null,
  };
}

test('builds one Sentry event per repository from the findings at fail-level', async () => {
  const { outputs, failures, url, envelope, secrets } = await sentry();
  assert.deepEqual(failures, []);
  assert.equal(outputs.send, 'true');
  assert.equal(url, 'https://sentry.example.be/api/7/envelope/?sentry_key=abc123&sentry_version=7');
  assert.deepEqual(secrets, ['abc123']);
  const [header, item, event] = envelope;
  assert.equal(header.event_id, event.event_id);
  assert.match(event.event_id, /^[0-9a-f]{32}$/);
  assert.deepEqual(item, { type: 'event' });
  assert.equal(event.level, 'fatal');
  assert.deepEqual(event.fingerprint, ['dependency-track', 'OnroerendErfgoed/demo']);
  assert.equal(event.message.formatted, 'OnroerendErfgoed/demo: Kritiek, Risicoscore 45 (2 findings in 2 libraries)');
  assert.equal(event.environment, 'master');
  assert.equal(event.release, '1.4.2');
  assert.deepEqual(event.tags, { repository: 'OnroerendErfgoed/demo', max_level: 'Kritiek', max_risk: '45', tier: 'backend,frontend' });
  assert.equal(event.contexts.dependency_track.issues,
    'https://github.com/OnroerendErfgoed/demo/issues?q=is%3Aissue%20is%3Aopen%20label%3Asecurity');
  assert.equal(event.contexts.dependency_track.dependency_track, 'https://dt/projects/p');
  assert.equal(event.extra.findings.length, 2);
  assert.match(event.extra.findings[0], /^45 Kritiek \S+ GHSA-/);
});

test('includes Hoog findings in the Sentry event when fail-level is Hoog', async () => {
  const { envelope } = await sentry({ FAIL_LEVEL: 'Hoog' });
  const event = envelope[2];
  assert.equal(event.level, 'fatal');
  assert.equal(event.extra.findings.length, 4);
  assert.equal(event.message.formatted, 'OnroerendErfgoed/demo: Kritiek, Risicoscore 45 (4 findings in 3 libraries)');
});

test('keeps a path prefix of the Sentry DSN', async () => {
  const { url } = await sentry({ SENTRY_DSN: 'https://k@sentry.example.be/sentry/12' });
  assert.equal(url, 'https://sentry.example.be/sentry/api/12/envelope/?sentry_key=k&sentry_version=7');
});

test('sends nothing without a DSN or without findings at fail-level', async () => {
  assert.equal((await sentry({ SENTRY_DSN: '' })).outputs.send, 'false');
  const { dir } = await scored({ 'dt-findings.json': findingsFile([BACKEND[4]], []) });
  const { outputs } = await runScript(sentryScript, { dir, github: mockGithub(), env: SENTRY_ENV });
  assert.equal(outputs.send, 'false');
});

test('rejects a malformed DSN without printing it', async () => {
  await assert.rejects(sentry({ SENTRY_DSN: 'https://sentry.example.be/7' }), /must look like https:\/\/<key>@<host>/);
  await assert.rejects(sentry({ SENTRY_DSN: 'abc123' }), (e) => e.message === 'sentry-dsn is not a URL');
});

async function frontendSbom(files, index) {
  const dir = makeRepo(files);
  // The index holds absolute paths, as the Frontend builds step writes them.
  fs.writeFileSync(`${dir}/frontends/index.tsv`, index.map(([d, source, file]) => `${d}\t${source}\t${dir}/${file}\n`).join(''));
  const result = await runScript(frontendScript, { dir, github: mockGithub(), env: { WORK: `${dir}/frontends`, VERSION: '1.4.2', PROJECT: 'demo' } });
  return { ...result, bom: JSON.parse(read(dir, 'frontend.bom.json')) };
}

test('combines the frontends into one SBOM: build packages and lockfile components', async () => {
  const { failures, bom } = await frontendSbom({
    'frontends/1.bundled.json': JSON.stringify([
      { name: 'vue', version: '3.5.39' },
      { name: '@OnroerendErfgoed/pyoes', version: '0.26.2' },
      { name: 'jquery', version: '2.2.4' },
    ]),
    'frontends/2.json': JSON.stringify({ components: [
      { name: 'jquery', version: '2.2.4', purl: 'pkg:npm/jquery@2.2.4' },
      { name: 'binding', group: '@aurelia', version: '1.0.0', purl: 'pkg:npm/%40aurelia/binding@1.0.0' },
      { name: 'requests', version: '2.0.0', purl: 'pkg:pypi/requests@2.0.0' },
      { name: 'no-purl', version: '1.0.0' },
    ] }),
  }, [
    ['frontend', 'bundle', 'frontends/1.bundled.json'],
    ['legacy/apps', 'lockfile', 'frontends/2.json'],
  ]);
  assert.deepEqual(failures, []);
  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.deepEqual(bom.metadata.component, { type: 'application', name: 'demo-frontend', version: '1.4.2' });
  assert.deepEqual(bom.components.map((c) => c.purl), [
    'pkg:npm/%40aurelia/binding@1.0.0',
    'pkg:npm/%40OnroerendErfgoed/pyoes@0.26.2',
    'pkg:npm/jquery@2.2.4',
    'pkg:npm/vue@3.5.39',
  ]);
  const pyoes = bom.components[1];
  assert.deepEqual(pyoes, { type: 'library', 'bom-ref': pyoes.purl, name: '@OnroerendErfgoed/pyoes', version: '0.26.2', purl: pyoes.purl });
  assert.equal(bom.components[0].name, '@aurelia/binding');
});
