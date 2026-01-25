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

We use [Changesets](https://github.com/changesets/changesets) for version management. **Do not manually edit version numbers in package.json.**

### Version Types

- **patch**: Bug fixes, documentation updates
- **minor**: New features (backwards compatible)  
- **major**: Breaking changes

### Creating a Changeset

After making changes, create a changeset to document what changed:

```bash
bunx changeset
```

This will prompt you to:
1. Select which packages were affected
2. Choose the version bump type (patch/minor/major)
3. Write a summary of the changes

A markdown file will be created in `.changeset/` - commit this with your code.

### Release Process

Releases happen automatically via GitHub Actions:

1. **Merge to main** - When PRs with changesets are merged, the CI creates a "Version Packages" PR
2. **Review Version PR** - This PR contains version bumps and changelog updates
3. **Merge Version PR** - Merging triggers automatic npm publish

### Manual Release (Maintainers)

If you need to release manually:

```bash
# Consume changesets and bump versions
bunx changeset version

# Review changes
git diff

# Commit version bumps
git add -A
git commit -m "chore: version packages"
git push

# Publish to npm (CI does this automatically)
bunx changeset publish
```

### Checking Package Versions

To see what's published on npm vs local:

```bash
npm view @traffical/svelte version   # npm version
cat packages/svelte/package.json | grep version  # local version
```

## Questions?

Open an issue or reach out to the maintainers.

