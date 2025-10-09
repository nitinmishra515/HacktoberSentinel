# HacktoberSentinel

Guard your repo from Hacktoberfest drive-by pull requests. HacktoberSentinel is a drop-in GitHub Action that scores incoming PRs against lightweight rules (README-only edits, contributor list bumps, generic bodies, newbie authors, and custom regex) and labels or closes suspicious submissions before they clutter your queue.

## Quick Start

Add a workflow like `.github/workflows/spam-check.yml` to your repository:

```yaml
name: Spam Check
on: [pull_request]

jobs:
  hacktober-sentinel:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run HacktoberSentinel
        uses: binbandit/HacktoberSentinel@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          close-spam: 'false'
```

Flagged PRs receive the configured label and a polite reminder pointing contributors to legitimate Hacktoberfest guidance.

## Inputs

| Input | Default | Description |
| ----- | ------- | ----------- |
| `github-token` | – | Token used for GitHub API calls. Use the provided `${{ secrets.GITHUB_TOKEN }}`. |
| `close-spam` | `false` | Close PRs automatically when the spam score meets the threshold. |
| `label-name` | `spam` | Label applied to flagged PRs (auto-created if missing). |
| `comment-message` | preset text | Comment left on flagged PRs. Customize to point at your contribution guide. |
| `min-score` | `2` | Minimum matched rules required before taking action. |
| `custom-regex` | empty | Optional regex (supports `/pattern/flags` form) evaluated against the diff and PR body. |
| `enable-readme-only` | `true` | Turns the README-only rule on/off. |
| `enable-contributor-regex` | `true` | Detects new contributor list entries. |
| `enable-generic-body` | `true` | Checks for low-effort titles/bodies (`fixed typo`, `added my name`, etc.). |
| `enable-new-contributor` | `true` | Flags authors with fewer than `new-contributor-threshold` public repos. |
| `enable-custom-regex` | `true` | Toggles the custom regex rule. |
| `new-contributor-threshold` | `5` | Minimum public repos before an author is considered seasoned. |

## Outputs

- `flagged` – `true` when actioned, otherwise `false`.
- `score` – Total matched rules.
- `matched-rules` – Comma-separated list of rule identifiers.

## Default Rules

- **readme-only**: Single-file PRs touching only `README.md`.
- **contributor-regex**: Adds `+ - [Name] (@username)` style entries.
- **generic-body**: Generic titles/bodies packed with Hacktoberfest spam clichés.
- **new-contributor**: Authors beneath the public repo threshold (default `<5`).
- **custom-regex**: Optional pattern supplied via input.

A PR matching two or more rules (configurable) is labeled, commented, and optionally closed.

## Development

```bash
pnpm install
node --check index.js
```

Use the included `.github/workflows/spam-check.yml` as a starting point for local testing with [act](https://github.com/nektos/act) or on a fork.

Star the repo, spread the word, and give maintainers their Octobers back.
