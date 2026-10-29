# Changelog

## Unreleased

- `dependency-track.yml`: on PRs and nightly, uploads CycloneDX SBOMs of the backend (uv.lock or a requirements file) and optional yarn frontend to Dependency-Track, authenticated with the job's GitHub OIDC token instead of an API key. Scores every finding with the OE Risicoscore (ICR impact x CVSS, KEV/EPSS and exposure), creates or updates one issue per vulnerable library, and fails from a configurable level. Caller template in `templates/dependency-track.yml`.

## 1.5.0 (2026-10-29)

- `python-tests.yml`: `elasticsearch-version: "8"` or `"9"` uses the version in the `ES_VERSION_8` or `ES_VERSION_9` Actions variable, so the Elasticsearch versions are set once for the organization. Without the variable (e.g. in a public repo it isn't shared with), `8.2.0` / `9.2.1` is used, with a notice in the log. A specific version still works. The version used is available as `$ELASTICSEARCH_VERSION`.
- `self-test.yml`: tests `elasticsearch-version: "9"`.
- `templates/ci.yml`: uses `elasticsearch-version: "9"`.

## 1.4.0 (2026-10-28)

- `python-release.yml`: new reusable workflow that builds a library's sdist and wheel, checks them with twine and against the release tag, saves them as a workflow artifact, and uploads them to the internal index with `twine upload -r internal`. The index URL and credentials are secrets of the caller, written to a temporary `.pypirc` for the upload step only. With `upload: false`, a caller can publish the artifact to public PyPI instead.
- `templates/python-release-pypi.yml`: caller for public libraries that publishes the artifact to pypi.org with trusted publishing.
- `self-test.yml`: builds the fixture app with `python-release.yml` (without upload) and checks the artifact.

## 1.3.0 (2026-10-28)

- `frontend-tests.yml`: new reusable workflow for frontend tests with pnpm, yarn or npm (corepack), `@OnroerendErfgoed` packages from GitHub Packages, an optional `npm-token` secret for registry.npmjs.org, and optional lint. The registry tokens are only available during the install.
- `self-test.yml`: runs `frontend-tests.yml` with every package manager.
- README: the release check compares the commits the tags point to.

## 1.2.0 (2026-10-28)

- `python-tests.yml`: the pip-sync / pip virtualenv is created with `--clear`, so a virtualenv left in `runner.temp` by an earlier job on a self-hosted runner no longer breaks the install.

## 1.1.0 (2026-10-27)

- `changelog-draft.yml`: sub-issues are listed under their top-level parent issue, in the parent's category. The parent is shown even when it is not part of the release. Issue type `Collection` counts as a feature. `.rst` changelogs get blank lines around the nested lists.

## 1.0.0 (2026-10-26)

First version of the shared workflows.

- `python-tests.yml`: Python tests on self-hosted or GitHub-hosted runners, with a Python version matrix, pip-sync / pip / uv installs, optional PostGIS, Redis and Elasticsearch services, a DB setup command, flake8 or custom lint, and orgoro/coverage or Coveralls. The coverage XML path is in `$COVERAGE_XML`.
- `changelog-draft.yml`: based on `prepare-release.yml`. Runs for `release x.y.z` PRs from `develop` (`source-branch` input). Groups issues into 💥 Breaking changes / 🐛 Bugs / ✨ Features / 🧹 Other, finds changelogs in subdirectories, and detects the heading style from the content.
- `release-draft.yml`: based on `draft-release.yml`. Runs when that PR is merged. Same changelog lookup, category headings in the release notes, `tag-prefix` and `prerelease` inputs, outputs `version`, `tag_name` and `html_url`.
- `pr-labeler.yml`: the PR labeler used in 51 repos.
- Caller templates in `templates/`.
- `self-test.yml`: actionlint, zizmor, script tests, and `python-tests.yml` against a fixture app with every installer and all services.
