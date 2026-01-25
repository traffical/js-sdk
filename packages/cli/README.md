# @traffical/cli

Config-as-code CLI for Traffical - manage your feature flags and experimentation parameters in version-controlled YAML files.

## Installation

```bash
# Install globally
npm install -g @traffical/cli

# Or use via npx
npx @traffical/cli init
```

## Quick Start

```bash
# Initialize in your project
traffical init --api-key <your-api-key>

# Push local changes to Traffical
traffical push

# Pull updates from Traffical
traffical pull

# Bidirectional sync
traffical sync
```

## What `init` Creates

Running `traffical init` creates a `.traffical/` directory with:

```
.traffical/
├── config.yaml      # Main configuration file
├── AGENTS.md        # AI agent integration guide
└── templates/       # Framework-specific code templates
    ├── feature-flag.tsx
    ├── ab-test.tsx
    └── server.ts
```

The CLI automatically detects your framework (React, Next.js, Svelte, SvelteKit, Vue, Nuxt, Node.js) and generates appropriate templates.

## Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize Traffical in a project, creates `.traffical/` directory |
| `push` | Push local config to Traffical (validates first) |
| `pull` | Pull synced parameters from Traffical to local config |
| `sync` | Bidirectional sync (local wins policy) |
| `status` | Show current sync status |
| `import <key>` | Import dashboard parameters (supports wildcards: `ui.*`, `*.enabled`) |
| `integrate-ai-tools` | Add Traffical references to AI tool config files |

## Sync Behavior

The CLI uses a **"local wins"** policy for the `sync` command:

1. **Validates** your local config first (catches errors before any network calls)
2. **Pushes** your local changes to Traffical (your edits take precedence)
3. **Adds** new parameters from Traffical that you don't have locally
4. **Warns** about conflicts (but your local version is used)

This matches the Git workflow where your local file is the source of truth. If you want to overwrite local changes with remote values, use `traffical pull` explicitly.

### Example Workflow

```bash
# Edit config locally
vim .traffical/config.yaml

# Sync: your changes are pushed, new remote params are added
traffical sync

# If you want remote values to overwrite local:
traffical pull
```

## Config File Format

```yaml
# .traffical/config.yaml
version: "1.0"
project:
  id: proj_xxx
  orgId: org_xxx

parameters:
  checkout.button.color:
    type: string
    default: "#FF6600"
    namespace: checkout
    description: Primary CTA button color

  pricing.discount.enabled:
    type: boolean
    default: false
    namespace: pricing
```

### Parameter Types

| Type | Default Value |
|------|---------------|
| `string` | Any string |
| `number` | Any number |
| `boolean` | `true` or `false` |
| `json` | Object or array |

## Validation

The CLI validates your config against a JSON Schema before pushing:

- Required fields (`version`, `project.id`, `project.orgId`, `parameters`)
- Type consistency (e.g., `type: boolean` must have a boolean `default`)
- ID format (`proj_*` and `org_*` prefixes)

```bash
# Validation happens automatically on push/sync
traffical push

# Example error output
✗ Invalid config file

Errors:
  - parameters.my_flag.default: must be boolean
```

## AI Tool Integration

The CLI can automatically add Traffical references to AI coding tool configuration files:

```bash
# Scan and update AI tool files
traffical integrate-ai-tools

# Or auto-confirm without prompting
traffical integrate-ai-tools --yes
```

Supported files:
- `CLAUDE.md` (Claude Code)
- `.cursorrules` (Cursor)
- `.github/copilot-instructions.md` (GitHub Copilot)
- `.windsurfrules` (Windsurf)

This helps AI agents understand that your project uses Traffical and how to properly use feature flags and A/B tests.

## Global Options

```bash
-p, --profile <name>   # Use a specific profile from ~/.trafficalrc
-c, --config <path>    # Path to config file (default: .traffical/config.yaml)
-b, --api-base <url>   # API base URL (for self-hosted instances)
-j, --format <format>  # Output format: human (default) or json
-n, --dry-run          # Validate and preview changes without applying (push/sync)
```

## JSON Output

For scripting and CI/CD integration, use `--format json` to get machine-readable output:

```bash
# Get status as JSON
traffical status --format json

# Example output
{
  "project": { "id": "proj_xxx", "name": "My Project" },
  "org": { "id": "org_xxx", "name": "My Org" },
  "synced": [{ "key": "feature.enabled", "type": "boolean" }],
  "dashboardOnly": [],
  "localOnly": [],
  "hasDrift": false
}
```

## Environment Variables

For CI/CD pipelines, credentials can be provided via environment variables:

| Variable | Description |
|----------|-------------|
| `TRAFFICAL_API_KEY` | API key for authentication |
| `TRAFFICAL_API_BASE` | API base URL (optional, for self-hosted) |

**Priority order** (highest to lowest):
1. Command-line flags (`--api-key`, `--api-base`)
2. Environment variables (`TRAFFICAL_API_KEY`, `TRAFFICAL_API_BASE`)
3. Profile from `~/.trafficalrc`

## Exit Codes

For scripting and CI/CD integration:

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Validation error (invalid config file) |
| `2` | Authentication error (invalid or missing API key) |
| `3` | Network/API error |
| `10` | Config drift detected (status command) |
| `11` | Experiment needs attention |

## Profiles

API keys are stored in `~/.trafficalrc`:

```yaml
default_profile: default
profiles:
  default:
    api_key: tk_xxx
  staging:
    api_key: tk_yyy
    api_base: https://staging.traffical.io
```

Use with: `traffical push --profile staging`

## CI/CD Integration

The CLI is designed for CI/CD pipelines. Use environment variables for credentials and `--dry-run` for validation.

### Sync on Merge to Main

**Use case:** Automatically push parameter changes to Traffical when code is merged to main. This ensures your production parameters stay in sync with your codebase.

```yaml
# .github/workflows/traffical-sync.yml
name: Sync Traffical Config

on:
  push:
    branches: [main]
    paths:
      - '.traffical/**'

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Traffical CLI
        run: npm install -g @traffical/cli
      
      - name: Push to Traffical
        run: traffical push
        env:
          TRAFFICAL_API_KEY: ${{ secrets.TRAFFICAL_API_KEY }}
```

### Validate on Pull Request

**Use case:** Catch configuration errors before they're merged. The `--dry-run` flag validates the config and shows what would change without actually modifying anything.

```yaml
# .github/workflows/traffical-validate.yml
name: Validate Traffical Config

on:
  pull_request:
    paths:
      - '.traffical/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Traffical CLI
        run: npm install -g @traffical/cli
      
      - name: Validate Config (Dry Run)
        run: traffical push --dry-run
        env:
          TRAFFICAL_API_KEY: ${{ secrets.TRAFFICAL_API_KEY }}
```

### Drift Detection with JSON Output

**Use case:** Detect when someone changes parameters directly in the Traffical dashboard without updating the config file. Use JSON output for easier parsing.

```yaml
# .github/workflows/traffical-drift.yml
name: Check Traffical Drift

on:
  schedule:
    - cron: '0 9 * * *'  # Daily at 9am UTC

jobs:
  check-drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Traffical CLI
        run: npm install -g @traffical/cli
      
      - name: Check for Drift
        id: status
        run: |
          STATUS=$(traffical status --format json)
          echo "$STATUS"
          DRIFT=$(echo "$STATUS" | jq '.hasDrift')
          echo "drift=$DRIFT" >> $GITHUB_OUTPUT
        env:
          TRAFFICAL_API_KEY: ${{ secrets.TRAFFICAL_API_KEY }}
      
      - name: Create Issue on Drift
        if: steps.status.outputs.drift == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '⚠️ Traffical config drift detected',
              body: 'Parameters exist locally that are not synced to Traffical.\n\nRun `traffical status` locally to see details, then run `traffical push` to sync.'
            })
```

### Environment-Specific Deploys

**Use case:** Deploy different parameter configurations to staging and production environments, each with their own Traffical project.

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main, staging]

jobs:
  sync-traffical:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Traffical CLI
        run: npm install -g @traffical/cli
      
      - name: Sync to Staging
        if: github.ref == 'refs/heads/staging'
        run: traffical push
        env:
          TRAFFICAL_API_KEY: ${{ secrets.TRAFFICAL_API_KEY_STAGING }}
      
      - name: Sync to Production
        if: github.ref == 'refs/heads/main'
        run: traffical push
        env:
          TRAFFICAL_API_KEY: ${{ secrets.TRAFFICAL_API_KEY_PROD }}
```

## Learn More

- [Config-as-Code Documentation](https://docs.traffical.io/config-as-code)
- [Parameter Schema Reference](https://docs.traffical.io/config-as-code/schema)
