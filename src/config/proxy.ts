import fs from 'fs/promises';
import path from 'path';

import { logger } from '../tools/utils.js';

/**
 * Single proxy configuration
 */
export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/**
 * Proxy settings loaded from proxies.json or env
 */
export interface ProxySettings {
  enabled: boolean;
  pool?: ProxyConfig[];
  deviceMappings?: Record<string, ProxyConfig>;
}

/**
 * Parse a proxy string into ProxyConfig.
 * Supports formats:
 *   host:port
 *   user:pass@host:port
 *   host:port:user:pass
 */
export function parseProxyString(str: string): ProxyConfig {
  const trimmed = str.trim();

  // Format: user:pass@host:port
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex !== -1) {
    const credentials = trimmed.slice(0, atIndex);
    const hostPort = trimmed.slice(atIndex + 1);
    const [username, ...passParts] = credentials.split(':');
    const password = passParts.join(':');
    const [host, portStr] = hostPort.split(':');
    const port = parseInt(portStr, 10);

    if (!host || isNaN(port)) {
      throw new Error(`Invalid proxy string: ${str}`);
    }

    return { host, port, username, password };
  }

  const parts = trimmed.split(':');

  // Format: host:port:user:pass (4 parts, second is numeric)
  if (parts.length >= 4 && !isNaN(parseInt(parts[1], 10))) {
    const host = parts[0];
    const port = parseInt(parts[1], 10);
    const username = parts[2];
    const password = parts.slice(3).join(':');

    if (!host || isNaN(port)) {
      throw new Error(`Invalid proxy string: ${str}`);
    }

    return { host, port, username, password };
  }

  // Format: host:port
  const [host, portStr] = parts;
  const port = parseInt(portStr, 10);

  if (!host || isNaN(port)) {
    throw new Error(`Invalid proxy string: ${str}`);
  }

  return { host, port };
}

/**
 * Load proxy configuration from proxies.json or PROXY_POOL env var.
 * Returns { enabled: false } if neither source is available.
 */
export async function loadProxyConfig(): Promise<ProxySettings> {
  // Try proxies.json first
  const jsonPath = path.resolve(process.cwd(), 'proxies.json');
  try {
    const raw = await fs.readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as ProxySettings;

    if (!parsed.enabled) {
      logger.info('Proxy config found but disabled in proxies.json');
      return { enabled: false };
    }

    logger.info(`Loaded proxy config from proxies.json (pool: ${parsed.pool?.length ?? 0}, mappings: ${Object.keys(parsed.deviceMappings ?? {}).length})`);
    return parsed;
  } catch {
    // proxies.json not found or invalid — fall through to env var
  }

  // Try proxies.txt (one proxy per line, # comments and blank lines skipped)
  const txtPath = path.resolve(process.cwd(), 'proxies.txt');
  try {
    const raw = await fs.readFile(txtPath, 'utf-8');
    const lines = raw
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));

    if (lines.length > 0) {
      const pool = lines.map(l => parseProxyString(l));
      logger.info(`Loaded ${pool.length} proxies from proxies.txt`);
      return { enabled: true, pool };
    }
  } catch {
    // proxies.txt not found — fall through to env var
  }

  // Try PROXY_POOL env var (comma or newline separated)
  const envPool = process.env.PROXY_POOL;
  if (envPool) {
    try {
      const pool = envPool
        .split(/[,\n]/)
        .map(s => s.trim())
        .filter(s => s)
        .map(s => parseProxyString(s));
      logger.info(`Loaded ${pool.length} proxies from PROXY_POOL env var`);
      return { enabled: true, pool };
    } catch (error) {
      logger.error('Failed to parse PROXY_POOL env var:', error);
      return { enabled: false };
    }
  }

  // No proxy config found — that's fine, run without proxies
  return { enabled: false };
}

/**
 * Assign proxies to devices.
 * Uses explicit deviceMappings if provided, otherwise distributes pool round-robin.
 */
export function assignProxiesToDevices(
  deviceIds: string[],
  settings: ProxySettings,
): Map<string, ProxyConfig> {
  const assignments = new Map<string, ProxyConfig>();

  if (!settings.enabled) {
    return assignments;
  }

  // Use explicit device mappings if provided
  if (settings.deviceMappings) {
    for (const deviceId of deviceIds) {
      const mapping = settings.deviceMappings[deviceId];
      if (mapping) {
        assignments.set(deviceId, mapping);
      }
    }

    // If all devices got a mapping, return early
    if (assignments.size === deviceIds.length) {
      return assignments;
    }
  }

  // Round-robin from pool for any remaining devices
  const pool = settings.pool;
  if (!pool || pool.length === 0) {
    return assignments;
  }

  let poolIndex = 0;
  for (const deviceId of deviceIds) {
    if (!assignments.has(deviceId)) {
      assignments.set(deviceId, pool[poolIndex % pool.length]);
      poolIndex++;
    }
  }

  return assignments;
}

/**
 * Format a ProxyConfig as a display string (hides credentials).
 */
export function formatProxy(proxy: ProxyConfig): string {
  const auth = proxy.username ? `${proxy.username}:***@` : '';
  return `${auth}${proxy.host}:${proxy.port}`;
}
