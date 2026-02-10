import crypto from 'crypto';

import { execAsync, logger } from '../tools/utils.js';

import type { AndroidDevice } from './DeviceManager.js';
import type { DeviceProvider } from './DeviceProvider.js';

/**
 * Configuration for Multilogin cloud phone provider.
 */
export interface MultiloginConfig {
  email: string;
  password: string;
  folderId?: string;
}

/**
 * Multilogin API profile representation (subset of fields we use).
 */
interface MultiloginProfile {
  id: string;
  name: string;
  status?: string;
}

/**
 * MultiloginProvider - discovers and manages Multilogin cloud phone profiles.
 *
 * Flow:
 * 1. Authenticate with Multilogin API → bearer token
 * 2. List cloud phone profiles (optionally filtered by folder)
 * 3. Start profiles that aren't running, enable ADB
 * 4. `adb connect ip:port` for each
 * 5. Return AndroidDevice[] with id = "ip:port"
 *
 * The provider is structured with individual private methods per API call
 * so endpoints are easy to adjust as the Multilogin API evolves.
 */
export class MultiloginProvider implements DeviceProvider {
  readonly name = 'Multilogin';

  private config: MultiloginConfig;
  private token: string | null = null;
  private tokenExpiry = 0;

  /** Maps device id (ip:port) → profile id for lifecycle management. */
  private deviceToProfile = new Map<string, string>();

  private static readonly BASE_URL = 'https://api.multilogin.com';
  private static readonly TOKEN_LIFETIME_MS = 25 * 60 * 1000; // refresh 5min before 30min expiry

  constructor(config: MultiloginConfig) {
    this.config = config;
  }

  async discoverDevices(): Promise<AndroidDevice[]> {
    await this.ensureAuthenticated();

    const profiles = await this.listProfiles();
    logger.info(`[Multilogin] Found ${profiles.length} cloud phone profile(s)`);

    const devices: AndroidDevice[] = [];

    for (const profile of profiles) {
      try {
        // Start profile if not already running
        await this.startProfile(profile.id);

        // Enable ADB and get connection info
        const adbAddress = await this.enableAdb(profile.id);
        if (!adbAddress) {
          logger.warn(`[Multilogin] Could not get ADB address for profile ${profile.name}`);
          continue;
        }

        // Connect via ADB
        await this.adbConnect(adbAddress);

        this.deviceToProfile.set(adbAddress, profile.id);

        devices.push({
          id: adbAddress,
          name: `Multilogin: ${profile.name}`,
          model: 'Cloud Phone',
          status: 'device',
          properties: {
            provider: 'multilogin',
            profileId: profile.id,
          },
        });

        logger.info(`[Multilogin] Connected profile "${profile.name}" at ${adbAddress}`);
      } catch (error) {
        logger.error(`[Multilogin] Failed to setup profile "${profile.name}":`, error);
      }
    }

    return devices;
  }

  async prepareDevice(deviceId: string): Promise<void> {
    // Re-connect ADB in case connection was lost
    await this.adbConnect(deviceId);
  }

  async releaseDevice(deviceId: string): Promise<void> {
    try {
      await execAsync(`adb disconnect ${deviceId}`);
      logger.info(`[Multilogin] Disconnected ADB for ${deviceId}`);
    } catch (error) {
      logger.warn(`[Multilogin] Failed to disconnect ADB for ${deviceId}:`, error);
    }

    const profileId = this.deviceToProfile.get(deviceId);
    if (profileId) {
      try {
        await this.ensureAuthenticated();
        await this.stopProfile(profileId);
        logger.info(`[Multilogin] Stopped cloud phone profile ${profileId}`);
      } catch (error) {
        logger.warn(`[Multilogin] Failed to stop profile ${profileId}:`, error);
      }
      this.deviceToProfile.delete(deviceId);
    }
  }

  // eslint-disable-next-line no-unused-vars
  managesProxy(_deviceId: string): boolean {
    // Multilogin handles proxies on their platform
    return true;
  }

  // ===== Private API methods =====

  /**
   * Ensure we have a valid bearer token, refreshing if needed.
   */
  private async ensureAuthenticated(): Promise<void> {
    if (this.token && Date.now() < this.tokenExpiry) {
      return;
    }
    await this.authenticate();
  }

  /**
   * Authenticate with Multilogin and store the bearer token.
   */
  private async authenticate(): Promise<void> {
    const passwordHash = crypto.createHash('md5').update(this.config.password).digest('hex');

    const response = await fetch(`${MultiloginProvider.BASE_URL}/user/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: this.config.email,
        password: passwordHash,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`[Multilogin] Authentication failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as { data?: { token?: string } };
    const token = data?.data?.token;

    if (!token) {
      throw new Error('[Multilogin] Authentication response missing token');
    }

    this.token = token;
    this.tokenExpiry = Date.now() + MultiloginProvider.TOKEN_LIFETIME_MS;
    logger.info('[Multilogin] Authenticated successfully');
  }

  /**
   * List cloud phone profiles, optionally filtered by folder.
   */
  private async listProfiles(): Promise<MultiloginProfile[]> {
    const url = this.config.folderId
      ? `${MultiloginProvider.BASE_URL}/profile?folder_id=${this.config.folderId}`
      : `${MultiloginProvider.BASE_URL}/profile`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`[Multilogin] Failed to list profiles (${response.status}): ${body}`);
    }

    const data = (await response.json()) as { data?: { profiles?: MultiloginProfile[] } };
    return data?.data?.profiles ?? [];
  }

  /**
   * Start a cloud phone profile if not already running.
   */
  private async startProfile(profileId: string): Promise<void> {
    const response = await fetch(`${MultiloginProvider.BASE_URL}/profile/start`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profileId }),
    });

    if (!response.ok) {
      const body = await response.text();
      // Profile may already be running — treat 409/400 as non-fatal
      if (response.status === 409 || response.status === 400) {
        logger.debug(`[Multilogin] Profile ${profileId} may already be running: ${body}`);
        return;
      }
      throw new Error(`[Multilogin] Failed to start profile ${profileId} (${response.status}): ${body}`);
    }

    logger.debug(`[Multilogin] Started profile ${profileId}`);
  }

  /**
   * Enable ADB on a running profile and return the ip:port address.
   */
  private async enableAdb(profileId: string): Promise<string | null> {
    const response = await fetch(`${MultiloginProvider.BASE_URL}/profile/adb/enable`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profileId }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`[Multilogin] Failed to enable ADB for profile ${profileId} (${response.status}): ${body}`);
    }

    const data = (await response.json()) as { data?: { address?: string; host?: string; port?: number } };

    // Try address field first, fall back to host:port
    if (data?.data?.address) {
      return data.data.address;
    }
    if (data?.data?.host && data?.data?.port) {
      return `${data.data.host}:${data.data.port}`;
    }

    return null;
  }

  /**
   * Stop a cloud phone profile.
   */
  private async stopProfile(profileId: string): Promise<void> {
    const response = await fetch(`${MultiloginProvider.BASE_URL}/profile/stop`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profileId }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.warn(`[Multilogin] Failed to stop profile ${profileId} (${response.status}): ${body}`);
    }
  }

  /**
   * Connect to a device via ADB over network.
   */
  private async adbConnect(address: string): Promise<void> {
    try {
      const result = await execAsync(`adb connect ${address}`);
      const output = (result.stdout || result).toString();
      if (output.includes('unable to connect') || output.includes('failed')) {
        throw new Error(output.trim());
      }
      logger.debug(`[Multilogin] ADB connected to ${address}`);
    } catch (error) {
      throw new Error(`[Multilogin] Failed to adb connect ${address}: ${error}`);
    }
  }

  /**
   * Build authorization headers for API calls.
   */
  private authHeaders(): Record<string, string> {
    if (!this.token) {
      throw new Error('[Multilogin] Not authenticated — call ensureAuthenticated() first');
    }
    return { Authorization: `Bearer ${this.token}` };
  }
}
