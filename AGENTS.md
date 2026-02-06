# Agent Guidelines for @traffical JS SDK

## Important Files

- **`CONTRIBUTING.md`** - Contains the full development workflow. Always read and follow this file when making changes.

## Versioning

- **Never manually edit version numbers in `package.json` files.** This repository uses [changesets](https://github.com/changesets/changesets) for version management.
- **Never run `bunx changeset version`, `bunx changeset publish`, or `npm publish` locally.** All version bumping and npm publishing is fully automated by GitHub Actions (`.github/workflows/release.yml`).
- When making changes that affect users, create a changeset using the interactive command:
  ```bash
  bunx changeset
  ```
- Follow the prompts to select affected packages, version bump type, and write a summary.
- Commit the generated `.changeset/` file with your code. GitHub Actions handles everything else.

## Development Workflow

When making changes to packages, follow this workflow (see `CONTRIBUTING.md` for full details):

1. Make your changes
2. Run type checking: `bun run typecheck`
3. Run tests: `bun run test`
4. Create a changeset: `bunx changeset`
5. Commit and push — GitHub Actions handles version bumps and npm publishing automatically
