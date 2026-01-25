# Changesets

This folder contains changesets - markdown files that describe changes to packages.

## Adding a changeset

When you make a change that should be released, run:

```bash
bunx changeset
```

Follow the prompts to:
1. Select which packages have changed
2. Choose the semver bump type (patch/minor/major)
3. Write a summary of the changes

This creates a markdown file in this folder that will be consumed during release.

## Release process

On merge to main, the release workflow will:
1. Consume all changesets
2. Update package versions
3. Generate changelogs
4. Publish to npm

