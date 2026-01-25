/**
 * Edge Client Module
 *
 * Exports for making per-entity decisions via the edge worker API.
 */

export {
  EdgeClient,
  createEdgeDecideRequest,
  type EdgeClientConfig,
  type EdgeDecideRequest,
  type EdgeDecideResponse,
  type EdgeBatchDecideRequest,
  type EdgeBatchDecideResponse,
} from "./client.js";

