/**
 * ID Generation Utilities
 *
 * Provides consistent ID generation with type prefixes for all entities and events.
 *
 * Entity IDs: 8-character NanoID with prefix (e.g., "proj_hVF1cCoC")
 * - Compact and URL-friendly
 * - 64^8 = 281 trillion combinations
 * - With DB constraints, collisions are handled via retry
 *
 * Event IDs: ULID with prefix (e.g., "dec_01JHFK1WWMMG7M0XPEBTYXZEBW")
 * - Lexicographically sortable (time-ordered)
 * - Contains millisecond timestamp for analytics
 */

import { customAlphabet } from "nanoid";
import { ulid } from "ulid";

// =============================================================================
// NanoID Configuration
// =============================================================================

/**
 * URL-safe alphabet for NanoID (64 characters).
 * Includes: 0-9, A-Z, a-z (no special chars to avoid URL encoding issues)
 */
const NANOID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Default length for entity IDs (without prefix).
 * 64^8 = 281,474,976,710,656 (~281 trillion) combinations.
 */
const ENTITY_ID_LENGTH = 8;

/**
 * NanoID generator with custom alphabet.
 */
const nanoid = customAlphabet(NANOID_ALPHABET, ENTITY_ID_LENGTH);

// =============================================================================
// ID Prefixes
// =============================================================================

/**
 * Entity ID prefixes for each entity type.
 */
export type EntityIdPrefix =
  | "org"     // Organization
  | "proj"    // Project
  | "env"     // Environment
  | "ns"      // Namespace
  | "lay"     // Layer
  | "pol"     // Policy
  | "alloc"   // Allocation
  | "param"   // Parameter
  | "dom"     // DOM Binding
  | "ovr"     // Environment Override
  | "ak";     // API Key

/**
 * Event ID prefixes for each event type.
 */
export type EventIdPrefix = "dec" | "exp" | "trk";

// =============================================================================
// Generic ID Generation
// =============================================================================

/**
 * Generates a prefixed 8-char NanoID for the specified entity type.
 *
 * @param prefix - The entity type prefix
 * @returns A prefixed NanoID string (e.g., "proj_hVF1cCoC")
 */
export function generateEntityId(prefix: EntityIdPrefix): string {
  return `${prefix}_${nanoid()}`;
}

/**
 * Generates a prefixed ULID for the specified event type.
 * Events use ULID for time-sortability in analytics.
 *
 * @param prefix - The event type prefix
 * @returns A prefixed ULID string (e.g., "dec_01JHFK1WWMMG7M0XPEBTYXZEBW")
 */
export function generateEventId(prefix: EventIdPrefix): string {
  return `${prefix}_${ulid()}`;
}

/**
 * Generates a plain 8-char NanoID without prefix.
 * Used for internal IDs that don't need type identification.
 */
export function generateShortId(): string {
  return nanoid();
}

// =============================================================================
// Entity ID Convenience Functions
// =============================================================================

/** Generates an Organization ID with "org_" prefix */
export function generateOrgId(): string {
  return generateEntityId("org");
}

/** Generates a Project ID with "proj_" prefix */
export function generateProjectId(): string {
  return generateEntityId("proj");
}

/** Generates an Environment ID with "env_" prefix */
export function generateEnvironmentId(): string {
  return generateEntityId("env");
}

/** Generates a Namespace ID with "ns_" prefix */
export function generateNamespaceId(): string {
  return generateEntityId("ns");
}

/** Generates a Layer ID with "lay_" prefix */
export function generateLayerId(): string {
  return generateEntityId("lay");
}

/** Generates a Policy ID with "pol_" prefix */
export function generatePolicyId(): string {
  return generateEntityId("pol");
}

/** Generates an Allocation ID with "alloc_" prefix */
export function generateAllocationId(): string {
  return generateEntityId("alloc");
}

/** Generates a Parameter ID with "param_" prefix */
export function generateParameterId(): string {
  return generateEntityId("param");
}

/** Generates a DOM Binding ID with "dom_" prefix */
export function generateDomBindingId(): string {
  return generateEntityId("dom");
}

/** Generates an Environment Override ID with "ovr_" prefix */
export function generateOverrideId(): string {
  return generateEntityId("ovr");
}

/** Generates an API Key ID with "ak_" prefix */
export function generateApiKeyId(): string {
  return generateEntityId("ak");
}

// =============================================================================
// Event ID Convenience Functions (Keep ULID for time-sortability)
// =============================================================================

/** Generates a Decision event ID with "dec_" prefix (ULID) */
export function generateDecisionId(): string {
  return generateEventId("dec");
}

/** Generates an Exposure event ID with "exp_" prefix (ULID) */
export function generateExposureId(): string {
  return generateEventId("exp");
}

/** Generates a Track event ID with "trk_" prefix (ULID) */
export function generateTrackEventId(): string {
  return generateEventId("trk");
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Extracts the timestamp from a ULID-based ID.
 * Only works for event IDs (ULID format).
 *
 * @param id - A prefixed ULID (e.g., "dec_01JHFK1WWMMG7M0XPEBTYXZEBW")
 * @returns The timestamp as a Date, or null if invalid
 */
export function getIdTimestamp(id: string): Date | null {
  // Extract the ULID part (after the prefix and underscore)
  const parts = id.split("_");
  if (parts.length < 2) {
    return null;
  }

  const ulidPart = parts[1];
  if (!ulidPart || ulidPart.length !== 26) {
    return null;
  }

  // ULID timestamp is encoded in the first 10 characters (Crockford's Base32)
  const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const TIME_LEN = 10;

  let time = 0;
  for (let i = 0; i < TIME_LEN; i++) {
    const char = ulidPart.charAt(i).toUpperCase();
    const index = ENCODING.indexOf(char);
    if (index === -1) {
      return null;
    }
    time = time * 32 + index;
  }

  return new Date(time);
}

/**
 * @deprecated Use getIdTimestamp instead
 */
export function getEventIdTimestamp(eventId: string): Date | null {
  return getIdTimestamp(eventId);
}
