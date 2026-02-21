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
}

export interface DeviceInfoProvider {
  getDeviceInfo(): DeviceInfo;
}
