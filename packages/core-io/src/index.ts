/**
 * @traffical/core-io
 *
 * I/O layer for Traffical SDK.
 * Provides DecisionClient for server-evaluated resolution and per-entity
 * decisions, plus the warehouse-native logger factory for routing assignment
 * and event data to a customer-managed pipeline.
 */

export {
  DecisionClient,
  createEdgeDecideRequest,
  type DecisionClientConfig,
} from "./decision-client.js";

export {
  createWarehouseNativeLogger,
  createWarehouseNativeLoggerPlugin,
  type WarehouseNativeLoggerOptions,
  type JitsuDestination,
  type AnalyticsLike,
} from "./warehouse-native-logger.js";
