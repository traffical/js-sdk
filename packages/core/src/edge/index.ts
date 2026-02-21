/**
 * Edge Client Module
 *
 * Type-only exports for per-entity decisions via the edge worker API.
 * The EdgeClient class and createEdgeDecideRequest helper have moved to @traffical/core-io.
 */

export type {
  EdgeClientConfig,
  EdgeDecideRequest,
  EdgeDecideResponse,
  EdgeBatchDecideRequest,
  EdgeBatchDecideResponse,
} from "./client.js";
