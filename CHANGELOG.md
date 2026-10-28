# Changelog

## Unreleased

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
