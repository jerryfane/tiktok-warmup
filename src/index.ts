/* eslint-disable default-case */
/* eslint-disable @typescript-eslint/no-misused-promises */
import 'dotenv/config';
import { AUTOMATION_PRESETS } from './config/presets.js';
import type { ProxyConfig } from './config/proxy.js';
import { assignProxiesToDevices, formatProxy, loadProxyConfig, parseProxyString } from './config/proxy.js';
import { AdbDeviceProvider } from './core/AdbDeviceProvider.js';
import { AgentManager } from './core/AgentManager.js';
import { CompositeDeviceProvider } from './core/CompositeDeviceProvider.js';
import { DeviceManager } from './core/DeviceManager.js';
import type { DeviceProvider } from './core/DeviceProvider.js';
import { MultiloginProvider } from './core/MultiloginProvider.js';
import { Worker } from './core/Worker.js';
import { logger } from './tools/utils.js';

/**
 * TikTok Agent Bot - Main Entry Point
 * 
 * High-level orchestration:
 * 1. Scan devices via ADB
 * 2. Create Worker for each device
 * 3. Start AgentManager for each Worker
 * 4. Handle graceful shutdown
 */

interface TikTokBotConfig {
  maxDevices?: number;
  targetDevice?: string;
  debug?: boolean;
  proxy?: string; // CLI --proxy host:port (applied to all devices)
  useProxies?: boolean; // CLI --use-proxies (load from config files)
  multilogin?: boolean; // CLI --multilogin (enable Multilogin cloud phones)
}

class TikTokBot {
  private deviceManager: DeviceManager;
  private agentManagers: Map<string, AgentManager> = new Map();
  private workers: Map<string, Worker> = new Map();
  private isShuttingDown = false;
  private proxyAssignments: Map<string, ProxyConfig> = new Map();

  constructor(private config: TikTokBotConfig = {}) {
    const provider = this.buildDeviceProvider();
    this.deviceManager = new DeviceManager(provider);
    this.setupSignalHandlers();
  }

  /**
   * Build the appropriate DeviceProvider based on config / env vars.
   */
  private buildDeviceProvider(): DeviceProvider {
    const email = process.env.MULTILOGIN_EMAIL;
    const password = process.env.MULTILOGIN_PASSWORD;
    const useMultilogin = this.config.multilogin ?? !!email;

    if (!useMultilogin) {
      return new AdbDeviceProvider();
    }

    if (!email || !password) {
      throw new Error(
        'Multilogin enabled but missing credentials. Set MULTILOGIN_EMAIL and MULTILOGIN_PASSWORD env vars.',
      );
    }

    const multiloginProvider = new MultiloginProvider({
      email,
      password,
      folderId: process.env.MULTILOGIN_FOLDER_ID,
    });

    // Combine with ADB provider so physical devices still work alongside cloud phones
    const adbProvider = new AdbDeviceProvider();
    return new CompositeDeviceProvider([adbProvider, multiloginProvider]);
  }


  /**
   * Main startup sequence
   */
  async start(): Promise<void> {
    try {
      logger.info('🚀 Starting TikTok Agent Bot...');
      
      // 1. Discover available Android devices
      const devices = await this.discoverDevices();
      
      if (devices.length === 0) {
        logger.error('❌ No Android devices found. Connect device with USB debugging enabled.');
        process.exit(1);
      }

      logger.info(`📱 Found ${devices.length} device(s): ${devices.map(d => d.name).join(', ')}`);

      // 2. Load proxy configuration and assign to devices
      if (this.config.proxy) {
        // CLI --proxy flag: apply same proxy to all devices
        const cliProxy = parseProxyString(this.config.proxy);
        for (const device of devices) {
          this.proxyAssignments.set(device.id, cliProxy);
        }
        logger.info(`Using CLI proxy ${formatProxy(cliProxy)} for all devices`);
      } else if (this.config.useProxies) {
        const proxySettings = await loadProxyConfig();
        if (proxySettings.enabled) {
          this.proxyAssignments = assignProxiesToDevices(
            devices.map(d => d.id),
            proxySettings,
          );
          for (const [deviceId, proxy] of this.proxyAssignments) {
            const deviceName = devices.find(d => d.id === deviceId)?.name ?? deviceId;
            logger.info(`Assigned proxy ${formatProxy(proxy)} to ${deviceName}`);
          }
        }
      }

      // 3. Create and start workers for each device
      await this.createWorkers(devices);

      // 4. Start agent managers for each worker
      await this.startAgentManagers();

      logger.info('✅ All agents started successfully. Running infinite automation...');

      // 5. Keep process alive and monitor workers
      await this.monitorWorkers();

    } catch (error) {
      logger.error('💥 Fatal error during startup:', error);
      await this.shutdown();
      process.exit(1);
    }
  }

  /**
   * Discover and filter available devices
   */
  private async discoverDevices() {
    const allDevices = await this.deviceManager.getConnectedDevices();
    
    // Filter by target device if specified
    if (this.config.targetDevice) {
      const targetDevice = allDevices.find(d => 
        d.id === this.config.targetDevice || 
        d.name?.includes(this.config.targetDevice ?? '')
      );
      return targetDevice ? [targetDevice] : [];
    }

    // Limit max devices if specified
    if (this.config.maxDevices) {
      return allDevices.slice(0, this.config.maxDevices);
    }

    return allDevices;
  }

  /**
   * Create Worker instance for each device
   */
  private async createWorkers(devices: any[]) {
    for (const device of devices) {
      try {
        logger.info(`🔧 Creating worker for device: ${device.name} (${device.id})`);
        
        const worker = new Worker({
          deviceId: device.id,
          deviceName: device.name,
          presets: AUTOMATION_PRESETS,
          deviceManager: this.deviceManager,
          proxy: this.proxyAssignments.get(device.id),
        });

        logger.info(`🔧 Loaded presets: ${JSON.stringify(AUTOMATION_PRESETS)}`);

        await worker.initialize();
        this.workers.set(device.id, worker);
        
        logger.info(`✅ Worker created for ${device.name}`);
      } catch (error) {
        logger.error(`❌ Failed to create worker for ${device.name}:`, error);
      }
    }

    if (this.workers.size === 0) {
      throw new Error('No workers could be created');
    }
  }

  /**
   * Start AgentManager for each worker
   */
  private async startAgentManagers() {
    const startPromises = Array.from(this.workers.entries()).map(async ([deviceId, worker]) => {
      try {
        logger.info(`🧠 Starting agent manager for ${worker.deviceName}...`);
        
        const agentManager = new AgentManager(worker);
        await agentManager.start();
        
        this.agentManagers.set(deviceId, agentManager);
        logger.info(`✅ Agent manager started for ${worker.deviceName}`);
        
      } catch (error) {
        logger.error(`❌ Failed to start agent for ${worker.deviceName}:`, error);
      }
    });

    await Promise.all(startPromises);

    if (this.agentManagers.size === 0) {
      throw new Error('No agent managers could be started');
    }
  }

  /**
   * Monitor worker health and performance
   */
  private async monitorWorkers() {
    const monitorInterval = setInterval(async () => {
      if (this.isShuttingDown) {
        clearInterval(monitorInterval);
        return;
      }

      try {
        await this.checkWorkerHealth();
        await this.logPerformanceStats();
      } catch (error) {
        logger.error('Error during worker monitoring:', error);
      }
    }, 1800000); // Check every 30 minutes

    // Keep process alive
    while (!this.isShuttingDown) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  /**
   * Check health of all workers and restart if needed
   */
  private async checkWorkerHealth() {
    for (const [deviceId, worker] of this.workers) {
      try {
        const health = worker.getHealthStatus();
        
        if (!health.isHealthy) {
          logger.warn(`⚠️ Worker ${worker.deviceName} is unhealthy: ${health.reason}`);
          
          if (health.needsRestart) {
            logger.info(`🔄 Restarting worker ${worker.deviceName}...`);
            await this.restartWorker(deviceId);
          }
        }
      } catch (error) {
        logger.error(`Error checking health for ${worker.deviceName}:`, error);
      }
    }
  }

  /**
   * Log performance statistics
   */
  private async logPerformanceStats() {
    const stats = {
      activeWorkers: this.workers.size,
      devices: Array.from(this.workers.values()).map(w => w.deviceName),
      totalStats: {
        videos: 0,
        likes: 0,
        comments: 0,
        follows: 0,
        uptime: 0
      }
    };

    for (const worker of this.workers.values()) {
      const workerStats = worker.getStats();
      stats.totalStats.videos += workerStats.videosWatched;
      stats.totalStats.likes += workerStats.likesGiven;
      stats.totalStats.comments += workerStats.commentsPosted;
      stats.totalStats.follows += workerStats.followsGiven;
    }

    logger.info('📊 Performance Stats:', stats);
  }

  /**
   * Restart specific worker
   */
  private async restartWorker(deviceId: string) {
    try {
      // Stop agent manager
      const agentManager = this.agentManagers.get(deviceId);
      if (agentManager) {
        await agentManager.stop();
        this.agentManagers.delete(deviceId);
      }

      // Stop worker
      const worker = this.workers.get(deviceId);
      if (worker) {
        await worker.shutdown();
        this.workers.delete(deviceId);
      }

      // Recreate worker and agent
      const device = await this.deviceManager.getDeviceById(deviceId);
      if (device) {
        await this.createWorkers([device]);
        await this.startAgentManagers();
      }

    } catch (error) {
      logger.error(`Failed to restart worker ${deviceId}:`, error);
    }
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  private setupSignalHandlers() {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
    
    signals.forEach(signal => {
      process.on(signal, async () => {
        logger.info(`\n🛑 Received ${signal}. Shutting down gracefully...`);
        await this.shutdown();
        process.exit(0);
      });
    });

    process.on('uncaughtException', async (error) => {
      logger.error('💥 Uncaught Exception:', error);
      await this.shutdown();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
      logger.error('💥 Unhandled Rejection:', reason);
      await this.shutdown();
      process.exit(1);
    });
  }

  /**
   * Graceful shutdown of all components
   */
  async shutdown() {
    if (this.isShuttingDown) return;
    
    this.isShuttingDown = true;
    logger.info('🔄 Shutting down TikTok Agent Bot...');

    try {
      // Stop all agent managers
      const agentStopPromises = Array.from(this.agentManagers.values()).map(
        async agent => agent.stop().catch(err => logger.error('Error stopping agent:', err))
      );
      await Promise.all(agentStopPromises);

      // Stop all workers
      const workerStopPromises = Array.from(this.workers.values()).map(
        async worker => worker.shutdown().catch(err => logger.error('Error stopping worker:', err))
      );
      await Promise.all(workerStopPromises);

      // Release devices (disconnect cloud phones, etc.)
      const releasePromises = Array.from(this.workers.keys()).map(
        async deviceId => this.deviceManager.releaseDevice(deviceId).catch(err =>
          logger.error(`Error releasing device ${deviceId}:`, err),
        ),
      );
      await Promise.all(releasePromises);

      logger.info('✅ Shutdown completed successfully');
    } catch (error) {
      logger.error('Error during shutdown:', error);
    }
  }
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const config: TikTokBotConfig = {};

  // Parse CLI arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--device':
        config.targetDevice = args[i + 1];
        i++;
        break;
      case '--max-devices':
        config.maxDevices = parseInt(args[i + 1]);
        i++;
        break;
      case '--proxy':
        config.proxy = args[i + 1];
        i++;
        break;
      case '--use-proxies':
        config.useProxies = true;
        break;
      case '--multilogin':
        config.multilogin = true;
        break;
      case '--debug':
        config.debug = true;
        break;
      case '--help':
        console.log(`
TikTok Agent Bot - Multi-Device Automation

Usage: pnpm start [options]

Options:
  --device <id>         Target specific device ID
  --max-devices <num>   Maximum number of devices to use
  --proxy <host:port>   Use proxy for all devices (e.g., 1.2.3.4:8080)
  --use-proxies         Load proxies from proxies.json/proxies.txt/PROXY_POOL
  --multilogin          Enable Multilogin cloud phones (requires env vars)
  --debug              Enable debug logging
  --help               Show this help message

Examples:
  pnpm start                    # Use all connected devices, no proxy
  pnpm start --device emulator-5554
  pnpm start --max-devices 2
  pnpm start --proxy 1.2.3.4:8080
  pnpm start --use-proxies      # Load from proxies.txt or proxies.json
  pnpm start --multilogin       # Use Multilogin cloud phones + local devices
        `);
        process.exit(0);
    }
  }

  if (config.debug) {
    process.env.DEBUG = 'agent:*';
  }

  const bot = new TikTokBot(config);
  await bot.start();
}

// Start the bot if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
}

export { TikTokBot }; 