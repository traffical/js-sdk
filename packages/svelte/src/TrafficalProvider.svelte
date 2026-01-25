<!--
  @traffical/svelte - TrafficalProvider Component

  Wrapper component that initializes the Traffical context.
  Alternative to calling initTraffical() directly in your layout.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import type { Snippet } from "svelte";
  import { initTraffical } from "./context.svelte.js";
  import type { TrafficalProviderConfig } from "./types.js";

  interface Props {
    /** Configuration for the Traffical client */
    config: TrafficalProviderConfig;
    /** Child content */
    children: Snippet;
  }

  let { config, children }: Props = $props();

  // Initialize context - this sets up the client and makes it available to children
  // Note: Client is created but initialize() is NOT called yet to avoid SSR fetch warnings
  const context = initTraffical(config);

  // Initialize the client ONLY on the client-side after mount
  // This prevents the "Avoid calling fetch eagerly during SSR" warning
  onMount(() => {
    // Only fetch fresh config if we don't have an initial bundle,
    // or if we want to refresh in the background
    context.initializeClient();
  });

  // Cleanup on component destroy
  $effect(() => {
    return () => {
      // Destroy client when provider unmounts
      context.client?.destroy();
    };
  });
</script>

{@render children()}

