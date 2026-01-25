/**
 * Template management - writes framework-specific TEMPLATES.md files
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Framework } from "./detection";

// Embedded template content for each framework
const TEMPLATES: Record<string, string> = {
  react: `# Traffical React Integration

Code patterns for React and Next.js projects.

## Feature Flag

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

## A/B Test with Event Tracking

\`\`\`tsx
import { useTraffical } from "@traffical/react";

function ProductPage() {
  const { params, track } = useTraffical({
    defaults: {
      "ui.cta.text": "Buy Now",
      "ui.cta.color": "#2563eb",
      "pricing.discount": 0,
    },
  });

  const handlePurchase = (amount: number) => {
    // track() has the decisionId automatically bound
    track("purchase", { value: amount, itemId: "prod_123" });
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
\`\`\`

## Tracking Modes

\`\`\`tsx
// Default: full tracking (recommended)
const { params } = useTraffical({
  defaults: { "feature.new_checkout": false },
});

// Manual exposure tracking (below-the-fold content)
const { params, trackExposure } = useTraffical({
  defaults: { "feature.new_checkout": false },
  tracking: "decision",
});
// Call trackExposure() when visible

// No tracking (SSR, tests)
const { params } = useTraffical({
  defaults: { "feature.new_checkout": false },
  tracking: "none",
});
\`\`\`

## Server-Side (Next.js)

\`\`\`typescript
import { createTrafficalClient } from "@traffical/node";

const traffical = await createTrafficalClient({
  projectId: process.env.TRAFFICAL_PROJECT_ID!,
  apiKey: process.env.TRAFFICAL_API_KEY!,
});

// In API route or server action
const params = traffical.getParams({
  context: { userId: user.id },
  defaults: {
    "pricing.discount": 0,
  },
});

// Track conversion
traffical.track("purchase", { value: orderTotal }, { unitKey: user.id });
\`\`\`
`,

  nextjs: `# Traffical Next.js Integration

Code patterns for Next.js projects (App Router and Pages Router).

## Client Component

\`\`\`tsx
"use client";

import { useTraffical } from "@traffical/react";

export function ProductPage() {
  const { params, track } = useTraffical({
    defaults: {
      "feature.new_checkout": false,
      "ui.cta.text": "Buy Now",
      "ui.cta.color": "#2563eb",
    },
  });

  const handlePurchase = (amount: number) => {
    // track() has the decisionId automatically bound
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
\`\`\`

## Tracking Modes

\`\`\`tsx
// Default: full tracking (recommended)
const { params } = useTraffical({
  defaults: { "feature.new_checkout": false },
});

// Manual exposure tracking (below-the-fold content)
const { params, trackExposure } = useTraffical({
  defaults: { "feature.new_checkout": false },
  tracking: "decision",
});
// Call trackExposure() when visible

// No tracking (SSR, tests)
const { params } = useTraffical({
  defaults: { "feature.new_checkout": false },
  tracking: "none",
});
\`\`\`

## Server Component / Server Action

\`\`\`typescript
import { createTrafficalClient } from "@traffical/node";

const traffical = await createTrafficalClient({
  projectId: process.env.TRAFFICAL_PROJECT_ID!,
  apiKey: process.env.TRAFFICAL_API_KEY!,
});

// In Server Component or Server Action
export async function getProductData(userId: string) {
  const params = traffical.getParams({
    context: { userId },
    defaults: {
      "pricing.discount": 0,
      "feature.show_reviews": true,
    },
  });

  return {
    discount: params["pricing.discount"],
    showReviews: params["feature.show_reviews"],
  };
}
\`\`\`

## API Route

\`\`\`typescript
import { createTrafficalClient } from "@traffical/node";
import { NextResponse } from "next/server";

const traffical = await createTrafficalClient({
  projectId: process.env.TRAFFICAL_PROJECT_ID!,
  apiKey: process.env.TRAFFICAL_API_KEY!,
});

export async function POST(request: Request) {
  const { userId, orderTotal } = await request.json();

  // Track conversion
  traffical.track("purchase", { value: orderTotal }, { unitKey: userId });

  return NextResponse.json({ success: true });
}
\`\`\`

## Middleware

\`\`\`typescript
import { createTrafficalClient } from "@traffical/node";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const traffical = await createTrafficalClient({
  projectId: process.env.TRAFFICAL_PROJECT_ID!,
  apiKey: process.env.TRAFFICAL_API_KEY!,
});

export function middleware(request: NextRequest) {
  const userId = request.cookies.get("userId")?.value || "anonymous";

  const params = traffical.getParams({
    context: { userId },
    defaults: {
      "feature.new_landing": false,
    },
  });

  if (params["feature.new_landing"]) {
    return NextResponse.rewrite(new URL("/landing-v2", request.url));
  }

  return NextResponse.next();
}
\`\`\`
`,

  svelte: `# Traffical Svelte Integration

Code patterns for Svelte projects.

## Feature Flag

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

## A/B Test with Event Tracking

\`\`\`svelte
<script lang="ts">
  import { useTraffical } from "@traffical/svelte";

  const { params, track } = useTraffical({
    defaults: {
      "ui.cta.text": "Buy Now",
      "ui.cta.color": "#2563eb",
      "pricing.discount": 0,
    },
  });

  function handlePurchase(amount: number) {
    // track() has the decisionId automatically bound
    track("purchase", { value: amount });
  }
</script>

<button
  style="background-color: {params['ui.cta.color']}"
  onclick={() => handlePurchase(99)}
>
  {params["ui.cta.text"]}
</button>
\`\`\`

## Tracking Modes

\`\`\`svelte
<script lang="ts">
  import { getTraffical } from "@traffical/svelte";

  // Default: full tracking (recommended)
  const { params } = getTraffical({
    defaults: { "feature.new_checkout": false },
  });

  // Manual exposure tracking (below-the-fold content)
  const { params, trackExposure } = getTraffical({
    defaults: { "feature.new_checkout": false },
    tracking: "decision",
  });
  // Call trackExposure() when visible

  // No tracking (SSR, tests)
  const { params } = getTraffical({
    defaults: { "feature.new_checkout": false },
    tracking: "none",
  });
</script>
\`\`\`
`,

  sveltekit: `# Traffical SvelteKit Integration

Code patterns for SvelteKit projects.

## Client-Side Component

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
    // track() has the decisionId automatically bound
    track("purchase", { value: amount });
  }
</script>

{#if params["feature.new_checkout"]}
  <NewCheckout onComplete={() => handlePurchase(99)} />
{:else}
  <button
    style="background-color: {params['ui.cta.color']}"
    onclick={() => handlePurchase(99)}
  >
    {params["ui.cta.text"]}
  </button>
{/if}
\`\`\`

## Tracking Modes

\`\`\`svelte
<script lang="ts">
  import { getTraffical } from "@traffical/svelte";

  // Default: full tracking (recommended)
  const { params } = getTraffical({
    defaults: { "feature.new_checkout": false },
  });

  // Manual exposure tracking (below-the-fold content)
  const { params, trackExposure } = getTraffical({
    defaults: { "feature.new_checkout": false },
    tracking: "decision",
  });
  // Call trackExposure() when visible

  // No tracking (SSR, tests)
  const { params } = getTraffical({
    defaults: { "feature.new_checkout": false },
    tracking: "none",
  });
</script>
\`\`\`

## Server Load Function (+page.server.ts)

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
      "feature.show_reviews": true,
    },
  });

  return {
    discount: params["pricing.discount"],
    showReviews: params["feature.show_reviews"],
  };
};
\`\`\`

## API Endpoint (+server.ts)

\`\`\`typescript
import { createTrafficalClient } from "@traffical/node";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const traffical = await createTrafficalClient({
  projectId: process.env.TRAFFICAL_PROJECT_ID!,
  apiKey: process.env.TRAFFICAL_API_KEY!,
});

export const POST: RequestHandler = async ({ request, locals }) => {
  const { orderTotal } = await request.json();

  // Track conversion
  traffical.track("purchase", { value: orderTotal }, { unitKey: locals.user?.id });

  return json({ success: true });
};
\`\`\`

## Hooks (hooks.server.ts)

\`\`\`typescript
import { createTrafficalClient } from "@traffical/node";
import type { Handle } from "@sveltejs/kit";

const traffical = await createTrafficalClient({
  projectId: process.env.TRAFFICAL_PROJECT_ID!,
  apiKey: process.env.TRAFFICAL_API_KEY!,
});

export const handle: Handle = async ({ event, resolve }) => {
  const userId = event.cookies.get("userId") || "anonymous";

  const params = traffical.getParams({
    context: { userId },
    defaults: {
      "feature.maintenance_mode": false,
    },
  });

  if (params["feature.maintenance_mode"]) {
    return new Response("Maintenance mode", { status: 503 });
  }

  return resolve(event);
};
\`\`\`
`,

  vue: `# Traffical Vue Integration

Code patterns for Vue projects.

## Feature Flag

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

## A/B Test with Event Tracking

\`\`\`vue
<script setup lang="ts">
import { useTraffical } from "@traffical/vue";

const { params, track } = useTraffical({
  defaults: {
    "ui.cta.text": "Buy Now",
    "ui.cta.color": "#2563eb",
    "pricing.discount": 0,
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
\`\`\`

## Tracking Modes

\`\`\`vue
<script setup lang="ts">
import { useTraffical } from "@traffical/vue";

// Default: full tracking (recommended)
const { params } = useTraffical({
  defaults: { "feature.new_checkout": false },
});

// Manual exposure tracking (below-the-fold content)
const { params, trackExposure } = useTraffical({
  defaults: { "feature.new_checkout": false },
  tracking: "decision",
});
// Call trackExposure() when visible

// No tracking (SSR, tests)
const { params } = useTraffical({
  defaults: { "feature.new_checkout": false },
  tracking: "none",
});
</script>
\`\`\`
`,

  nuxt: `# Traffical Nuxt Integration

Code patterns for Nuxt projects.

## Client-Side Component

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
  // track() has the decisionId automatically bound
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
\`\`\`

## Tracking Modes

\`\`\`vue
<script setup lang="ts">
import { useTraffical } from "@traffical/vue";

// Default: full tracking (recommended)
const { params } = useTraffical({
  defaults: { "feature.new_checkout": false },
});

// Manual exposure tracking (below-the-fold content)
const { params, trackExposure } = useTraffical({
  defaults: { "feature.new_checkout": false },
  tracking: "decision",
});
// Call trackExposure() when visible

// No tracking (SSR, tests)
const { params } = useTraffical({
  defaults: { "feature.new_checkout": false },
  tracking: "none",
});
</script>
\`\`\`

## Server Route (server/api/*.ts)

\`\`\`typescript
import { createTrafficalClient } from "@traffical/node";

const traffical = await createTrafficalClient({
  projectId: process.env.TRAFFICAL_PROJECT_ID!,
  apiKey: process.env.TRAFFICAL_API_KEY!,
});

export default defineEventHandler(async (event) => {
  const userId = event.context.user?.id || "anonymous";

  const params = traffical.getParams({
    context: { userId },
    defaults: {
      "pricing.discount": 0,
      "feature.show_reviews": true,
    },
  });

  return {
    discount: params["pricing.discount"],
    showReviews: params["feature.show_reviews"],
  };
});
\`\`\`

## Server Middleware (server/middleware/*.ts)

\`\`\`typescript
import { createTrafficalClient } from "@traffical/node";

const traffical = await createTrafficalClient({
  projectId: process.env.TRAFFICAL_PROJECT_ID!,
  apiKey: process.env.TRAFFICAL_API_KEY!,
});

export default defineEventHandler(async (event) => {
  const userId = getCookie(event, "userId") || "anonymous";

  const params = traffical.getParams({
    context: { userId },
    defaults: {
      "feature.maintenance_mode": false,
    },
  });

  if (params["feature.maintenance_mode"]) {
    throw createError({
      statusCode: 503,
      message: "Maintenance mode",
    });
  }
});
\`\`\`

## Conversion Tracking

\`\`\`typescript
export default defineEventHandler(async (event) => {
  const { orderTotal } = await readBody(event);
  const userId = event.context.user?.id;

  // Track conversion
  traffical.track("purchase", { value: orderTotal }, { unitKey: userId });

  return { success: true };
});
\`\`\`
`,

  node: `# Traffical Node.js Integration

Code patterns for Node.js backend projects.

## Setup

\`\`\`typescript
import { createTrafficalClient } from "@traffical/node";

const traffical = await createTrafficalClient({
  projectId: process.env.TRAFFICAL_PROJECT_ID!,
  apiKey: process.env.TRAFFICAL_API_KEY!,
});
\`\`\`

## Feature Flag

\`\`\`typescript
function processOrder(userId: string, order: Order) {
  const params = traffical.getParams({
    context: { userId },
    defaults: {
      "feature.new_algorithm": false,
    },
  });

  if (params["feature.new_algorithm"]) {
    return newAlgorithm(order);
  }
  return currentAlgorithm(order);
}
\`\`\`

## A/B Test with Conversion Tracking

\`\`\`typescript
function handleCheckout(userId: string, order: Order) {
  const params = traffical.getParams({
    context: { userId },
    defaults: {
      "pricing.discount": 0,
      "checkout.show_upsells": false,
    },
  });

  const finalPrice = order.total * (1 - params["pricing.discount"] / 100);

  // Process order...

  // Track conversion
  traffical.track("purchase", { value: finalPrice }, { unitKey: userId });

  return { success: true, total: finalPrice };
}
\`\`\`

## Express Middleware

\`\`\`typescript
import { createTrafficalClient } from "@traffical/node";
import express from "express";

const traffical = await createTrafficalClient({
  projectId: process.env.TRAFFICAL_PROJECT_ID!,
  apiKey: process.env.TRAFFICAL_API_KEY!,
});

const app = express();

// Middleware to attach params to request
app.use((req, res, next) => {
  const userId = req.user?.id || "anonymous";

  req.trafficalParams = traffical.getParams({
    context: { userId },
    defaults: {
      "feature.new_checkout": false,
      "api.rate_limit": 1000,
    },
  });

  next();
});

app.post("/checkout", (req, res) => {
  if (req.trafficalParams["feature.new_checkout"]) {
    // New checkout flow
  }

  // Track conversion
  traffical.track("purchase", { value: req.body.total }, { unitKey: req.user?.id });

  res.json({ success: true });
});
\`\`\`

## Fastify Plugin

\`\`\`typescript
import { createTrafficalClient } from "@traffical/node";
import Fastify from "fastify";

const traffical = await createTrafficalClient({
  projectId: process.env.TRAFFICAL_PROJECT_ID!,
  apiKey: process.env.TRAFFICAL_API_KEY!,
});

const app = Fastify();

app.decorateRequest("trafficalParams", null);

app.addHook("preHandler", async (request) => {
  const userId = request.user?.id || "anonymous";

  request.trafficalParams = traffical.getParams({
    context: { userId },
    defaults: {
      "feature.new_checkout": false,
    },
  });
});

app.post("/checkout", async (request, reply) => {
  if (request.trafficalParams["feature.new_checkout"]) {
    // New checkout flow
  }

  traffical.track("purchase", { value: request.body.total }, { unitKey: request.user?.id });

  return { success: true };
});
\`\`\`
`,
};

/**
 * Get template content for a framework
 */
function getTemplateContent(framework: Framework): string {
  switch (framework) {
    case "nextjs":
      return TEMPLATES.nextjs;
    case "react":
      return TEMPLATES.react;
    case "sveltekit":
      return TEMPLATES.sveltekit;
    case "svelte":
      return TEMPLATES.svelte;
    case "nuxt":
      return TEMPLATES.nuxt;
    case "vue":
      return TEMPLATES.vue;
    case "express":
    case "fastify":
    case "hono":
    case "node":
    default:
      return TEMPLATES.node;
  }
}

/**
 * Write the appropriate template file to the .traffical directory
 */
export async function copyTemplate(
  trafficalDir: string,
  framework: Framework
): Promise<string> {
  const content = getTemplateContent(framework);
  const destPath = join(trafficalDir, "TEMPLATES.md");

  await mkdir(trafficalDir, { recursive: true });
  await writeFile(destPath, content, "utf-8");

  return destPath;
}

/**
 * Get template content without writing (for preview)
 */
export function getTemplate(framework: Framework): string {
  return getTemplateContent(framework);
}
