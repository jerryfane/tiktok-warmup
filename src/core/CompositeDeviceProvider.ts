import { logger } from '../tools/utils.js';

import type { AndroidDevice } from './DeviceManager.js';
import type { DeviceProvider } from './DeviceProvider.js';

/**
 * CompositeDeviceProvider - combines multiple providers (e.g. ADB + Multilogin).
 *
 * Discovers devices from all providers in parallel, merges results, and
 * tracks which provider owns each device ID for lifecycle/proxy delegation.
 */
export class CompositeDeviceProvider implements DeviceProvider {
  readonly name: string;

  private providers: DeviceProvider[];
  /** Maps device id → owning provider */
  private deviceOwner = new Map<string, DeviceProvider>();

  constructor(providers: DeviceProvider[]) {
    if (providers.length === 0) {
      throw new Error('CompositeDeviceProvider requires at least one provider');
    }
    this.providers = providers;
    this.name = providers.map(p => p.name).join('+');
  }

  async discoverDevices(): Promise<AndroidDevice[]> {
    const results = await Promise.all(
      this.providers.map(async provider => {
        try {
          const devices = await provider.discoverDevices();
          return { provider, devices };
        } catch (error) {
          logger.error(`[${provider.name}] Discovery failed:`, error);
          return { provider, devices: [] as AndroidDevice[] };
        }
      }),
    );

    this.deviceOwner.clear();
    const allDevices: AndroidDevice[] = [];

    for (const { provider, devices } of results) {
      for (const device of devices) {
        this.deviceOwner.set(device.id, provider);
        allDevices.push(device);
      }
    }

    return allDevices;
  }

  async prepareDevice(deviceId: string): Promise<void> {
    const provider = this.getOwner(deviceId);
    await provider.prepareDevice(deviceId);
  }

  async releaseDevice(deviceId: string): Promise<void> {
    const provider = this.getOwner(deviceId);
    await provider.releaseDevice(deviceId);
  }

  managesProxy(deviceId: string): boolean {
    const provider = this.deviceOwner.get(deviceId);
    return provider?.managesProxy(deviceId) ?? false;
  }

  private getOwner(deviceId: string): DeviceProvider {
    const provider = this.deviceOwner.get(deviceId);
    if (!provider) {
      // Fallback: use first provider (should not happen in normal flow)
      logger.warn(`[Composite] No owner found for device ${deviceId}, using first provider`);
      return this.providers[0];
    }
    return provider;
  }
}
