/**
 * SKILL.md Generator
 *
 * Generates Claude Code Agent Skill file for the .claude/skills/traffical directory.
 * This file is automatically discovered by Claude Code and provides experimentation
 * expertise to AI agents working on the project.
 *
 * See: https://docs.anthropic.com/en/docs/claude-code/skills
 */

import type { Framework, Language } from "./detection.ts";
import { getSdkPackage, isFullStackFramework, getFrameworkDisplayName } from "./detection.ts";
import type { ConfigParameter } from "./types.ts";

export interface SkillMdOptions {
  projectName: string;
  orgName: string;
  framework: Framework;
  language: Language;
  parameters: Record<string, ConfigParameter>;
}

/**
 * Generate the complete SKILL.md content with YAML frontmatter.
 */
export function generateSkillMd(options: SkillMdOptions): string {
  const { projectName, orgName, framework, language, parameters } = options;
  const sdkPackage = getSdkPackage(framework);
  const frameworkName = getFrameworkDisplayName(framework);
  const isFullStack = isFullStackFramework(framework);

  const sections = [
    generateFrontmatter(),
    generateHeader(projectName, orgName, frameworkName, sdkPackage),
    generateMentalModel(),
    generateWhenToUse(),
    generateQuickStart(framework, isFullStack),
    generateTrackingModes(),
    generateCLICommands(),
    generateNamingConventions(),
    generateParameterList(parameters),
    generateBestPractices(),
    generateWhatYouDontNeedToKnow(),
    generateReferences(),
  ];

  return sections.join("\n\n");
}

function generateFrontmatter(): string {
  return `---
name: traffical
description: Feature flags and A/B testing with Traffical. Use when adding features, modifying UI, changing algorithms, or anything affecting conversions. Check this skill when implementing new functionality that could benefit from gradual rollout or experimentation.
---`;
}

function generateHeader(
  projectName: string,
  orgName: string,
  frameworkName: string,
  sdkPackage: string
): string {
  return `# Traffical Experimentation Guide

This project uses **Traffical** for feature flags, A/B testing, and experimentation.

## Quick Reference

| Resource | Location |
|----------|----------|
| **Project** | ${projectName} (${orgName}) |
| **Parameters** | [\`.traffical/config.yaml\`](../../.traffical/config.yaml) |
| **Templates** | [\`.traffical/TEMPLATES.md\`](../../.traffical/TEMPLATES.md) |
| **SDK Package** | \`${sdkPackage}\` |
| **Framework** | ${frameworkName} |`;
}

function generateMentalModel(): string {
  return `## Mental Model

Traffical is **parameter-first**. You define parameters with defaults, and Traffical handles the rest.

\`\`\`
┌─────────────────────────────────────────────────────────────────────┐
│  Your Code                                                          │
│                                                                     │
│  1. Define parameters with defaults                                 │
│  2. Use the resolved values                                         │
│  3. Track rewards on conversion                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ▲
                              │  (hidden from you)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Traffical                                                          │
│                                                                     │
│  • Layers & policies for mutual exclusivity                         │
│  • Bucket assignment & deterministic hashing                        │
│  • Thompson Sampling & contextual bandits                           │
│  • Statistical analysis & optimization                              │
└─────────────────────────────────────────────────────────────────────┘
\`\`\`

**Key Insights:**

1. **Parameters, Not Experiments** — You define parameters with defaults. Experiments, feature flags, and optimizations are policies that control parameter assignment. Your code doesn't need to know which.

2. **Resolution Is Synchronous** — The SDK fetches a config bundle once and caches it. Every \`useTraffical()\` call resolves instantly from cache (no network latency, no render flicker on navigation).

3. **Track Events for Learning** — Call \`track()\` when valuable actions happen (purchase, signup, etc.). Traffical uses this data for adaptive optimization.`;
}

function generateWhenToUse(): string {
  return `## When to Use Traffical

| Scenario | Action |
|----------|--------|
| Adding a new feature | Wrap in feature flag for gradual rollout |
| Changing existing UI | A/B test against current implementation |
| Modifying conversion paths | Experiment with success metrics |
| Updating algorithms/logic | Test impact before full rollout |
| Anything affecting revenue | Always experiment first |

### Before Creating New Parameters

1. Check [\`.traffical/config.yaml\`](../../.traffical/config.yaml) for existing parameters
2. Use code patterns from [\`.traffical/TEMPLATES.md\`](../../.traffical/TEMPLATES.md)
3. Follow naming conventions (see below)`;
}

function generateQuickStart(framework: Framework, isFullStack: boolean): string {
  let content = "## Quick Start Code\n\n";

  switch (framework) {
    case "react":
    case "nextjs":
      content += generateReactQuickStart(isFullStack);
      break;
    case "svelte":
    case "sveltekit":
      content += generateSvelteQuickStart(isFullStack);
      break;
    case "vue":
    case "nuxt":
      content += generateVueQuickStart(isFullStack);
      break;
    case "node":
    default:
      content += generateNodeQuickStart();
      break;
  }

  return content;
}

function generateReactQuickStart(isFullStack: boolean): string {
  let content = `### Feature Flag

\`\`\`tsx
import { useTraffical } from "@traffical/react";

function MyComponent() {
  const { params } = useTraffical({
    defaults: {
      "feature.new_checkout": false,
    },
  });

  if (params["feature.new_checkout"]) {
    return <NewCheckout />;
  }
  return <CurrentCheckout />;
}
\`\`\`

### A/B Test with Event Tracking

\`\`\`tsx
import { useTraffical } from "@traffical/react";

function ProductPage() {
  const { params, track } = useTraffical({
    defaults: {
      "ui.cta.text": "Buy Now",
      "ui.cta.color": "#2563eb",
      "pricing.showDiscount": true,
    },
  });

  const handlePurchase = (amount: number) => {
    // track() has the decisionId automatically bound
    track("purchase", { value: amount });
  };

  return (
    <button 
      style={{ backgroundColor: params["ui.cta.color"] }}
      onClick={() => handlePurchase(99)}
    >
      {params["ui.cta.text"]}
    </button>
  );
}
\`\`\``;

  if (isFullStack) {
    content += `

### Server-Side

\`\`\`typescript
import { createTrafficalClient } from "@traffical/node";

const traffical = await createTrafficalClient({
  projectId: process.env.TRAFFICAL_PROJECT_ID!,
  apiKey: process.env.TRAFFICAL_API_KEY!,
});

const params = traffical.getParams({
  context: { userId: user.id },
  defaults: {
    "pricing.discount": 0,
  },
});
\`\`\``;
  }

  return content;
}

function generateSvelteQuickStart(isFullStack: boolean): string {
  let content = `### Feature Flag

\`\`\`svelte
<script lang="ts">
  import { getTraffical } from "@traffical/svelte";

  const { params } = getTraffical({
    defaults: {
      "feature.new_checkout": false,
    },
  });
</script>

{#if $params["feature.new_checkout"]}
  <NewCheckout />
{:else}
  <CurrentCheckout />
{/if}
\`\`\`

### A/B Test with Event Tracking

\`\`\`svelte
<script lang="ts">
  import { useTraffical } from "@traffical/svelte";

  const { params, track } = useTraffical({
    defaults: {
      "ui.cta.text": "Buy Now",
      "ui.cta.color": "#2563eb",
    },
  });

  function handlePurchase(amount: number) {
    // track() has the decisionId automatically bound
    track("purchase", { value: amount });
  }
</script>

<button
  style="background-color: {$params['ui.cta.color']}"
  on:click={() => handlePurchase(99)}
>
  {$params["ui.cta.text"]}
</button>
\`\`\``;

  if (isFullStack) {
    content += `

### Server-Side (+page.server.ts)

\`\`\`typescript
import { createTrafficalClient } from "@traffical/node";
import type { PageServerLoad } from "./$types";

const traffical = await createTrafficalClient({
  projectId: process.env.TRAFFICAL_PROJECT_ID!,
  apiKey: process.env.TRAFFICAL_API_KEY!,
});

export const load: PageServerLoad = async ({ locals }) => {
  const params = traffical.getParams({
    context: { userId: locals.user?.id },
    defaults: {
      "pricing.discount": 0,
    },
  });

  return { discount: params["pricing.discount"] };
};
\`\`\``;
  }

  return content;
}

function generateVueQuickStart(isFullStack: boolean): string {
  let content = `### Feature Flag

\`\`\`vue
<script setup lang="ts">
import { useTraffical } from "@traffical/vue";

const { params } = useTraffical({
  defaults: {
    "feature.new_checkout": false,
  },
});
</script>

<template>
  <NewCheckout v-if="params['feature.new_checkout']" />
  <CurrentCheckout v-else />
</template>
\`\`\`

### A/B Test with Event Tracking

\`\`\`vue
<script setup lang="ts">
import { useTraffical } from "@traffical/vue";

const { params, track } = useTraffical({
  defaults: {
    "ui.cta.text": "Buy Now",
    "ui.cta.color": "#2563eb",
  },
});

function handlePurchase(amount: number) {
  // track() has the decisionId automatically bound
  track("purchase", { value: amount });
}
</script>

<template>
  <button
    :style="{ backgroundColor: params['ui.cta.color'] }"
    @click="handlePurchase(99)"
  >
    {{ params["ui.cta.text"] }}
  </button>
</template>
\`\`\``;

  if (isFullStack) {
    content += `

### Server-Side (Nuxt)

\`\`\`typescript
import { createTrafficalClient } from "@traffical/node";

const traffical = await createTrafficalClient({
  projectId: process.env.TRAFFICAL_PROJECT_ID!,
  apiKey: process.env.TRAFFICAL_API_KEY!,
});

export default defineEventHandler(async (event) => {
  const params = traffical.getParams({
    context: { userId: event.context.user?.id },
    defaults: {
      "pricing.discount": 0,
    },
  });

  return { discount: params["pricing.discount"] };
});
\`\`\``;
  }

  return content;
}

function generateNodeQuickStart(): string {
  return `### Server-Side

\`\`\`typescript
import { createTrafficalClient } from "@traffical/node";

const traffical = await createTrafficalClient({
  projectId: process.env.TRAFFICAL_PROJECT_ID!,
  apiKey: process.env.TRAFFICAL_API_KEY!,
});

// Get parameter values
const params = traffical.getParams({
  context: { userId: user.id },
  defaults: {
    "feature.new_algorithm": false,
    "pricing.discount": 0,
  },
});

if (params["feature.new_algorithm"]) {
  // Use new implementation
}

// Track conversions
traffical.track("purchase", { value: order.total }, { unitKey: user.id });
\`\`\``;
}

function generateTrackingModes(): string {
  return `## Tracking Modes

The \`useTraffical()\` hook supports three tracking modes:

| Mode | Decision Event | Exposure Event | Use Case |
|------|----------------|----------------|----------|
| \`"full"\` (default) | ✅ Auto | ✅ Auto | UI shown to users |
| \`"decision"\` | ✅ Auto | 🔧 Manual | Below-the-fold, lazy-loaded content |
| \`"none"\` | ❌ No | ❌ No | SSR, internal logic, tests |

\`\`\`tsx
// Default: full tracking (recommended for most cases)
const { params } = useTraffical({
  defaults: { "feature.new_checkout": false },
});

// Manual exposure tracking (for below-the-fold content)
const { params, trackExposure } = useTraffical({
  defaults: { "feature.new_checkout": false },
  tracking: "decision",
});
// Call trackExposure() when content becomes visible

// No tracking (SSR, internal logic, tests)
const { params } = useTraffical({
  defaults: { "feature.new_checkout": false },
  tracking: "none",
});
\`\`\``;
}

function generateCLICommands(): string {
  return `## CLI Commands

\`\`\`bash
# Check sync status
traffical status

# Push local changes to Traffical
traffical push

# Pull remote changes to local
traffical pull

# Bidirectional sync (local wins)
traffical sync

# Import dashboard parameters
traffical import "ui.*"
\`\`\``;
}

function generateNamingConventions(): string {
  return `## Parameter Naming Conventions

Use dot notation: \`category.subcategory.name\`

| Category | Examples | Use Case |
|----------|----------|----------|
| \`feature.*\` | \`feature.new_checkout\`, \`feature.dark_mode\` | Feature flags (boolean) |
| \`ui.*\` | \`ui.cta.text\`, \`ui.hero.variant\` | Visual variations |
| \`pricing.*\` | \`pricing.discount\`, \`pricing.tier_multiplier\` | Pricing experiments |
| \`copy.*\` | \`copy.headline\`, \`copy.cta_text\` | Copywriting tests |
| \`experiment.*\` | \`experiment.checkout.variant\` | Explicit variant names |
| \`bugfix.*\` | \`bugfix.cart_calculation_v2\` | Safe rollout of fixes |`;
}

function generateParameterList(parameters: Record<string, ConfigParameter>): string {
  const keys = Object.keys(parameters);

  if (keys.length === 0) {
    return `## Current Parameters

No parameters configured yet. Add them to [\`.traffical/config.yaml\`](../../.traffical/config.yaml).`;
  }

  const rows = keys.map((key) => {
    const param = parameters[key]!;
    const defaultStr = JSON.stringify(param.default);
    const desc = param.description ? ` - ${param.description}` : "";
    return `| \`${key}\` | ${param.type} | \`${defaultStr}\`${desc} |`;
  });

  return `## Current Parameters

| Parameter | Type | Default |
|-----------|------|---------|
${rows.join("\n")}

See [\`.traffical/config.yaml\`](../../.traffical/config.yaml) for full configuration.`;
}

function generateBestPractices(): string {
  return `## Best Practices for AI Agents

1. **Use \`useTraffical()\` by default** — Full tracking is enabled automatically. No need to think about decision events.

2. **Always provide defaults** — These are used when no experiment is running, during SSR, and as fallback values.

3. **Call \`track()\` at conversion points** — This enables learning. Track purchases, signups, and other valuable actions.

4. **Check existing parameters first** — Look in [\`.traffical/config.yaml\`](../../.traffical/config.yaml) before creating new ones.

5. **Group related parameters** — Keep correlated params in one \`useTraffical()\` call for proper attribution.

6. **Use meaningful param names** — Follow dot notation: \`category.subcategory.name\``;
}

function generateWhatYouDontNeedToKnow(): string {
  return `## What You Don't Need to Know

These are internal concepts handled by Traffical automatically:

- **Layers, policies, allocations** — Experiment infrastructure is managed in the dashboard
- **Bucket assignment and hashing** — Deterministic user assignment happens automatically  
- **Whether an A/B test vs. optimization is running** — Your code is the same either way
- **Statistical significance calculations** — Traffical handles analysis in the background
- **Decision deduplication** — Multiple \`useTraffical()\` calls are handled efficiently

**Just parametrize your app and call \`track()\` on conversions. Traffical handles the rest.**`;
}

function generateReferences(): string {
  return `## References

- **Configuration**: [\`.traffical/config.yaml\`](../../.traffical/config.yaml)
- **Code Templates**: [\`.traffical/TEMPLATES.md\`](../../.traffical/TEMPLATES.md)
- **Documentation**: https://docs.traffical.io/config-as-code
- **Dashboard**: https://app.traffical.io`;
}
