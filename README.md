# shared-workflows

Reusable GitHub Actions workflows for the OnroerendErfgoed repositories. A project repo keeps only a thin caller workflow; the logic lives here.

| Workflow | Does | Caller template |
| --- | --- | --- |
| [`python-tests.yml`](.github/workflows/python-tests.yml) | Installs a Python project, starts PostGIS / Redis / Elasticsearch, lints, runs the tests and reports coverage | [`templates/ci.yml`](templates/ci.yml) |
| [`changelog-draft.yml`](.github/workflows/changelog-draft.yml) | When a `release x.y.z` PR from `develop` into `main`/`master` is opened: bumps the version and writes the grouped changelog section to the PR branch | [`templates/changelog-draft.yml`](templates/changelog-draft.yml) |
| [`release-draft.yml`](.github/workflows/release-draft.yml) | When that PR is merged: creates a draft GitHub release from the changelog section | [`templates/release-draft.yml`](templates/release-draft.yml) |
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
