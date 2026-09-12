---
"@traffical/react-native": minor
---

Add `defaultDeviceInfoProvider` / `createDefaultDeviceInfoProvider(options)` — a `DeviceInfoProvider` built from `Platform`, `Dimensions` and `Intl` only (no native modules). Emits the canonical `$`-prefixed system attributes shared by every Traffical SDK (`$os`, `$os_version`, `$device_type`, `$device_model` on Android, `$locale`, `$timezone`, and `$app_version` when supplied via `createDefaultDeviceInfoProvider({ appVersion })`) alongside the existing un-prefixed `DeviceInfo` fields. Opt-in: pass it as `config.deviceInfoProvider`; apps that do not are unaffected. The `DeviceInfo` interface gains the optional `$` fields so custom providers can emit them too.
