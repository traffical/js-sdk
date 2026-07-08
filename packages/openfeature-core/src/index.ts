/**
 * @traffical/openfeature-core
 *
 * Pure, paradigm-agnostic translation layer between Traffical's decision model
 * and OpenFeature's evaluation model. The server and web OpenFeature providers
 * both depend on this package; its public API is a contract.
 */

export { EXPOSURE_EVENT_NAME, FLAG_METADATA_PREFIX } from "./constants.js";

export type {
  OFFlagType,
  TrafficalProviderOptions,
  TrafficalClientLike,
} from "./types.js";

export { buildTrafficalContext } from "./context.js";

export {
  selectOwnerLayer,
  deriveReason,
  buildFlagMetadata,
  toResolutionDetails,
} from "./translate.js";
