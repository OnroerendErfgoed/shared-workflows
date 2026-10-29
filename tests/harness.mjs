// Runs the inline actions/github-script code of a workflow step against a temporary
// git repository and a mocked GitHub API, so the scripts can be tested without GitHub.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

// Returns the `script: |` block of the step with the given id, dedented.
export function extractScript(workflow, stepId) {
  const lines = fs.readFileSync(path.join(root, '.github/workflows', workflow), 'utf8').split('\n');
  const idLine = lines.findIndex((l) => l.trim() === `id: ${stepId}`);
  if (idLine < 0) throw new Error(`No step with id ${stepId} in ${workflow}`);
  const scriptLine = lines.findIndex((l, i) => i > idLine && l.trim() === 'script: |');
  const keyIndent = lines[scriptLine].search(/\S/);
  const body = [];
  for (const line of lines.slice(scriptLine + 1)) {
    if (line.trim() && line.search(/\S/) <= keyIndent) break;
    body.push(line);
  }
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
  return body.map((l) => l.slice(indent)).join('\n');
}

// Creates a git repository with the given files ({ 'path/name': 'content' }).
export function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-workflows-test-'));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

export const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');

// Minimal GitHub API mock. Paginated endpoints return arrays, direct calls return { data }.
// issueNodes describes the sub-issue tree for GraphQL:
// { id: { number, title, repo?, type?, labels?, parent?: id } }. Issues of the demo repo
// that are not in it have no parent. parentLookupError makes the parent queries fail.
// repoIssues are listed by listForRepo calls without a milestone; existingLabels make
// createLabel answer 422.
export function mockGithub({
  milestones = [], milestoneIssues = [], mergedPrs = [], issues = {}, releases = [], issueNodes = {}, parentLookupError,
  repoIssues = [], existingLabels = [],
} = {}) {
  const calls = {
    createRelease: [], updateRelease: [], createIssue: [], updateIssue: [], createComment: [], createLabel: [], listForRepo: [],
  };
  let nextIssue = 100;
  const toNode = (id) => {
    const node = issueNodes[id];
    return {
      id,
      number: node.number,
      title: node.title,
      repository: { nameWithOwner: node.repo || 'OnroerendErfgoed/demo' },
      labels: { nodes: (node.labels || []).map((name) => ({ name })) },
      issueType: node.type ? { name: node.type } : null,
    };
  };
  const withParent = (id) => {
    const parent = issueNodes[id] && issueNodes[id].parent;
    return { id, parent: parent ? toNode(parent) : null };
  };
  const idOf = (number) => Object.keys(issueNodes).find(
    (id) => issueNodes[id].number === number && !issueNodes[id].repo,
  ) || `I_${number}`;
  const github = {
    calls,
    paginate: async (fn, params) => fn(params),
    graphql: async (query, variables) => {
      if (query.includes('pullRequest(number')) {
        return {
          repository: { pullRequest: { commits: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{ commit: { associatedPullRequests: { nodes: mergedPrs } } }],
          } } },
        };
      }
      if (parentLookupError) throw new Error(parentLookupError);
      if (variables.ids) return { nodes: variables.ids.map(withParent) };
      const repository = {};
      for (const [, alias, number] of query.matchAll(/(i\d+): issue\(number: (\d+)\)/g)) {
        repository[alias] = withParent(idOf(Number(number)));
      }
      return { repository };
    },
    rest: {
      issues: {
        listMilestones: async () => milestones,
        listForRepo: async (params) => {
          calls.listForRepo.push(params);
          return params && params.milestone !== undefined ? milestoneIssues : repoIssues;
        },
        create: async (issue) => {
          calls.createIssue.push(issue);
          return { data: { ...issue, number: nextIssue++ } };
        },
        update: async (issue) => {
          calls.updateIssue.push(issue);
          return { data: issue };
        },
        createComment: async (comment) => {
          calls.createComment.push(comment);
          return { data: comment };
        },
        createLabel: async (label) => {
          calls.createLabel.push(label);
          if (existingLabels.includes(label.name)) throw Object.assign(new Error('Validation Failed'), { status: 422 });
          return { data: label };
        },
        get: async ({ issue_number }) => {
          if (!issues[issue_number]) throw Object.assign(new Error('Not Found'), { status: 404 });
          return { data: issues[issue_number] };
        },
      },
      repos: {
        listReleases: async () => releases,
        createRelease: async (release) => {
          calls.createRelease.push(release);
          return { data: { ...release, html_url: `https://github.com/o/r/releases/tag/${release.tag_name}` } };
        },
        updateRelease: async (release) => {
          calls.updateRelease.push(release);
          return { data: { ...release, html_url: `https://github.com/o/r/releases/tag/${release.tag_name}` } };
        },
      },
    },
  };
  return github;
}

// Runs a script in `dir` with the given pull request payload and step env.
export async function runScript(script, { dir, github, pullRequest, env = {} }) {
  const outputs = {};
  const failures = [];
  const warnings = [];
  const summary = {
    text: '',
    addHeading: () => summary,
    addLink: () => summary,
    addCodeBlock: () => summary,
    addRaw: (text) => { summary.text += text; return summary; },
    write: async () => {},
  };
  const core = {
    setOutput: (name, value) => { outputs[name] = value; },
    setFailed: (message) => { failures.push(message); },
    info: () => {},
    warning: (message) => { warnings.push(message); },
    summary,
  };
  const exec = {
    getExecOutput: async (cmd, args) => ({ stdout: execFileSync(cmd, args, { cwd: dir, encoding: 'utf8' }) }),
  };
  const context = { repo: { owner: 'OnroerendErfgoed', repo: 'demo' }, payload: { pull_request: pullRequest } };

  const previousCwd = process.cwd();
  const previousEnv = { ...process.env };
  process.chdir(dir);
  Object.assign(process.env, { RUNNER_TEMP: dir, CHANGELOG_PATH: '', TAG_PREFIX: '', PRERELEASE: 'false' }, env);
  try {
    await new AsyncFunction('require', 'github', 'context', 'core', 'exec', script)(require, github, context, core, exec);
  } finally {
    process.chdir(previousCwd);
    process.env = previousEnv;
  }
  return { outputs, failures, warnings, summary: summary.text };
}
