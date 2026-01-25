/**
 * @traffical/node
 *
 * Traffical SDK for Node.js environments.
 * Provides HTTP client with caching, background refresh, and event tracking.
 */

// Re-export everything from core
export * from "@traffical/core";

// Export Node-specific client
export {
  TrafficalClient,
  createTrafficalClient,
  createTrafficalClientSync,
} from "./client.js";

