/**
 * @traffical/core-io
 *
 * I/O layer for Traffical SDK.
 * Provides DecisionClient for server-evaluated resolution and per-entity decisions.
 */

export {
  DecisionClient,
  createEdgeDecideRequest,
  type DecisionClientConfig,
} from "./decision-client.js";
