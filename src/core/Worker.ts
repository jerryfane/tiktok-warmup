import type { AutomationPresets } from '../config/presets.js';
import type { ProxyConfig } from '../config/proxy.js';
import { formatProxy } from '../config/proxy.js';
import { runLearningStage, runSearchTopicLearningStage } from '../stages/learning.js';
import { runWorkingStage } from '../stages/working.js';
import { logger } from '../tools/utils.js';


import type { DeviceManager } from './DeviceManager.js';
import { UIDataPersistence } from './UIDataPersistence.js';

/**
 * Worker configuration
 */
export interface WorkerConfig {
  deviceId: string;
  deviceName: string;
  presets: AutomationPresets;
  deviceManager: DeviceManager;
  proxy?: ProxyConfig;
}

/**
 * Worker health status
 */
export interface HealthStatus {
  isHealthy: boolean;
  reason?: string;
  needsRestart?: boolean;
}

/**
 * Worker statistics
 */
export interface WorkerStats {
  videosWatched: number;
  likesGiven: number;
  commentsPosted: number;
  followsGiven: number;
  uptime: number;
  startTime: number;
}

/**
 * Learning Results - UI coordinates learned by the agent
 */
export interface LearnedUIElements {
  likeButton?: { x: number; y: number; confidence: number; boundingBox?: { y1: number; x1: number; y2: number; x2: number } };
  commentButton?: { x: number; y: number; confidence: number; boundingBox?: { y1: number; x1: number; y2: number; x2: number } };
  commentInputField?: { x: number; y: number; confidence: number; boundingBox?: { y1: number; x1: number; y2: number; x2: number } };
  commentSendButton?: { x: number; y: number; confidence: number; boundingBox?: { y1: number; x1: number; y2: number; x2: number } };
  followButton?: { x: number; y: number; confidence: number; boundingBox?: { y1: number; x1: number; y2: number; x2: number } };
  profileImage?: { x: number; y: number; confidence: number; boundingBox?: { y1: number; x1: number; y2: number; x2: number } };
  searchBar?: { x: number; y: number; confidence: number; boundingBox?: { y1: number; x1: number; y2: number; x2: number } };
  firstSearchResult?: { x: number; y: number; confidence: number; boundingBox?: { y1: number; x1: number; y2: number; x2: number } };
}

/**
 * Worker Stage
 */
export type WorkerStage = 'initiating' | 'learning' | 'working' | 'stopped' | 'error';

/**
 * Worker - handles automation for a single device
 * 
 * MVP Version: Basic structure without full implementation
 */
export class Worker {
  public readonly deviceId: string;
  public readonly deviceName: string;
  private readonly presets: AutomationPresets;

  private stats: WorkerStats;
  private isInitialized = false;
  private startTime = 0;
  private currentStage: WorkerStage = 'initiating';
  private learnedUI: LearnedUIElements = {};
  private deviceManager: DeviceManager;
  private detectedTikTokPackage: string | null = null;
  private proxy?: ProxyConfig;

  constructor(config: WorkerConfig) {
    this.deviceId = config.deviceId;
    this.deviceName = config.deviceName;
    this.presets = config.presets;
    this.deviceManager = config.deviceManager;
    this.proxy = config.proxy;
    this.stats = {
      videosWatched: 0,
      likesGiven: 0,
      commentsPosted: 0,
      followsGiven: 0,
      uptime: 0,
      startTime: Date.now(),
    };

    logger.debug(`Worker created for device: ${this.deviceName} (${this.deviceId})`);
  }

  /**
   * Initialize worker
   */
  async initialize(): Promise<void> {
    logger.info(`🔧 Initializing worker for ${this.deviceName}...`);

    try {
      this.currentStage = 'initiating';

      // Set up proxy if configured
      if (this.proxy) {
        logger.info(`Setting proxy ${formatProxy(this.proxy)} on ${this.deviceName}...`);
        await this.deviceManager.setProxy(this.deviceId, this.proxy);

        // Optionally verify connectivity (warn but don't block)
        const connected = await this.deviceManager.verifyProxyConnectivity(this.deviceId);
        if (!connected) {
          logger.warn(`Proxy connectivity check failed for ${this.deviceName} — continuing anyway`);
        }
      }

      // Detect which TikTok app variant is installed
      logger.info(`🔍 Detecting TikTok app on ${this.deviceName}...`);
      this.detectedTikTokPackage = await this.deviceManager.detectTikTokApp(this.deviceId);
      logger.info(`✅ Will use ${this.detectedTikTokPackage} for ${this.deviceName}`);

      // Load saved UI data if available
      logger.info(`📄 Loading saved UI data for ${this.deviceId}...`);
      const savedUIData = await UIDataPersistence.loadDeviceUIData(this.deviceId);
      if (savedUIData) {
        this.learnedUI = savedUIData;
        logger.info(`✅ Loaded saved UI data for ${this.deviceName}:`, savedUIData);
        // Set stage to working since we have valid UI data
        this.currentStage = 'working';
      }

      this.startTime = Date.now();
      this.isInitialized = true;

      logger.info(`✅ Worker initialized for ${this.deviceName}`);
      
    } catch (error) {
      this.currentStage = 'error';
      logger.error(`❌ Failed to initialize worker for ${this.deviceName}:`, error);
      throw error;
    }
  }

  /**
   * Run Learning Stage - Let AI learn TikTok UI
   */
  async runLearningStage(): Promise<boolean> {

    logger.info(`🧠 Starting learning stage for ${this.deviceName}...`);
    this.currentStage = 'learning';

    try {
      // Use detected package or fallback
      const packageToUse = this.detectedTikTokPackage ?? this.presets.tiktokAppPackage;

      if (this.presets.searchTopic) {
        // Unified search + UI learning in a single AI call
        return await this.runSearchTopicLearning(packageToUse, this.presets.searchTopic);
      } else {
        // Standard learning on the main feed
        return await this.runStandardLearning(packageToUse);
      }
    } catch (error) {
      this.currentStage = 'error';
      logger.error(`❌ Learning stage error for ${this.deviceName}:`, error);
      return false;
    }
  }

  /**
   * Standard learning: learn UI elements on the random main feed
   */
  private async runStandardLearning(packageToUse: string): Promise<boolean> {
    const result = await runLearningStage(this.deviceId, this.deviceManager, this.presets, packageToUse);

    if (!result.success || !result.tiktokLaunched) {
      logger.warn(`⚠️ Learning stage failed for ${this.deviceName}: ${result.message}`);
      return false;
    }

    this.extractUIElements(result.uiElementsFound);
    this.logLearnedElements();
    await this.saveUIData();

    this.currentStage = result.nextStage === 'working' ? 'working' : 'learning';
    return true;
  }

  /**
   * Unified search + learning: search for topic, open first result, then learn UI on that video
   */
  private async runSearchTopicLearning(packageToUse: string, searchTopic: string): Promise<boolean> {
    const result = await runSearchTopicLearningStage(
      this.deviceId, this.deviceManager, this.presets, searchTopic, packageToUse,
    );

    if (!result.success || !result.tiktokLaunched) {
      logger.warn(`⚠️ Search+learning stage failed for ${this.deviceName}: ${result.message}`);
      return false;
    }

    const { uiElementsFound } = result;

    // Extract search-specific coordinates
    if (uiElementsFound.searchBar.found && uiElementsFound.searchBar.coordinates) {
      this.learnedUI.searchBar = {
        ...uiElementsFound.searchBar.coordinates,
        confidence: uiElementsFound.searchBar.confidence ?? 0,
        boundingBox: uiElementsFound.searchBar.boundingBox,
      };
    }
    if (uiElementsFound.firstSearchResult.found && uiElementsFound.firstSearchResult.coordinates) {
      this.learnedUI.firstSearchResult = {
        ...uiElementsFound.firstSearchResult.coordinates,
        confidence: uiElementsFound.firstSearchResult.confidence ?? 0,
        boundingBox: uiElementsFound.firstSearchResult.boundingBox,
      };
    }

    // Extract standard UI elements
    this.extractUIElements(uiElementsFound);

    logger.info(`✅ Search+learning completed for ${this.deviceName}. UI elements found:`, {
      searchBar: !!this.learnedUI.searchBar,
      firstSearchResult: !!this.learnedUI.firstSearchResult,
      likeButton: !!this.learnedUI.likeButton,
      commentButton: !!this.learnedUI.commentButton,
      commentInputField: !!this.learnedUI.commentInputField,
      commentSendButton: !!this.learnedUI.commentSendButton,
      followButton: !!this.learnedUI.followButton,
      profileImage: !!this.learnedUI.profileImage,
    });

    await this.saveUIData();

    this.currentStage = result.nextStage === 'working' ? 'working' : 'learning';
    return true;
  }

  /**
   * Extract standard UI element coordinates from a learning result
   */
  private extractUIElements(uiElements: {
    likeButton: { found: boolean; coordinates?: { x: number; y: number }; confidence?: number | null; boundingBox?: { y1: number; x1: number; y2: number; x2: number } };
    commentButton: { found: boolean; coordinates?: { x: number; y: number }; confidence?: number | null; boundingBox?: { y1: number; x1: number; y2: number; x2: number } };
    commentInputField: { found: boolean; coordinates?: { x: number; y: number }; confidence?: number | null; boundingBox?: { y1: number; x1: number; y2: number; x2: number } };
    commentSendButton: { found: boolean; coordinates?: { x: number; y: number }; confidence?: number | null; boundingBox?: { y1: number; x1: number; y2: number; x2: number } };
    followButton: { found: boolean; coordinates?: { x: number; y: number }; confidence?: number | null; boundingBox?: { y1: number; x1: number; y2: number; x2: number } };
    profileImage: { found: boolean; coordinates?: { x: number; y: number }; confidence?: number | null; boundingBox?: { y1: number; x1: number; y2: number; x2: number } };
  }): void {
    const elementNames = [
      'likeButton', 'commentButton', 'commentInputField',
      'commentSendButton', 'followButton', 'profileImage',
    ] as const;

    for (const name of elementNames) {
      const el = uiElements[name];
      if (el.found && el.coordinates) {
        this.learnedUI[name] = {
          ...el.coordinates,
          confidence: el.confidence ?? 0,
          boundingBox: el.boundingBox,
        };
      }
    }
  }

  /**
   * Log which UI elements were learned
   */
  private logLearnedElements(): void {
    logger.info(`✅ Learning completed for ${this.deviceName}. UI elements found:`, {
      likeButton: !!this.learnedUI.likeButton,
      commentButton: !!this.learnedUI.commentButton,
      commentInputField: !!this.learnedUI.commentInputField,
      commentSendButton: !!this.learnedUI.commentSendButton,
      followButton: !!this.learnedUI.followButton,
      profileImage: !!this.learnedUI.profileImage,
    });
  }

  /**
   * Persist learned UI data to disk
   */
  private async saveUIData(): Promise<void> {
    try {
      await UIDataPersistence.saveDeviceUIData(this.deviceId, this.deviceName, this.learnedUI);
    } catch (error) {
      logger.warn(`⚠️ Failed to save UI data for ${this.deviceName}:`, error);
    }
  }

  /**
   * Get worker health status (MVP: basic implementation)
   */
  getHealthStatus(): HealthStatus {
    if (!this.isInitialized) {
      return {
        isHealthy: false,
        reason: 'Worker not initialized',
        needsRestart: true,
      };
    }

    // TODO: Add real health checks:
    // - Device connection
    // - TikTok app status
    // - Memory usage
    // - Error rates

    return {
      isHealthy: true,
    };
  }

  /**
   * Get worker statistics
   */
  getStats(): WorkerStats {
    return {
      ...this.stats,
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Update statistics (for future use)
   */
  updateStats(update: Partial<Omit<WorkerStats, 'uptime' | 'startTime'>>) {
    Object.assign(this.stats, update);
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info(`🛑 Shutting down worker for ${this.deviceName}...`);

    try {
      // Close TikTok so the app is fully gone when the process exits
      await this.closeTikTok();

      // Clear proxy if one was configured
      if (this.proxy) {
        logger.info(`Clearing proxy on ${this.deviceName}...`);
        await this.deviceManager.clearProxy(this.deviceId);
      }

      this.isInitialized = false;
      logger.info(`✅ Worker shutdown completed for ${this.deviceName}`);
      
    } catch (error) {
      logger.error(`❌ Error during worker shutdown for ${this.deviceName}:`, error);
      throw error;
    }
  }

  /**
   * Get device configuration
   */
  getConfig(): WorkerConfig {
    return {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      presets: this.presets,
      deviceManager: this.deviceManager,
      proxy: this.proxy,
    };
  }

  /**
   * Check if worker is ready for automation
   */
  isReady(): boolean {
    return this.isInitialized && this.currentStage !== 'error';
  }

  /**
   * Get current worker stage
   */
  getStage(): WorkerStage {
    return this.currentStage;
  }

  /**
   * Get learned UI coordinates
   */
  getLearnedUI(): LearnedUIElements {
    return { ...this.learnedUI };
  }

  /**
   * Check if worker has completed learning stage
   */
  hasLearnedUI(): boolean {
    const hasBasicUI = !!(
      this.learnedUI.likeButton &&
      this.learnedUI.commentButton &&
      this.learnedUI.commentInputField &&
      this.learnedUI.commentSendButton
    );

    return hasBasicUI;
  }

  /**
   * Run a single working session. Returns the raw result for the session loop to inspect.
   */
  private async runWorkingSession(): Promise<{
    videosWatched: number;
    likesGiven: number;
    commentsPosted: number;
    followsGiven: number;
    shouldContinue: boolean;
    message: string;
    success: boolean;
  }> {
    logger.info(`🚀 [Worker] Starting working session for ${this.deviceName}...`);

    const packageToUse = this.detectedTikTokPackage ?? this.presets.tiktokAppPackage;
    const result = await runWorkingStage(
      this.deviceId,
      this.deviceManager,
      this.presets,
      this.learnedUI,
      packageToUse
    );

    // Accumulate stats
    this.stats.videosWatched += result.videosWatched;
    this.stats.likesGiven += result.likesGiven;
    this.stats.commentsPosted += result.commentsPosted;
    this.stats.followsGiven += result.followsGiven;

    return result;
  }

  /**
   * Close TikTok and dismiss it from the recents switcher
   */
  private async closeTikTok(): Promise<void> {
    const packageToUse = this.detectedTikTokPackage ?? this.presets.tiktokAppPackage;
    logger.info(`📱 [Worker] Closing TikTok on ${this.deviceName}`);
    await this.deviceManager.terminateApp(this.deviceId, packageToUse);
    // Open then dismiss recents to flush the app from the task switcher
    await this.deviceManager.openRecents(this.deviceId);
    await new Promise(resolve => setTimeout(resolve, 500));
    await this.deviceManager.navigateHome(this.deviceId);
  }

  /**
   * Rest between sessions for a random duration within the configured range
   */
  private async restBetweenSessions(): Promise<void> {
    const [min, max] = this.presets.session.restBetweenSessions;
    const restMinutes = Math.random() * (max - min) + min;
    logger.info(`😴 [Worker] Resting for ${restMinutes.toFixed(0)} minutes before next session...`);

    // Close TikTok and go to home screen before resting
    await this.closeTikTok();

    await new Promise(resolve => setTimeout(resolve, restMinutes * 60 * 1000));
  }

  /**
   * Run Initiating Stage - Launch TikTok and ensure readiness
   */
  async runInitiatingStage(): Promise<boolean> {
    this.currentStage = 'initiating';
    logger.info(`🚀 [Worker] Initiating stage: launching TikTok on ${this.deviceName}`);
    try {
      // Wake screen and unlock if needed
      await this.deviceManager.wakeAndUnlock(this.deviceId);

      // Use detected TikTok package or fallback to preset
      const packageToUse = this.detectedTikTokPackage ?? this.presets.tiktokAppPackage;

      // Launch TikTok
      await this.deviceManager.launchApp(this.deviceId, packageToUse);
      logger.info(`⏳ [Worker] Waiting ${this.presets.tiktokLoadTime}s for TikTok to load`);
      await new Promise(res => setTimeout(res, this.presets.tiktokLoadTime * 1000));
      logger.info(`✅ [Worker] Initiating complete for ${this.deviceName}`);
      return true;
    } catch (error) {
      logger.error(`❌ [Worker] Failed to launch TikTok on ${this.deviceName}:`, error);
      return false;
    }
  }

  /**
   * Start full automation pipeline: Initialize → Learn → Work (in session loop)
   */
  async startAutomation(): Promise<void> {
    logger.info(`🚀 Starting automation pipeline for ${this.deviceName}...`);

    try {
      // Step 1: Initialize (load UI data and tools)
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Step 2: Initiating stage (launch TikTok)
      logger.info(`🚀 Starting initiating stage for ${this.deviceName}...`);
      const initSuccess = await this.runInitiatingStage();
      if (!initSuccess) {
        throw new Error('Initiating stage failed: unable to launch TikTok or wait for it to load. Ensure USB debugging is authorized and TikTok is installed.');
      }

      // Step 3: Learning Stage (skip if we have valid saved data)
      if (!this.hasLearnedUI()) {
        logger.info(`🧠 UI data not found or incomplete, starting learning stage for ${this.deviceName}...`);
        const learningSuccess = await this.runLearningStage();
        if (!learningSuccess) {
          throw new Error('Learning stage failed');
        }
      } else {
        logger.info(`⚡ Skipping learning stage for ${this.deviceName} - using saved UI data`);
        this.currentStage = 'working';
      }

      // Step 4: Session loop
      const { maxSessionsPerDay } = this.presets.session;
      let sessionCount = 0;

      while (this.currentStage === 'working') {
        sessionCount++;
        logger.info(`📱 [Worker] Starting session ${sessionCount}/${maxSessionsPerDay} for ${this.deviceName}`);

        const result = await this.runWorkingSession();

        // Log session summary
        logger.info(
          `📊 [Worker] Session ${sessionCount} summary for ${this.deviceName}: ` +
          `${result.videosWatched} videos, ${result.likesGiven} likes, ${result.commentsPosted} comments, ${result.followsGiven} follows — "${result.message}"`
        );

        // Handle health failure: delete UI data, re-learn, then continue
        if (result.message === 'healthFailureExceeded') {
          logger.warn(`🔄 [Worker] Health failure exceeded for ${this.deviceName}, re-learning UI...`);
          this.learnedUI = {};
          await UIDataPersistence.deleteDeviceUIData(this.deviceId);
          const relaunch = await this.runInitiatingStage();
          if (!relaunch) {
            throw new Error('Failed to re-launch TikTok after health failure');
          }
          const relearn = await this.runLearningStage();
          if (!relearn) {
            throw new Error('Re-learning stage failed after health failure');
          }
          continue;
        }

        // Daily limit reached — done for the day
        if (result.message === 'dailyLimitReached') {
          logger.info(`🛑 [Worker] Daily limit reached for ${this.deviceName}. Stopping for the day.`);
          break;
        }

        // Fatal error or unexpected failure
        if (!result.success) {
          logger.error(`❌ [Worker] Session failed for ${this.deviceName}: ${result.message}`);
          this.currentStage = 'error';
          break;
        }

        // Session completed normally (shouldContinue=true) — check caps then rest
        if (sessionCount >= maxSessionsPerDay) {
          logger.info(`🛑 [Worker] Max sessions per day (${maxSessionsPerDay}) reached for ${this.deviceName}. Done.`);
          break;
        }

        // Rest between sessions
        await this.restBetweenSessions();

        // Re-launch TikTok for the next session
        logger.info(`🔄 [Worker] Re-launching TikTok for next session on ${this.deviceName}...`);
        const relaunchOk = await this.runInitiatingStage();
        if (!relaunchOk) {
          logger.error(`❌ [Worker] Failed to re-launch TikTok for ${this.deviceName}`);
          this.currentStage = 'error';
          break;
        }
      }

      // Close TikTok after session loop ends (daily limit, max sessions, or error)
      await this.closeTikTok();

      // Final summary
      logger.info(
        `🏁 [Worker] Automation complete for ${this.deviceName}: ` +
        `${sessionCount} sessions, ${this.stats.videosWatched} total videos, ` +
        `${this.stats.likesGiven} total likes, ${this.stats.commentsPosted} total comments, ${this.stats.followsGiven} total follows`
      );

    } catch (error) {
      this.currentStage = 'error';
      logger.error(`❌ Automation pipeline failed for ${this.deviceName}:`, error);
      throw error;
    }
  }
} 