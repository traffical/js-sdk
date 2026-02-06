# Contributing to Traffical JS SDK

Thank you for your interest in contributing to the Traffical JavaScript SDK!

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.0 or later
- Node.js 22+ (for compatibility testing)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/traffical/js-sdk.git
   cd js-sdk
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Build all packages:
   ```bash
   bun run build
   ```

4. Run tests:
   ```bash
   bun run test
   ```

## Development Workflow

### Package Structure

This monorepo contains multiple packages:

- `packages/core` - Pure TypeScript core (no I/O)
- `packages/js-client` - Browser client
- `packages/react` - React bindings
- `packages/svelte` - Svelte 5 bindings
- `packages/node` - Node.js server SDK

### Making Changes

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes

3. Run type checking:
   ```bash
   bun run typecheck
   ```

4. Run tests:
   ```bash
   bun run test
   ```

5. Document your changes:
   ```bash
   bunx changeset
   ```
   
   Follow the prompts to describe your changes. This creates a changeset file that will be used to generate changelogs and bump versions.

### Pull Request Process

1. Ensure all tests pass
2. Update documentation if needed
3. Include a changeset for user-facing changes
4. Submit a PR against the `main` branch

## Code Style

- Use TypeScript for all code
- Follow existing patterns in the codebase
- Keep functions small and focused
- Write tests for new functionality

## Versioning & Releases

We use [Changesets](https://github.com/changesets/changesets) for version management.

**Do not manually edit version numbers in `package.json`.** Do not manually run `bunx changeset version` or `bunx changeset publish`. All version bumping and npm publishing is fully automated by GitHub Actions (see `.github/workflows/release.yml`).

### Version Types

- **patch**: Bug fixes, documentation updates
- **minor**: New features (backwards compatible)
- **major**: Breaking changes

### Creating a Changeset

Your only responsibility is to create a changeset that describes what changed. Run this after making your code changes:

```bash
bunx changeset
```

This will prompt you to:
1. Select which packages were affected
2. Choose the version bump type (patch/minor/major)
3. Write a summary of the changes

A markdown file will be created in `.changeset/` — commit this file alongside your code changes.

### Release Process (Fully Automated)

Releases are handled entirely by the GitHub Actions workflow in `.github/workflows/release.yml`. There are no manual steps. The process works as follows:

1. **You merge your PR to `main`** — Your PR includes code changes and a `.changeset/` file.
2. **GitHub Actions creates a "Version Packages" PR** — The `changesets/action` detects pending changesets and automatically opens a PR that bumps versions in `package.json` files and updates changelogs.
3. **A maintainer reviews and merges the "Version Packages" PR** — This is the only review step.
4. **GitHub Actions publishes to npm** — When the "Version Packages" PR is merged to `main`, the workflow runs again. This time there are no pending changesets, so it runs `bun run release` which publishes all updated packages to npm automatically.

That's it. Never run npm publish or changeset publish commands locally.

## Questions?

Open an issue or reach out to the maintainers.

