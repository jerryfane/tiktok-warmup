import { execAsync, logger } from '../tools/utils.js';

import type { AndroidDevice } from './DeviceManager.js';
import type { DeviceProvider } from './DeviceProvider.js';

/**
 * AdbDeviceProvider - discovers physical Android devices connected via USB.
 *
 * Extracts the device scanning logic that was previously inside DeviceManager.
 * Lifecycle methods are no-ops since physical devices don't need start/stop.
 */
export class AdbDeviceProvider implements DeviceProvider {
  readonly name = 'ADB';

  async discoverDevices(): Promise<AndroidDevice[]> {
    const rawDevices = await this.scanAdbDevices();
    return await this.enrichDeviceInfo(rawDevices);
  }

  // eslint-disable-next-line no-unused-vars
  async prepareDevice(_deviceId: string): Promise<void> {
    // No-op for physical devices — already connected via USB.
  }

  // eslint-disable-next-line no-unused-vars
  async releaseDevice(_deviceId: string): Promise<void> {
    // No-op for physical devices.
  }

  // eslint-disable-next-line no-unused-vars
  managesProxy(_deviceId: string): boolean {
    return false;
  }

  /**
   * Get raw device list from ADB
   */
  private async scanAdbDevices(): Promise<Array<Partial<AndroidDevice>>> {
    try {
      const result = await execAsync('adb devices -l');
      const output = result.stdout || result;

      if (typeof output !== 'string') {
        logger.debug('ADB output type:', typeof output, output);
        throw new Error('Unexpected output format from adb devices');
      }

      const lines = output.split('\n').slice(1); // Skip header

      const devices: Array<Partial<AndroidDevice>> = [];

      for (const line of lines) {
        if (!line.trim()) continue;

        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) continue;

        const [deviceId, status] = parts;

        // Parse additional properties from device line
        const properties: Record<string, string> = {};
        const propertiesMatch = line.match(/product:(\S+)|model:(\S+)|device:(\S+)/g);
        if (propertiesMatch) {
          propertiesMatch.forEach(prop => {
            const [key, value] = prop.split(':');
            properties[key] = value;
          });
        }

        devices.push({
          id: deviceId,
          status: status as AndroidDevice['status'],
          properties,
        });
      }

      return devices;
    } catch (error) {
      throw new Error(`Failed to list ADB devices: ${error}`);
    }
  }

  /**
   * Enrich basic device info with detailed properties
   */
  private async enrichDeviceInfo(devices: Array<Partial<AndroidDevice>>): Promise<AndroidDevice[]> {
    const enriched: AndroidDevice[] = [];

    for (const device of devices) {
      if (!device.id || device.status !== 'device') {
        continue; // Skip offline/unauthorized devices
      }

      try {
        const [model, manufacturer] = await Promise.all([
          this.getProperty(device.id, 'ro.product.model'),
          this.getProperty(device.id, 'ro.product.manufacturer'),
        ]);

        const name = `${manufacturer} ${model}`.trim() || device.id;

        enriched.push({
          id: device.id,
          name,
          model,
          status: device.status,
          properties: {
            ...device.properties,
            manufacturer,
          },
        });
      } catch (error) {
        logger.warn(`Failed to enrich device ${device.id}:`, error);

        // Add with minimal info
        enriched.push({
          id: device.id,
          name: device.id,
          model: 'Unknown',
          status: device.status || 'device',
          properties: device.properties ?? {},
        });
      }
    }

    return enriched;
  }

  /**
   * Get device property via ADB
   */
  private async getProperty(deviceId: string, property: string): Promise<string> {
    try {
      const result = await execAsync(`adb -s ${deviceId} shell getprop ${property}`);
      const output = result.stdout || result;
      return typeof output === 'string' ? output.trim() : '';
    } catch (error) {
      logger.debug(`Failed to get property ${property} for ${deviceId}:`, error);
      return '';
    }
  }
}
