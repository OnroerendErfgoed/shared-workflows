# Changelog

## Unreleased

First version of the shared workflows.

- `python-tests.yml`: Python tests with optional PostGIS, Redis and Elasticsearch services, pip-sync / pip / uv installs, flake8 or custom lint, orgoro/coverage or Coveralls.
- `changelog-draft.yml`: based on `prepare-release.yml`. Groups issues into 💥 Breaking changes / 🐛 Bugs / ✨ Features / 🧹 Other, finds changelogs in subdirectories, and detects the heading style from the content.
- `release-draft.yml`: based on `draft-release.yml`. Same changelog lookup, category headings in the release notes, `tag-prefix` and `prerelease` inputs, outputs `version`, `tag_name` and `html_url`.
- `pr-labeler.yml`: the PR labeler used in 51 repos.
