/**
 * Warehouse-native logger factory — re-export.
 *
 * The implementation moved to `@traffical/core-io` so that server-side SDKs
 * (`@traffical/node`) share it rather than re-deriving it. This module stays
 * as the public import path for browser consumers; `@traffical/js-client`
 * continues to export the same symbols.
 */

export {
  createWarehouseNativeLogger,
  createWarehouseNativeLoggerPlugin,
  type WarehouseNativeLoggerOptions,
  type JitsuDestination,
  type AnalyticsLike,
} from "@traffical/core-io";
