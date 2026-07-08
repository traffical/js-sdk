/**
 * @traffical/openfeature-web
 *
 * OpenFeature WEB (static-context) provider backed by the Traffical browser SDK
 * (`@traffical/js-client`). Milestone M3.
 *
 * See `ng/docs/design/openfeature-provider-design.md` §2, §3, §5, §6, §7, §9, §13.
 */

export { TrafficalWebProvider, default } from "./provider.js";
export type { TrafficalWebClient } from "./provider.js";

// Re-export the frozen shared contract types so integrators can type against
// the provider options / client shape without a second import.
export type {
  TrafficalProviderOptions,
  TrafficalClientLike,
  OFFlagType,
} from "@traffical/openfeature-core";
export { EXPOSURE_EVENT_NAME, FLAG_METADATA_PREFIX } from "@traffical/openfeature-core";
