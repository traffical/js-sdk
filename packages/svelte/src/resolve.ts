/**
 * @traffical/svelte - Pure resolution helpers
 *
 * Rune-free, side-effect-free helpers shared by the `useTraffical` hook. Kept
 * in a plain `.ts` module (not `.svelte.ts`) so they can be unit-tested under
 * `bun test` without the Svelte compiler, and so the CSR resolution contract is
 * covered by a regression test independent of the runes runtime.
 */

import { resolveParameters, decide as coreDecide } from "@traffical/core";
import type {
  ConfigBundle,
  Context,
  DecisionResult,
  ParameterValue,
} from "@traffical/core";
import type { TrafficalClient } from "@traffical/js-client";

/**
 * The reactive sources a hook resolves against. `bundle` is the provider's
 * locally-tracked config (updated after the client's fetch); `client` is the
 * live SDK client.
 */
export interface ParamSources {
  client: TrafficalClient | null;
  bundle: ConfigBundle | null;
  initialParams?: Record<string, unknown>;
  getContext: () => Context;
}

/**
 * Resolve parameters for a call site.
 *
 * The key CSR fix: once a `client` exists we ALWAYS trust `client.getParams`,
 * regardless of the provider's locally-tracked `bundle`. The client falls back
 * to its own `localConfig` / freshly-fetched bundle / the supplied defaults
 * internally, so a client-side render that mounts without an `initialBundle`
 * still resolves real params after the first fetch — the previous
 * `client && bundle` gate stranded params at defaults because `bundle` started
 * null and was never updated.
 */
export function computeParamsFrom<T extends Record<string, ParameterValue>>(
  sources: ParamSources,
  options: { defaults: T; context?: Context }
): T {
  const { client, bundle, initialParams, getContext } = sources;

  if (client) {
    return client.getParams({
      context: { ...getContext(), ...options.context },
      defaults: options.defaults,
    }) as T;
  }

  if (bundle) {
    return resolveParameters(
      bundle,
      { ...getContext(), ...options.context },
      options.defaults
    );
  }

  if (initialParams) {
    return { ...options.defaults, ...initialParams } as T;
  }

  return options.defaults;
}

/**
 * Make a decision for a call site, or `null` when decisions shouldn't be
 * tracked / no config is available yet. Decisions are gated on a usable config
 * (`bundle`) so we never emit a decision event that resolved purely against
 * defaults; the provider keeps `bundle` in sync via the client's config-update
 * hook, so this becomes non-null as soon as the first config lands.
 */
export function computeDecisionFrom<T extends Record<string, ParameterValue>>(
  sources: ParamSources,
  options: { defaults: T; context?: Context; shouldTrackDecision: boolean }
): DecisionResult | null {
  const { client, bundle, getContext } = sources;
  if (!options.shouldTrackDecision) return null;
  if (!bundle) return null;

  const context: Context = { ...getContext(), ...options.context };

  if (client) {
    return client.decide({ context, defaults: options.defaults });
  }
  return coreDecide(bundle, context, options.defaults);
}
