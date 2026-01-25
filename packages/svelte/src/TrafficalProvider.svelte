<!--
  @traffical/svelte - TrafficalProvider Component

  Wrapper component that initializes the Traffical context.
  Alternative to calling initTraffical() directly in your layout.
-->
<script lang="ts">
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
  const context = initTraffical(config);

  // Cleanup on component destroy
  $effect(() => {
    return () => {
      // Destroy client when provider unmounts
      context.client?.destroy();
    };
  });
</script>

{@render children()}

