import type { AndroidDevice } from './DeviceManager.js';

/**
 * DeviceProvider - abstracts device discovery and lifecycle.
 *
 * Physical (ADB) devices and cloud phones (Multilogin) differ only in how
 * they are discovered, started, and stopped. All ADB interaction commands
 * work identically once a device is connected.
 */
export interface DeviceProvider {
  /** Human-readable name for logging (e.g. "ADB", "Multilogin") */
  readonly name: string;

  /** Discover available devices and return them ready for ADB commands. */
  discoverDevices: () => Promise<AndroidDevice[]>;

  /** Called before automation starts on a device (e.g. `adb connect` for cloud phones). */
  prepareDevice: (deviceId: string) => Promise<void>;

  /** Called during shutdown (e.g. `adb disconnect` + stop cloud phone). */
  releaseDevice: (deviceId: string) => Promise<void>;

  /** Returns true if this provider manages the proxy externally (skip ADB proxy setup). */
  managesProxy: (deviceId: string) => boolean;
}
