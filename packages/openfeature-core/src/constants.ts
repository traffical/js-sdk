/**
 * Shared constants for the Traffical OpenFeature translation layer.
 */

/**
 * Reserved event name used by the OpenFeature providers to fire an explicit
 * Traffical exposure (ToT) signal via `client.track(...)`. A `track()` call
 * with this name is routed to `trackExposure()` instead of a business event.
 *
 * The `$` prefix keeps it out of the business-event namespace so it can't
 * collide with a real conversion event.
 */
export const EXPOSURE_EVENT_NAME = "$traffical.exposure";

/**
 * Namespace prefix for all Traffical-specific keys emitted in OpenFeature
 * `flagMetadata`. Every key produced by `buildFlagMetadata` is `traffical.*`.
 */
export const FLAG_METADATA_PREFIX = "traffical";
