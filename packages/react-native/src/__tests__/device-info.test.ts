import { describe, it, expect, beforeEach, mock } from "bun:test";

// Mutable RN primitives the mocked module reads on every access, so a test can
// flip OS / dimensions without re-mocking. AppState is included because
// `mock.module` is process-wide under `bun test` and other suites import it.
const rn = {
  OS: "ios" as string,
  Version: "17.5" as string | number,
  isPad: false as boolean | undefined,
  constants: {} as Record<string, unknown>,
  window: { width: 390, height: 844, scale: 3 },
};

mock.module("react-native", () => ({
  AppState: {
    addEventListener: mock(() => ({ remove: () => {} })),
  },
  Platform: {
    get OS() {
      return rn.OS;
    },
    get Version() {
      return rn.Version;
    },
    get isPad() {
      return rn.isPad;
    },
    get constants() {
      return rn.constants;
    },
    select: (spec: Record<string, unknown>) => spec[rn.OS] ?? spec.default,
  },
  Dimensions: {
    get: (_which: string) => rn.window,
  },
}));

const { createDefaultDeviceInfoProvider, defaultDeviceInfoProvider } = await import("../device-info.js");

const DOLLAR_KEYS = ["$os", "$os_version", "$app_version", "$locale", "$timezone", "$device_model", "$device_type"];

describe("defaultDeviceInfoProvider (react-native)", () => {
  beforeEach(() => {
    rn.OS = "ios";
    rn.Version = "17.5";
    rn.isPad = false;
    rn.constants = {};
    rn.window = { width: 390, height: 844, scale: 3 };
  });

  it("emits the $ system attributes on an iPhone", () => {
    const info = defaultDeviceInfoProvider.getDeviceInfo();
    expect(info.$os).toBe("ios");
    expect(info.$os_version).toBe("17.5");
    expect(info.$device_type).toBe("mobile");
    expect(typeof info.$locale).toBe("string");
    expect(typeof info.$timezone).toBe("string");
    // no native module → no app version unless supplied
    expect(info.$app_version).toBeUndefined();
    expect(info.$device_model).toBeUndefined();
  });

  it("keeps the un-prefixed compatibility fields in sync", () => {
    const info = defaultDeviceInfoProvider.getDeviceInfo();
    expect(info.osName).toBe("ios");
    expect(info.osVersion).toBe(info.$os_version);
    expect(info.locale).toBe(info.$locale);
    expect(info.timezone).toBe(info.$timezone);
    expect(info.screenWidth).toBe(390);
    expect(info.screenHeight).toBe(844);
    expect(info.pixelRatio).toBe(3);
  });

  it("iPad → tablet via Platform.isPad", () => {
    rn.isPad = true;
    rn.window = { width: 820, height: 1180, scale: 2 };
    expect(defaultDeviceInfoProvider.getDeviceInfo().$device_type).toBe("tablet");
  });

  it("android: numeric Version, Model constant, 600dp tablet boundary", () => {
    rn.OS = "android";
    rn.Version = 34;
    rn.constants = { Model: "Pixel 8", Brand: "google" };
    rn.window = { width: 412, height: 915, scale: 2.6 };
    const info = defaultDeviceInfoProvider.getDeviceInfo();
    expect(info.$os).toBe("android");
    expect(info.$os_version).toBe("34");
    expect(info.$device_model).toBe("Pixel 8");
    expect(info.deviceModel).toBe("Pixel 8");
    expect(info.$device_type).toBe("mobile");

    rn.window = { width: 800, height: 1280, scale: 2 };
    expect(defaultDeviceInfoProvider.getDeviceInfo().$device_type).toBe("tablet");
  });

  it("maps unknown platforms to $os other and uses the width heuristic", () => {
    rn.OS = "web";
    rn.window = { width: 1440, height: 900, scale: 1 };
    const info = defaultDeviceInfoProvider.getDeviceInfo();
    expect(info.$os).toBe("other");
    expect(info.osName).toBe("web");
    expect(info.$device_type).toBe("desktop");

    rn.OS = "windows";
    rn.window = { width: 900, height: 1200, scale: 1 };
    expect(defaultDeviceInfoProvider.getDeviceInfo().$os).toBe("windows");
    expect(defaultDeviceInfoProvider.getDeviceInfo().$device_type).toBe("tablet");
  });

  it("createDefaultDeviceInfoProvider carries a caller-supplied app version", () => {
    const provider = createDefaultDeviceInfoProvider({ appVersion: "2.3.1", appBuildNumber: "451" });
    const info = provider.getDeviceInfo();
    expect(info.$app_version).toBe("2.3.1");
    expect(info.appVersion).toBe("2.3.1");
    expect(info.appBuildNumber).toBe("451");
  });

  it("every $ key it emits is in the canonical set and no other $ key leaks", () => {
    rn.OS = "android";
    rn.constants = { Model: "SM-X910" };
    const info = createDefaultDeviceInfoProvider({ appVersion: "1.0.0" }).getDeviceInfo();
    const dollar = Object.keys(info).filter((k) => k.startsWith("$"));
    expect(dollar.sort()).toEqual([...DOLLAR_KEYS].sort());
  });

  it("re-reads primitives on every call", () => {
    const provider = createDefaultDeviceInfoProvider();
    expect(provider.getDeviceInfo().screenWidth).toBe(390);
    rn.window = { width: 844, height: 390, scale: 3 };
    expect(provider.getDeviceInfo().screenWidth).toBe(844);
  });
});
