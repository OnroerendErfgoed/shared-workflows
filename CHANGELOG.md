# Changelog

## Unreleased

First version of the shared workflows.

- `python-tests.yml`: Python tests with optional PostGIS, Redis and Elasticsearch services, pip-sync / pip / uv installs, flake8 or custom lint, orgoro/coverage or Coveralls.
- `changelog-draft.yml`: based on `prepare-release.yml`. Groups issues into 💥 Breaking changes / 🐛 Bugs / ✨ Features / 🧹 Other, finds changelogs in subdirectories, and detects the heading style from the content.
- `changelog-draft.yml` and `release-draft.yml` only run for PRs from `develop` (`source-branch` input) and have separate caller templates.
- `release-draft.yml`: based on `draft-release.yml`. Same changelog lookup, category headings in the release notes, `tag-prefix` and `prerelease` inputs, outputs `version`, `tag_name` and `html_url`.
- `pr-labeler.yml`: the PR labeler used in 51 repos.
- `changelog-draft.yml`: fetch at most 10 labels per linked issue, to stay under GitHub's GraphQL node limit (the query was rejected with 20).
- `python-tests.yml`: the coverage XML path is in `$COVERAGE_XML`. `$COVERAGE_FILE` clashed with coverage.py, which uses that variable for its data file, so the XML report went missing. New `redis-image` input.
- `self-test.yml`: actionlint, zizmor, script tests, and `python-tests.yml` against a fixture app with every installer and all services.
