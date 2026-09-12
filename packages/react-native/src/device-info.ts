// Namespace import with lazy property access: react-native's entry is a
// CommonJS module with getter-based exports, and bun's static named-export
// detection does not see every member (CI failed on `Dimensions` with RN 0.84).
import * as RN from "react-native";

/** The subset of react-native's `Platform` the default provider reads. */
export interface PlatformLike {
  OS: string;
  Version?: string | number;
  isPad?: boolean;
  constants?: Record<string, unknown>;
}

/** The subset of react-native's `Dimensions` the default provider reads. */
export interface DimensionsLike {
  get(which: "window" | "screen"): { width: number; height: number; scale?: number };
}

/**
 * Device metadata merged into every decision context by `TrafficalRNProvider`
 * when a `deviceInfoProvider` is configured.
 *
 * Two key families:
 * - The canonical `$`-prefixed system attributes shared by every Traffical SDK
 *   (`$os`, `$os_version`, `$app_version`, `$locale`, `$timezone`,
 *   `$device_model`, `$device_type`). The dashboard registers them as system
 *   attributes; use these in new conditions.
 * - The original un-prefixed fields, kept for compatibility with existing
 *   conditions.
 */
export interface DeviceInfo {
  appVersion?: string;
  appBuildNumber?: string;
  deviceModel?: string;
  deviceModelName?: string;
  osName?: string;
  osVersion?: string;
  locale?: string;
  timezone?: string;
  screenWidth?: number;
  screenHeight?: number;
  pixelRatio?: number;

  $os?: "ios" | "android" | "macos" | "windows" | "linux" | "other";
  $os_version?: string;
  $app_version?: string;
  $locale?: string;
  $timezone?: string;
  $device_model?: string;
  $device_type?: "mobile" | "tablet" | "desktop";
}

export interface DeviceInfoProvider {
  getDeviceInfo(): DeviceInfo;
}

export interface DefaultDeviceInfoOptions {
  /**
   * App version (semver). React Native exposes no app version without a native
   * module, so pass it from your build config (e.g. `expo-constants`,
   * `react-native-device-info`, or a generated constant) to populate
   * `$app_version` / `appVersion`.
   */
  appVersion?: string;
  /** App build number, same caveat as `appVersion`. */
  appBuildNumber?: string;
  /** Override react-native's `Platform` (tests, custom hosts). */
  platform?: PlatformLike;
  /** Override react-native's `Dimensions` (tests, custom hosts). */
  dimensions?: DimensionsLike;
}

function mapOS(os: string): NonNullable<DeviceInfo["$os"]> {
  switch (os) {
    case "ios":
    case "android":
    case "macos":
    case "windows":
      return os;
    default:
      return "other";
  }
}

function deviceType(
  platform: PlatformLike,
  os: string,
  width: number,
  height: number,
): NonNullable<DeviceInfo["$device_type"]> {
  if (os === "ios") {
    // `Platform.isPad` is only defined on iOS builds of RN.
    return platform.isPad === true ? "tablet" : "mobile";
  }
  if (os === "android") {
    // Android convention: a 600dp shortest side is the phone/tablet boundary.
    return Math.min(width, height) >= 600 ? "tablet" : "mobile";
  }
  // Desktop-class platforms (web, windows, macos): same width heuristic as the
  // web plugin (mobile < 768, tablet < 1024, else desktop).
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

function androidModel(platform: PlatformLike): string | undefined {
  const constants = platform.constants;
  const model = constants?.Model;
  return typeof model === "string" && model ? model : undefined;
}

/**
 * Builds a `DeviceInfoProvider` from `Platform`, `Dimensions` and `Intl` only
 * (no native modules). Emits the `$`-prefixed system attributes plus the
 * un-prefixed compatibility fields. Values are re-read on every call, so
 * rotation and locale changes are picked up on the next decision.
 *
 * Opt in explicitly — the provider is not wired by default so existing apps
 * see no change in the context they send:
 *
 * ```tsx
 * <TrafficalRNProvider config={{ …, deviceInfoProvider: defaultDeviceInfoProvider }}>
 * ```
 */
export function createDefaultDeviceInfoProvider(options: DefaultDeviceInfoOptions = {}): DeviceInfoProvider {
  // Resolved per call so a host that installs/mocks react-native late still wins.
  const Platform = (): PlatformLike => options.platform ?? (RN.Platform as unknown as PlatformLike);
  const Dimensions = (): DimensionsLike => options.dimensions ?? (RN.Dimensions as unknown as DimensionsLike);
  return {
    getDeviceInfo(): DeviceInfo {
      const info: DeviceInfo = {};
      const os = String(Platform().OS);

      info.osName = os;
      info.$os = mapOS(os);

      const version = Platform().Version;
      if (version !== undefined && version !== null) {
        const v = String(version);
        info.osVersion = v;
        info.$os_version = v;
      }

      if (options.appVersion) {
        info.appVersion = options.appVersion;
        info.$app_version = options.appVersion;
      }
      if (options.appBuildNumber) info.appBuildNumber = options.appBuildNumber;

      let width = 0;
      let height = 0;
      try {
        const win = Dimensions().get("window");
        width = win.width;
        height = win.height;
        info.screenWidth = width;
        info.screenHeight = height;
        info.pixelRatio = win.scale;
      } catch {
        // Dimensions unavailable (headless / test)
      }
      info.$device_type = deviceType(Platform(), os, width, height);

      const model = os === "android" ? androidModel(Platform()) : undefined;
      if (model) {
        info.deviceModel = model;
        info.$device_model = model;
      }

      try {
        const resolved = Intl.DateTimeFormat().resolvedOptions();
        if (resolved.locale) {
          info.locale = resolved.locale;
          info.$locale = resolved.locale;
        }
        if (resolved.timeZone) {
          info.timezone = resolved.timeZone;
          info.$timezone = resolved.timeZone;
        }
      } catch {
        // Intl not available on this JS engine
      }

      return info;
    },
  };
}

/** Ready-made provider with no app version; see `createDefaultDeviceInfoProvider`. */
export const defaultDeviceInfoProvider: DeviceInfoProvider = createDefaultDeviceInfoProvider();
