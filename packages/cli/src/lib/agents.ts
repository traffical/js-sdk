/**
 * AGENTS.md Generator
 *
 * Generates framework-specific AI agent instruction files.
 * AGENTS.md lives at the project root (for OpenAI Codex CLI compatibility).
 *
 * If AGENTS.md already exists, the Traffical section is appended or updated.
 */

import type { Framework, Language } from "./detection.ts";
import { getSdkPackage, isFullStackFramework, getFrameworkDisplayName } from "./detection.ts";
import type { ConfigParameter } from "./types.ts";
import {
  TRAFFICAL_AGENTS_MARKER,
  TRAFFICAL_AGENTS_MARKER_END,
} from "./config.ts";

export interface AgentsMdOptions {
  projectName: string;
  orgName: string;
  framework: Framework;
  language: Language;
  parameters: Record<string, ConfigParameter>;
}

/**
 * Generate the Traffical section content (without markers).
 */
function generateTrafficalSection(options: AgentsMdOptions): string {
  const { projectName, orgName, framework, language, parameters } = options;
  const sdkPackage = getSdkPackage(framework);
  const frameworkName = getFrameworkDisplayName(framework);
  const isFullStack = isFullStackFramework(framework);

  const sections = [
    generateHeader(projectName, orgName, frameworkName, sdkPackage),
    generateMentalModel(),
    generateWhenToUse(),
    generateUsageSection(framework, language, isFullStack),
    generateTrackingModes(),
    generateCLICommands(),
    generateNamingConventions(),
    generateParameterList(parameters),
    generateBestPractices(),
    generateWhatYouDontNeedToKnow(),
  ];

  return sections.join("\n\n");
}

/**
 * Generate the complete AGENTS.md content (for new files).
 */
export function generateAgentsMd(options: AgentsMdOptions): string {
  const content = generateTrafficalSection(options);
  return `${TRAFFICAL_AGENTS_MARKER}\n${content}\n${TRAFFICAL_AGENTS_MARKER_END}\n`;
}

/**
 * Generate Traffical section to append to an existing AGENTS.md.
 */
export function generateAgentsMdAppend(options: AgentsMdOptions): string {
  const content = generateTrafficalSection(options);
  return `\n\n---\n\n${TRAFFICAL_AGENTS_MARKER}\n${content}\n${TRAFFICAL_AGENTS_MARKER_END}\n`;
}

/**
 * Update an existing AGENTS.md by replacing the Traffical section.
 * If no Traffical section exists, appends it.
 *
 * @param existingContent - The current content of AGENTS.md
 * @param options - Options for generating the Traffical section
 * @returns Updated content
 */
export function updateAgentsMd(existingContent: string, options: AgentsMdOptions): string {
  const markerPattern = new RegExp(
    `${escapeRegex(TRAFFICAL_AGENTS_MARKER)}[\\s\\S]*?${escapeRegex(TRAFFICAL_AGENTS_MARKER_END)}`,
    "g"
  );

  const newSection = `${TRAFFICAL_AGENTS_MARKER}\n${generateTrafficalSection(options)}\n${TRAFFICAL_AGENTS_MARKER_END}`;

  if (existingContent.includes(TRAFFICAL_AGENTS_MARKER)) {
    // Replace existing Traffical section
    return existingContent.replace(markerPattern, newSection);
  } else {
    // Append new section
    return existingContent.trimEnd() + `\n\n---\n\n${newSection}\n`;
  }
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function generateHeader(
  projectName: string,
  orgName: string,
  frameworkName: string,
  sdkPackage: string
): string {
  return `# Traffical Integration Guide

This project uses **Traffical** for feature flags, A/B testing, and experimentation.

## Quick Reference

| Resource | Location |
|----------|----------|
| **Project** | ${projectName} (${orgName}) |
| **Config** | \`.traffical/config.yaml\` |
| **SDK Package** | \`${sdkPackage}\` |
| **Framework** | ${frameworkName} |
| **Templates** | \`.traffical/TEMPLATES.md\` |`;
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

2. **Resolution Is Local** — The SDK fetches a config bundle once and caches it. Every \`useTraffical()\` call resolves instantly from cache (sub-millisecond, no network latency).

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

**Before creating new parameters:**
1. Check \`.traffical/config.yaml\` for existing parameters
2. Use code patterns from \`.traffical/TEMPLATES.md\``;
}

function generateUsageSection(
  framework: Framework,
  language: Language,
  isFullStack: boolean
): string {
  const sections: string[] = ["## Usage Examples"];

  switch (framework) {
    case "react":
    case "nextjs":
      sections.push(generateReactUsage(isFullStack));
      break;
    case "svelte":
    case "sveltekit":
      sections.push(generateSvelteUsage(isFullStack));
      break;
    case "vue":
    case "nuxt":
      sections.push(generateVueUsage(isFullStack));
      break;
    case "node":
    default:
      sections.push(generateNodeUsage());
      break;
  }

  return sections.join("\n\n");
}

function generateReactUsage(isFullStack: boolean): string {
  let content = `### Client-Side (React Components)

\`\`\`tsx
import { useTraffical } from "@traffical/react";

function ProductPage() {
  // Define parameters with defaults
  const { params } = useTraffical({
    defaults: {
      "feature.new_checkout": false,
      "ui.cta.text": "Buy Now",
      "ui.cta.color": "#2563eb",
    },
  });

  // Track events at conversion (track() has decisionId automatically bound)
  const handlePurchase = (amount: number) => {
    track("purchase", { value: amount });
  };

  if (params["feature.new_checkout"]) {
    return <NewCheckout onComplete={handlePurchase} />;
  }
  
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

### Server-Side (API Routes, Server Actions)

\`\`\`typescript
import { createTrafficalClient } from "@traffical/node";

const traffical = await createTrafficalClient({
  projectId: process.env.TRAFFICAL_PROJECT_ID!,
  apiKey: process.env.TRAFFICAL_API_KEY!,
});

// In a server function or API route
const params = traffical.getParams({
  context: { userId: user.id },
  defaults: {
    "pricing.discount": 0,
    "feature.new_algorithm": false,
  },
});

const discount = params["pricing.discount"];
\`\`\``;
  }

  return content;
}

function generateSvelteUsage(isFullStack: boolean): string {
  let content = `### Client-Side (Svelte Components)

\`\`\`svelte
<script lang="ts">
  import { useTraffical } from "@traffical/svelte";

  const { params, track } = useTraffical({
    defaults: {
      "feature.new_checkout": false,
      "ui.cta.text": "Buy Now",
      "ui.cta.color": "#2563eb",
    },
  });

  function handlePurchase(amount: number) {
    // track() has decisionId automatically bound
    track("purchase", { value: amount });
  }
</script>

{#if $params["feature.new_checkout"]}
  <NewCheckout on:complete={() => handlePurchase(99)} />
{:else}
  <button
    style="background-color: {$params['ui.cta.color']}"
    on:click={() => handlePurchase(99)}
  >
    {$params["ui.cta.text"]}
  </button>
{/if}
\`\`\``;

  if (isFullStack) {
    content += `

### Server-Side (+page.server.ts, +server.ts)

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

  return {
    discount: params["pricing.discount"],
  };
};
\`\`\``;
  }

  return content;
}

function generateVueUsage(isFullStack: boolean): string {
  let content = `### Client-Side (Vue Components)

\`\`\`vue
<script setup lang="ts">
import { useTraffical } from "@traffical/vue";

const { params, track } = useTraffical({
  defaults: {
    "feature.new_checkout": false,
    "ui.cta.text": "Buy Now",
    "ui.cta.color": "#2563eb",
  },
});

function handlePurchase(amount: number) {
  // track() has decisionId automatically bound
  track("purchase", { value: amount });
}
</script>

<template>
  <NewCheckout v-if="params['feature.new_checkout']" @complete="handlePurchase(99)" />
  <button
    v-else
    :style="{ backgroundColor: params['ui.cta.color'] }"
    @click="handlePurchase(99)"
  >
    {{ params["ui.cta.text"] }}
  </button>
</template>
\`\`\``;

  if (isFullStack) {
    content += `

### Server-Side (Nuxt Server Routes)

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

  return {
    discount: params["pricing.discount"],
  };
});
\`\`\``;
  }

  return content;
}

function generateNodeUsage(): string {
  return `### Server-Side (Node.js)

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
| \`experiment.*\` | \`experiment.checkout.variant\` | Explicit variant names |`;
}

function generateParameterList(parameters: Record<string, ConfigParameter>): string {
  const keys = Object.keys(parameters);

  if (keys.length === 0) {
    return `## Current Parameters

No parameters configured yet. Add them to \`.traffical/config.yaml\`.`;
  }

  const rows = keys.map((key) => {
    const param = parameters[key]!;
    const defaultStr = JSON.stringify(param.default);
    return `| \`${key}\` | ${param.type} | \`${defaultStr}\` |`;
  });

  return `## Current Parameters

| Parameter | Type | Default |
|-----------|------|---------|
${rows.join("\n")}`;
}

function generateBestPractices(): string {
  return `## Best Practices for AI Agents

1. **Use \`useTraffical()\` by default** — Full tracking is enabled automatically. No need to think about decision events.

2. **Always provide defaults** — These are used when no experiment is running, during SSR, and as fallback values.

3. **Call \`track()\` at conversion points** — This enables learning. Track purchases, signups, and other valuable actions.

4. **Check existing parameters first** — Look in \`.traffical/config.yaml\` before creating new ones.

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
