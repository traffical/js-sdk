/**
 * Hashing Module
 *
 * Exports all hashing-related functions for deterministic bucket assignment.
 * The canonical hash is the SHA-256 v2 assignment hash (see assignment-hash.ts).
 */

export {
  assignmentInput,
  sha256Digest,
  hash64BE,
  hashInt64,
  utf8ByteLength,
  ASSIGNMENT_HASH_VERSION,
} from "./assignment-hash.js";
export {
  computeBucket,
  isInBucketRange,
  findMatchingAllocation,
  percentageToBucketRange,
  createBucketRanges,
} from "./bucket.js";
export { weightedSelection } from "./weighted.js";
