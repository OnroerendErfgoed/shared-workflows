# shared-workflows

Reusable GitHub Actions workflows for the OnroerendErfgoed repositories. A project repo keeps only a thin caller workflow; the logic lives here.

| Workflow | Does | Caller template |
| --- | --- | --- |
| [`python-tests.yml`](.github/workflows/python-tests.yml) | Installs a Python project, starts PostGIS / Redis / Elasticsearch, lints, runs the tests and reports coverage | [`templates/ci.yml`](templates/ci.yml) |
| [`frontend-tests.yml`](.github/workflows/frontend-tests.yml) | Installs a frontend project with pnpm, yarn or npm (with GitHub Packages), lints and runs the tests | [`templates/frontend-tests.yml`](templates/frontend-tests.yml) |
| [`changelog-draft.yml`](.github/workflows/changelog-draft.yml) | When a `release x.y.z` PR from `develop` into `main`/`master` is opened: bumps the version and writes the grouped changelog section to the PR branch | [`templates/changelog-draft.yml`](templates/changelog-draft.yml) |
| [`release-draft.yml`](.github/workflows/release-draft.yml) | When that PR is merged: creates a draft GitHub release from the changelog section | [`templates/release-draft.yml`](templates/release-draft.yml) |
| [`python-release.yml`](.github/workflows/python-release.yml) | When a release is published: builds the sdist and wheel of a library and uploads them to the internal package index with twine, or hands them to a publish job for public PyPI | [`templates/python-release.yml`](templates/python-release.yml), [`templates/python-release-pypi.yml`](templates/python-release-pypi.yml) |
| [`pr-labeler.yml`](.github/workflows/pr-labeler.yml) | Labels a PR based on its branch name | [`templates/pr-labeler.yml`](templates/pr-labeler.yml) |

Call them with the major version tag:

```yaml
jobs:
  test:
    uses: OnroerendErfgoed/shared-workflows/.github/workflows/python-tests.yml@v1
    permissions:
      contents: read
      pull-requests: write
    with:
      test-command: pytest tests --cov=myapp --cov-report=xml:"$COVERAGE_XML"
```

Triggers, branch and `paths:` filters always stay in the caller. A called workflow can only use the `GITHUB_TOKEN` permissions the calling job grants, so every caller job sets the `permissions:` listed below.

## `python-tests.yml`

One job per Python version in `python-versions`. Commands run in `working-directory` with the project's virtualenv on the `PATH`, so `flake8`, `pytest` etc. work without activating it.

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `test-command` | string | **required** | Test command. Write the coverage XML to `$COVERAGE_XML`. |
| `runs-on` | string | `self-hosted` | Runner label, or a JSON list of labels. Public repos must use `ubuntu-latest`. |
| `python-versions` | string | `["3.11"]` | JSON list of Python versions. |
| `allow-prereleases` | boolean | `false` | Allow pre-release Python versions. |
| `working-directory` | string | `.` | Where install, lint and test commands run. |
| `installer` | string | `pip-sync` | `pip-sync` (pip-tools + `pip install -e .`), `pip` (`pip install -r` + `pip install -e .`) or `uv` (`uv sync --locked`). |
| `requirements-file` | string | `requirements-ci.txt` | For `pip-sync` and `pip`. |
| `install-command` | string | `""` | Replaces the default install. `pip-sync`/`pip` still get a virtualenv. |
| `skip-build-hooks` | boolean | `true` | Sets `HATCH_BUILD_NO_HOOKS=true` during the install. |
| `lint-command` | string | `flake8` | Empty to skip. |
| `db-setup-command` | string | `""` | Prepares the test database; `$PG_CONTAINER` is the postgres container id, e.g. `scripts/reset_db_test.sh "$PG_CONTAINER"`. |
| `postgres` | boolean | `false` | Start PostGIS on port 5432 (`POSTGRES_PASSWORD=password`, trust auth). |
| `postgres-image` | string | `postgis/postgis:13-3.3-alpine` | |
| `postgres-db` | string | `""` | `POSTGRES_DB`. |
| `redis` | boolean | `false` | Start Redis on port 6379. |
| `redis-image` | string | `redis` | |
| `elasticsearch-version` | string | `""` | Start Elasticsearch (single node, no security) on port 9200, e.g. `9.2.1`. Also sets the sysctl limits it needs. |
| `elasticsearch-java-opts` | string | `""` | `ES_JAVA_OPTS`. Falls back to the `ES_JAVA_OPTS` Actions variable (org or repo), then to `-Xms128m -Xmx128m`. |
| `coverage` | string | `orgoro` | `orgoro` (PR comment with thresholds, PRs only), `coveralls` or `none`. |
| `coverage-file` | string | `coverage.xml` | Coverage XML, relative to `working-directory`. Its absolute path is in `$COVERAGE_XML`. |
| `coverage-source-dir` | string | `""` | `sourceDir` for orgoro/coverage. |
| `coverage-threshold-all` / `-new` / `-modified` | number | `0.8` / `0.9` / `0.8` | orgoro/coverage thresholds. |
| `timeout-minutes` | number | `15` | Per job. |

Permissions: `contents: read`, `pull-requests: write`. Secrets: none.

## `frontend-tests.yml`

Sets up Node.js, enables pnpm or yarn with corepack (the version from `packageManager` in `package.json`, else corepack's default; yarn without `packageManager` is yarn 1), installs the dependencies, and runs the lint and test commands in `working-directory`.

During the install, a temporary user-level `.npmrc` points `@OnroerendErfgoed` at GitHub Packages and holds the registry tokens as `${...}` references to environment variables. It is removed after the install, so the lint and test commands never see the tokens, and the project's own `.npmrc` is left alone. (pnpm does not expand environment variables in auth settings of a project `.npmrc`.)

For projects whose frontend is built through the Python package (a hatch build hook with `pip install -e .`), use `python-tests.yml` with `skip-build-hooks: false` instead.

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `test-command` | string | **required** | Test command, e.g. `pnpm test:unit`. |
| `runs-on` | string | `self-hosted` | Runner label, or a JSON list of labels. Public repos must use `ubuntu-latest`. |
| `node-version` | string | `22` | Node.js version. Ignored when `node-version-file` is set. |
| `node-version-file` | string | `""` | File with the Node.js version (e.g. `frontend/.nvmrc`), relative to the repository root. |
| `working-directory` | string | `frontend` | Directory with the `package.json`. |
| `package-manager` | string | `pnpm` | `pnpm`, `yarn` or `npm`. |
| `install-command` | string | `""` | Replaces the default install: `pnpm install --frozen-lockfile`, `yarn install --frozen-lockfile` or `npm ci`. |
| `lint-command` | string | `""` | Empty to skip. |
| `github-packages` | boolean | `true` | Install `@OnroerendErfgoed` packages from GitHub Packages, with the `GITHUB_TOKEN`. |
| `timeout-minutes` | number | `15` | |

| Secret | Required | Description |
| --- | --- | --- |
| `npm-token` | no | Token for registry.npmjs.org, for private packages there. Repos name this secret differently, so pass it explicitly: `npm-token: ${{ secrets.NPM_GOV_FLANDERS }}`. |

Permissions: `contents: read`, `packages: read`.

## `changelog-draft.yml`

Runs for open pull requests from `develop` (see `source-branch`) titled `release x.y.z`, when they are opened, reopened, or their title is edited. The caller's trigger limits the target branches to `main`/`master`. It:

1. bumps the version in every `pyproject.toml` (+ `uv.lock`) and `package.json` (+ `package-lock.json`);
2. collects the issues of this release: the milestone `x.y.z`, the issues closed by the PRs merged into `develop` that are part of this release, and issue numbers in their branch names (`feature/123_foo`);
3. prepends a `x.y.z (DD-MM-YYYY)` section to the changelog, grouped as below, and commits it to the PR branch;
4. posts the list as a PR comment, with the merged PRs that have no linked issue.

Each issue is listed once, in the first category it matches. Empty categories are left out.

| Category | Matches |
| --- | --- |
| 💥 Breaking changes | label `breaking` |
| 🐛 Bugs | issue type `Bug`, or label `bug` / `fix` |
| ✨ Features | issue type `Feature`, `Task` or `Collection`, or label `enhancement` / `feature` |
| 🧹 Other | everything else |

Sub-issues are listed under their top-level parent issue, in the parent's category, also when the parent itself is not part of the release (deeper sub-issues are listed under the top-level parent too). A parent in another repository is shown as `owner/repo#123`. In `.rst` changelogs the nested list gets the blank lines reStructuredText needs. If the parents can't be looked up, the issues are listed without nesting and the run shows a warning.

```
✨ Features

- Extra data type - rapporten archeologie (#291)
  - Dupliceer notas & toelatingen_archeologie types (#293)
  - Rename ArcheologieGisPubliekMatview (#303)
```

The changelog is `CHANGES`, `CHANGELOG` or `HISTORY` (`.rst`, `.md` or `.txt`) at the shallowest level where one exists, so `proces/CHANGES.rst` is found when there is none at the root. `node_modules`, vendored directories (`vendor`, `libraries`, `roles`, …) and `docs` are ignored. The heading style is taken from the file's content: `## x.y.z (date)` headings get `### 💥 Breaking changes` sub-headings, underlined `x.y.z (date)` headings get plain category lines.

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `source-branch` | string | `develop` | Only run for PRs from this branch. Empty for any branch. |
| `changelog-path` | string | `""` | Changelog(s) to update, comma-separated, instead of finding them. |

| Secret | Required | Description |
| --- | --- | --- |
| `RELEASE_TOKEN` | no | Token to push the release commit with. Pushes with `GITHUB_TOKEN` don't trigger CI on that commit, and may be blocked by branch protection. |

| Output | Description |
| --- | --- |
| `version` | The release version. |
| `changelog` | The new section, without the version heading. |

Permissions: `contents: write`, `issues: read`, `pull-requests: write`.

## `release-draft.yml`

Runs when a pull request from `develop` (see `source-branch`) into `main`/`master` is merged, as a separate workflow from the changelog draft. Takes the version from the PR title, or from the topmost heading in the changelog, and creates (or updates) a **draft** release with that version's changelog section as notes, targeting the merge commit. Category lines become `###` headings. The tag is created when someone publishes the draft.

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `source-branch` | string | `develop` | Only run for merged PRs from this branch. Empty for any branch. |
| `changelog-path` | string | `""` | Changelog to read, instead of finding it. |
| `tag-prefix` | string | `""` | Prefix for tag and release name, e.g. `v`. |
| `prerelease` | boolean | `false` | Mark the release as a pre-release. |

| Output | Description |
| --- | --- |
| `version` | The release version. |
| `tag_name` | Tag of the draft release. |
| `html_url` | URL of the draft release. |

Permissions: `contents: write`.

## `python-release.yml`

Builds the sdist and wheel with `python -m build` (so with the project's own build backend, e.g. hatchling), runs `twine check`, saves both as a workflow artifact, and uploads them with `twine upload -r internal`. Meant for the internal libraries (`oe_utils`, `oe_geoutils`, `pyramid_oeauth`, …): the caller triggers it when the draft release from `release-draft.yml` is published.

When it runs for a tag (a `release` event, or started by hand on a tag), the package version must equal the tag without `tag-prefix`, so a release whose `pyproject.toml` wasn't bumped is not uploaded.

The index URL, username and password are secrets of the calling repo (or organization); nothing about the index is in this public repo. Only the upload step gets them: it writes them to a temporary `.pypirc` (mode `600`, in `runner.temp`) as the `internal` repository and passes it with `--config-file`. The file and the built distributions are removed at the end of the job, also when it fails, because self-hosted runners keep their disk. The build itself (and any build hooks) runs without the secrets.

The internal index is only reachable from our network, so the default runner is `self-hosted`.

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `runs-on` | string | `self-hosted` | Runner label, or a JSON list of labels. Must be able to reach the internal index. |
| `python-version` | string | `3.11` | Python version to build with. |
| `working-directory` | string | `.` | Directory with the `pyproject.toml`. |
| `build-command` | string | `""` | Replaces `python -m build`. Must write the sdist and wheel to `$DIST_DIR`. |
| `tag-prefix` | string | `""` | Prefix of the release tag, e.g. `v`. |
| `upload` | boolean | `true` | `false` to only build and check, e.g. on pushes to `develop`. |
| `skip-existing` | boolean | `false` | Pass `--skip-existing` to twine, for re-runs after a partial upload. |
| `artifact-name` | string | `dist` | Name of the workflow artifact with the sdist and wheel (kept 7 days). |
| `timeout-minutes` | number | `15` | |

| Secret | Required | Description |
| --- | --- | --- |
| `pypi-url` | when uploading | Upload URL of the internal index (the `repository` in `.pypirc`). |
| `pypi-username` | when uploading | |
| `pypi-password` | when uploading | |

Repos name these secrets differently, so pass them explicitly, e.g. `pypi-password: ${{ secrets.PYPI_INTERNAL_PASSWORD }}`.

| Output | Description |
| --- | --- |
| `version` | The version that was built. |
| `artifact-name` | Name of the workflow artifact with the sdist and wheel. |

Permissions: `contents: read`.

### Public PyPI

Public libraries (e.g. `crabpy_pyramid`) are published to pypi.org with [trusted publishing](https://docs.pypi.org/trusted-publishers/), so no PyPI token is stored. PyPI doesn't accept trusted publishing from inside a reusable workflow, so the upload is a job in the caller: [`templates/python-release-pypi.yml`](templates/python-release-pypi.yml) calls `python-release.yml` on `ubuntu-latest` with `upload: false`, and its `publish` job downloads the artifact and uploads it with [pypa/gh-action-pypi-publish](https://github.com/pypa/gh-action-pypi-publish). The publish job only runs for tags.

Setup, once per repo:

1. On pypi.org, under the project's **Manage → Publishing**, add a GitHub trusted publisher: owner `OnroerendErfgoed`, the repository, the caller's workflow file name (e.g. `python-release.yml`, not the shared workflow) and environment `pypi`.
2. In the repository's **Settings → Environments**, create the `pypi` environment. Required reviewers or a tag rule there limit who can publish.

Public repos must not use the self-hosted runners, and get no internal index secrets.

## `pr-labeler.yml`

Adds labels to a new PR based on its branch name, with [TimonVS/pr-labeler-action](https://github.com/TimonVS/pr-labeler-action) and the calling repo's `.github/pr-labeler.yml`.

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `configuration-path` | string | `.github/pr-labeler.yml` | Labeler configuration in the calling repo. |

Permissions: `contents: read`, `pull-requests: write`.

## Versioning

Callers use the major tag `@v1`, which always points to the latest `v1.x.y` release.

- **Patch / minor** (`v1.x.y`): fixes and new optional inputs that keep the defaults. `v1` moves to the new release.
- **Major** (`v2.0.0`): renamed or removed inputs, changed defaults, new required secrets or permissions. Repos opt in by changing `@v1` to `@v2`.

Every release gets an entry in [CHANGELOG.md](CHANGELOG.md).

### Releasing

1. In a PR, move the changes in `CHANGELOG.md` under a `## x.y.z (YYYY-MM-DD)` heading, and merge it.
2. Tag the merge commit on `main` and create the release with the changelog entry as notes:

   ```bash
   git switch main && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   gh release create vX.Y.Z --verify-tag --title vX.Y.Z --notes "..."
   ```

3. Point the major tag at the new release, so callers on `@v1` get it:

   ```bash
   git tag -f -a v1 -m "v1 -> vX.Y.Z" vX.Y.Z^{}
   git push -f origin v1
   ```

   Both are annotated tags, so they have different hashes; check that they point to the same commit (the `^{}` lines):

   ```bash
   git ls-remote --tags origin | grep -E 'refs/tags/v1(\.[0-9]+\.[0-9]+)?\^\{\}$'
   ```

   For a new major version, create `v2` the same way, without `-f`.

## Development

All third-party actions are pinned to a commit SHA with the version in a comment; Dependabot proposes updates.

[`self-test.yml`](.github/workflows/self-test.yml) runs on every pull request and push to `main`:

| Job | Checks |
| --- | --- |
| `lint` | [actionlint](https://github.com/rhysd/actionlint) (with shellcheck) and [zizmor](https://docs.zizmor.sh/) on `.github/workflows/` and `templates/` |
| `scripts` | The inline `github-script` code of the changelog and release workflows, extracted from the workflow files and run against a temporary git repository with a mocked GitHub API |
| `python-pip-sync`, `python-pip`, `python-uv` | `python-tests.yml` with each installer against [`tests/fixtures/python-app`](tests/fixtures/python-app), a minimal Pyramid app |
| `python-services` | `python-tests.yml` with PostGIS, Redis and Elasticsearch, a DB setup command, and tests that check each service |
| `python-release`, `python-release-artifact` | `python-release.yml` without upload: builds the fixture app, checks the distributions, and checks that the artifact holds one wheel and one sdist |
| `frontend-pnpm`, `frontend-npm`, `frontend-yarn` | `frontend-tests.yml` with each package manager against [`tests/fixtures/frontend-app`](tests/fixtures/frontend-app) and [`tests/fixtures/frontend-yarn`](tests/fixtures/frontend-yarn), with and without GitHub Packages, and with `node-version-file` |

Run the script tests locally (Node 22+, no dependencies):

```bash
node --test 'tests/*.test.mjs'
```

The fixture app's dependencies are pinned in `requirements-ci.txt` (for pip-sync and pip) and `uv.lock`, both resolved with releases at least two weeks old:

```bash
cd tests/fixtures/python-app
uv pip compile requirements-ci.in --universal --python-version 3.11 --exclude-newer <date> -o requirements-ci.txt
uv lock  # uses exclude-newer from pyproject.toml
```
