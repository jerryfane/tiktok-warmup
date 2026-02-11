import { z } from 'zod';

import type { AutomationPresets } from '../config/presets.js';
import type { LearnedUIElements } from '../core/Worker.js';
import { interactWithScreen } from '../tools/interaction.js';
import { logger } from '../tools/utils.js';

import type { DeviceManager } from '@/core/DeviceManager.js';

/**
 * Working Stage Result Schema
 */
export const WorkingResultSchema = z.object({
  success: z.boolean(),
  videosWatched: z.number(),
  likesGiven: z.number(),
  commentsPosted: z.number(),
  followsGiven: z.number(),
  shouldContinue: z.boolean(),
  message: z.string(),
});

/**
 * Working Stage Action Schema
 */
export const ActionDecisionSchema = z.object({
  action: z.enum(['like', 'comment', 'follow', 'next_video']),
  reason: z.string(),
  commentText: z.string().optional(),
});

/**
 * Comment Generation Schema
 */
export const CommentGenerationSchema = z.object({
  screenLooksLikeNormalTikTokFeed: z.boolean().describe('Whether the screen looks like a normal TikTok feed? Not a shop, popup, etc.'),
  commentText: z.string().describe('The generated comment text, natural and engaging'),
  confidence: z.string().describe('Confidence level: high/medium/low'),
  reasoning: z.string().describe('Why this comment fits the video content'),
});

/**
 * Sanitize text for ADB input - remove emojis and problematic characters
 */
function sanitizeTextForADB(text: string): string {
  const original = text;
  
  const sanitized = text
    .toLowerCase()
    // Keep only lowercase letters and spaces
    .replace(/[^a-z ]/g, '')
    // Clean up extra spaces
    .replace(/\s+/g, ' ')
    .trim();
    
  logger.debug(`🧹 [Working] Text sanitization: "${original}" -> "${sanitized}"`);
  return sanitized;
}

/**
 * Working Stage Implementation
 * Main automation loop that follows presets for viewing, liking, commenting
 */
export class WorkingStage {
  private deviceId: string;
  private deviceManager: DeviceManager;
  private presets: AutomationPresets;
  private learnedUI: LearnedUIElements;
  private tiktokPackage: string;

  private stats = {
    videosWatched: 0,
    likesGiven: 0,
    commentsPosted: 0,
    followsGiven: 0,
    errors: 0,
    sessionStartTime: Date.now(),
    lastActivityTime: Date.now(),
  };
  private healthFailures = 0;
  private healthFailureExceeded = false;
  private needsTopicReSearch = false;

  constructor(
    deviceId: string,
    deviceManager: DeviceManager,
    presets: AutomationPresets,
    learnedUI: LearnedUIElements,
    tiktokPackage?: string
  ) {
    this.deviceId = deviceId;
    this.deviceManager = deviceManager;
    this.presets = presets;
    this.learnedUI = learnedUI;
    this.tiktokPackage = tiktokPackage ?? presets.tiktokAppPackage;
  }

  /**
   * AI-powered screenshot analysis with proper LLM integration
   */
  async takeAndAnalyzeScreenshot(query: string): Promise<string> {
    logger.debug(`📸 [Working] Taking screenshot for analysis: ${query}`);
    
    const prompt = `You are a visual analysis assistant for TikTok automation. Analyze the screenshot and answer the specific question.

**CRITICAL: YOU MUST CALL finish_task AS YOUR FINAL STEP!**

**Your mission:**
1. Take screenshot using take_and_analyze_screenshot
2. Analyze what you see based on the query: "${query}"
3. Provide a clear, concise answer
4. Call finish_task with your analysis result


**STOP RULE: Call finish_task immediately after getting screenshot analysis!**`;

    const AnalysisSchema = z.object({
      result: z.string().describe('The analysis result - answer to the query'),
      confidence: z.string().describe('Confidence level: high/medium/low'),
      details: z.string().describe('Additional details about what was observed'),
    });

    try {
      const result = await interactWithScreen<z.infer<typeof AnalysisSchema>>(
        prompt, 
        this.deviceId, 
        this.deviceManager, 
        {}, 
        AnalysisSchema
      );
      
      logger.debug(`🔍 [Working] Analysis result: ${result.result} (confidence: ${result.confidence})`);
      return JSON.stringify(result.result);
    } catch (error) {
      logger.error(`❌ [Working] Screenshot analysis failed:`, error);
      return "ERROR: Failed to analyze screenshot";
    }
  }

  /**
   * Wait for specified duration
   */
  private async wait(seconds: number, reason: string): Promise<void> {
    logger.debug(`⏳ [Working] Waiting ${seconds.toFixed(1)}s: ${reason}`);
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }

  /**
   * Decide what action(s) to take based on presets and AI analysis
   */
  decideAction(): Array<z.infer<typeof ActionDecisionSchema>> {
    // Roll dice for actions based on presets
    const likeRoll = Math.random();
    const commentRoll = Math.random();
    const decisions: Array<z.infer<typeof ActionDecisionSchema>> = [];

    // Like decision
    if (likeRoll < this.presets.interactions.likeChance) {
      decisions.push({
        action: 'like',
        reason: `Random like roll: ${likeRoll.toFixed(3)} < ${this.presets.interactions.likeChance}`,
      });
    }

    // Comment decision
    if (commentRoll < this.presets.interactions.commentChance) {
      decisions.push({
        action: 'comment',
        reason: `Random comment roll: ${commentRoll.toFixed(3)} < ${this.presets.interactions.commentChance}`,
      });
    }

    // Follow decision
    const followRoll = Math.random();
    if (followRoll < this.presets.interactions.followChance) {
      decisions.push({
        action: 'follow',
        reason: `Random follow roll: ${followRoll.toFixed(3)} < ${this.presets.interactions.followChance}`,
      });
    }

    // If no actions, skip
    if (decisions.length === 0) {
      decisions.push({
        action: 'next_video',
        reason: `No action triggered. Like: ${likeRoll.toFixed(3)}, Comment: ${commentRoll.toFixed(3)}, Follow: ${followRoll.toFixed(3)}`,
      });
    }

    return decisions;
  }

  /**
   * Execute like action
   */
  async executeLike(): Promise<boolean> {
    try {
      if (!this.learnedUI.likeButton) {
        logger.error(`❌ [Working] Like button coordinates not learned`);
        return false;
      }

      const { x, y } = this.learnedUI.likeButton;
      logger.info(`❤️ [Working] Liking video at (${x}, ${y})`);
      
      // Use deviceManager to tap
      await this.deviceManager.tapScreen(this.deviceId, x, y);
      
      await this.wait(0.5, 'After like tap');
      this.stats.likesGiven++;
      
      return true;
    } catch (error) {
      logger.error(`❌ [Working] Like action failed:`, error);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Execute follow action
   */
  async executeFollow(): Promise<boolean> {
    try {
      if (!this.learnedUI.followButton) {
        logger.warn(`⚠️ [Working] Follow button coordinates not learned, skipping`);
        return false;
      }

      logger.info(`👤 [Working] Following creator via profile page`);

      // Step 1: Swipe left to open creator profile
      const screenSize = await this.deviceManager.getScreenSize(this.deviceId);
      const centerY = Math.floor(screenSize.height / 2);
      const startX = Math.floor(screenSize.width * 0.1);
      const endX = Math.floor(screenSize.width * 0.9);

      await this.deviceManager.swipeScreen(this.deviceId, endX, centerY, startX, centerY, 300);
      await this.wait(2, 'Waiting for profile page to load');

      // Step 2: Tap the Follow button at learned coordinates
      const { x, y } = this.learnedUI.followButton;
      logger.info(`👤 [Working] Tapping Follow button at (${x}, ${y})`);
      await this.deviceManager.tapScreen(this.deviceId, x, y);
      await this.wait(1, 'After follow tap');

      // Step 3: Press back to return to feed
      await this.deviceManager.navigateBack(this.deviceId);
      await this.wait(1, 'Returning to feed after follow');

      this.stats.followsGiven++;
      logger.info(`✅ [Working] Follow completed, returned to feed`);
      return true;
    } catch (error) {
      logger.error(`❌ [Working] Follow action failed:`, error);
      this.stats.errors++;
      // Try to get back to feed if something went wrong
      try {
        await this.deviceManager.navigateBack(this.deviceId);
      } catch {
        /* ignore */
      }
      return false;
    }
  }

  /**
   * Execute comment action with two-phase AI generation
   * Phase 1: Analyze video content while it's fully visible
   * Phase 2: Open comments, read existing comments, generate contextual reply
   */
  async executeComment(): Promise<boolean> {
    try {
      if (!this.learnedUI.commentButton || !this.learnedUI.commentInputField || !this.learnedUI.commentSendButton) {
        logger.error(`❌ [Working] Comment UI coordinates not fully learned`);
        return false;
      }

      let commentText: string;

      if (this.presets.comments.useAI) {
        try {
          // Phase 1: Analyze video content while fully visible (before opening comments)
          const VideoContextSchema = z.object({
            videoContext: z.string().describe('Description of the video content, mood, and type'),
          });

          const phase1Prompt = `Analyze this TikTok video. Take a screenshot and describe:
- What the video is about (subject, activity)
- The mood/energy (funny, calm, exciting, educational, etc.)
- The type of content (dance, tutorial, comedy, food, aesthetic, etc.)

**CRITICAL: YOU MUST CALL finish_task AS YOUR FINAL STEP!**

**Your workflow:**
1. take_and_analyze_screenshot(query="What is this TikTok video about? Describe the subject, mood, and content type.", action="answer_question")
2. finish_task with your description in videoContext

**STOP RULE: Call finish_task immediately after getting screenshot analysis!**`;

          const phase1Result = await interactWithScreen<z.infer<typeof VideoContextSchema>>(
            phase1Prompt,
            this.deviceId,
            this.deviceManager,
            {},
            VideoContextSchema,
            3
          );

          const { videoContext } = phase1Result;
          logger.debug(`📹 [Working] Phase 1 video context: "${videoContext}"`);

          // Open comments section
          const { x: commentX, y: commentY } = this.learnedUI.commentButton;
          await this.deviceManager.tapScreen(this.deviceId, commentX, commentY);
          await this.wait(1.5, 'Waiting for comments to load');

          // Phase 2: Read existing comments and generate a contextual comment
          const phase2Prompt = `You are generating a TikTok comment. You have two sources of context:

**Video context:** ${videoContext}

**CRITICAL: YOU MUST CALL finish_task AS YOUR FINAL STEP!**

**Your workflow:**
1. take_and_analyze_screenshot(query="Read ALL existing comments visible in the TikTok comments section. List what people are saying.", action="answer_question")
2. Generate a comment that:
   - Engages with what other commenters are saying (agree, add perspective, react)
   - Matches the video's tone and content from the context above
   - Feels like a real person joining the conversation, not a bot
   - Is varied - don't repeat what others already said
3. finish_task with:
   - screenLooksLikeNormalTikTokFeed: true/false (are we in a normal TikTok comments section?)
   - commentText: your generated comment
   - confidence: your confidence level
   - reasoning: brief explanation

**STRICT TECHNICAL RULES:**
- Keep under ${this.presets.comments.maxLength} characters
- ONLY lowercase letters a-z and spaces
- NO punctuation, emojis, symbols, or special characters
- Examples: "this is amazing", "love this energy", "so helpful thanks"

**STOP RULE: Always call finish_task with your contextual comment!**`;

          const phase2Result = await interactWithScreen<z.infer<typeof CommentGenerationSchema>>(
            phase2Prompt,
            this.deviceId,
            this.deviceManager,
            {},
            CommentGenerationSchema
          );

          if (!phase2Result.screenLooksLikeNormalTikTokFeed) {
            logger.warn(`⚠️ [Working] Screen is not a normal TikTok feed/comments, skipping comment`);
            await this.deviceManager.navigateBack(this.deviceId);
            await this.wait(1, 'After closing non-feed screen');
            return false;
          }

          const sanitizedComment = sanitizeTextForADB(phase2Result.commentText);
          commentText = sanitizedComment.slice(0, this.presets.comments.maxLength);
          logger.info(`🤖 [Working] AI generated comment: "${commentText}" (confidence: ${phase2Result.confidence})`);
        } catch (error) {
          logger.warn(`⚠️ [Working] AI comment generation failed, using template`, error);
          const { templates } = this.presets.comments;
          commentText = sanitizeTextForADB(templates[Math.floor(Math.random() * templates.length)]);

          // Ensure comments section is open (phase 1 may have succeeded before failure)
          const { x: commentX, y: commentY } = this.learnedUI.commentButton;
          await this.deviceManager.tapScreen(this.deviceId, commentX, commentY);
          await this.wait(1, 'After comment button tap (fallback)');
        }
      } else {
        const { templates } = this.presets.comments;
        commentText = sanitizeTextForADB(templates[Math.floor(Math.random() * templates.length)]);

        // Open comments section
        const { x: commentX, y: commentY } = this.learnedUI.commentButton;
        await this.deviceManager.tapScreen(this.deviceId, commentX, commentY);
        await this.wait(1, 'After comment button tap');
      }

      logger.info(`💬 [Working] Commenting: "${commentText}"`);

      // Tap input field
      const { x: inputX, y: inputY } = this.learnedUI.commentInputField;
      await this.deviceManager.tapScreen(this.deviceId, inputX, inputY);
      await this.wait(0.5, 'After input field tap');

      // Type comment text
      await this.deviceManager.inputText(this.deviceId, commentText);
      await this.wait(0.5, 'After typing comment');

      // Click send button
      const { x: sendX, y: sendY } = this.learnedUI.commentSendButton;
      await this.deviceManager.tapScreen(this.deviceId, sendX, sendY);
      await this.wait(2, 'After send button tap');

      // Verify comment was posted
      const verification = await this.takeAndAnalyzeScreenshot(
        `Is the text "${commentText}" visible in list of comments, because we sent it? Answer YES if the text is there, NO if not visible.`
      );

      if (!verification.toUpperCase().includes('YES')) {
        logger.warn(`⚠️ [Working] Comment text verification failed: ${verification}`);
        await this.performHealthCheck();
      }

      this.stats.commentsPosted++;

      // Close comment interface
      await this.deviceManager.navigateBack(this.deviceId);
      await this.wait(1, 'After closing comment interface');
      logger.info(`✅ [Working] Comment interface closed successfully`);
      return true;

    } catch (error) {
      logger.error(`❌ [Working] Comment action failed:`, error);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Compare two base64-encoded screenshots by sampling raw bytes.
   * Returns a similarity score: ~1.0 means identical, <0.95 means different content.
   */
  private compareScreenshots(before: string, after: string): number {
    const bufA = Buffer.from(before, 'base64');
    const bufB = Buffer.from(after, 'base64');

    // If file sizes differ significantly, screens are clearly different
    const lengthRatio = Math.min(bufA.length, bufB.length) / Math.max(bufA.length, bufB.length);
    if (lengthRatio < 0.9) return lengthRatio;

    // Sample ~1000 evenly-spaced bytes and compare
    const minLen = Math.min(bufA.length, bufB.length);
    const step = Math.max(1, Math.floor(minLen / 1000));
    let matches = 0;
    let total = 0;
    for (let i = 0; i < minLen; i += step) {
      if (bufA[i] === bufB[i]) matches++;
      total++;
    }
    return matches / total;
  }

  /**
   * Scroll to next video with verification and progressive retry
   */
  async scrollToNextVideo(): Promise<boolean> {
    try {
      logger.debug(`📱 [Working] Scrolling to next video`);

      const maxRetries = 2;
      const screenSize = await this.deviceManager.getScreenSize(this.deviceId);
      const centerX = Math.floor(screenSize.width / 2);

      const beforeScreenshot = await this.deviceManager.takeScreenshot(this.deviceId);

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        // Progressive swipe: each retry covers more distance, faster
        const startPct = attempt === 0 ? 0.7 : 0.85;
        const endPct = attempt === 0 ? 0.3 : 0.15;
        const duration = attempt === 0 ? 300 : 200;

        const startY = Math.floor(screenSize.height * startPct);
        const endY = Math.floor(screenSize.height * endPct);

        await this.deviceManager.swipeScreen(this.deviceId, centerX, startY, centerX, endY, duration);

        const scrollDelay = this.getAdaptiveDelay(this.presets.video.scrollDelay);
        await this.wait(scrollDelay, 'Scroll delay between videos');

        const afterScreenshot = await this.deviceManager.takeScreenshot(this.deviceId);
        const similarity = this.compareScreenshots(beforeScreenshot, afterScreenshot);

        if (similarity < 0.95) {
          // Screen changed — swipe worked
          return true;
        }

        logger.warn(`⚠️ [Working] Screen unchanged after swipe attempt ${attempt + 1} (similarity: ${similarity.toFixed(2)}), retrying...`);
      }

      // All retries exhausted — try pressing back and swiping (escape overlay/carousel)
      logger.warn(`⚠️ [Working] Swipe stuck after ${maxRetries + 1} attempts, pressing back and retrying`);
      await this.deviceManager.navigateBack(this.deviceId);
      await this.wait(1, 'After back press');

      const startY = Math.floor(screenSize.height * 0.85);
      const endY = Math.floor(screenSize.height * 0.15);
      await this.deviceManager.swipeScreen(this.deviceId, centerX, startY, centerX, endY, 200);
      await this.wait(1, 'After final swipe attempt');

      return true;
    } catch (error) {
      logger.error(`❌ [Working] Scroll action failed:`, error);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Watch current video for configured duration
   */
  async watchVideo(): Promise<void> {
    // Roll dice for quick skip (1 in 5 videos)
    const skipRoll = Math.random();
    
    if (skipRoll < this.presets.video.quickSkipChance) {
      // Quick skip - watch for just 1 second
      logger.debug(`⚡ [Working] Quick skip - watching for ${this.presets.video.quickSkipDuration}s`);
      await this.wait(this.presets.video.quickSkipDuration, 'Quick skip viewing');
    } else {
      // Normal watch duration
      const watchDuration = this.getAdaptiveDelay(this.presets.video.watchDuration);
      logger.debug(`👀 [Working] Normal viewing - watching for ${watchDuration.toFixed(1)}s`);
      await this.wait(watchDuration, 'Normal video viewing');
    }
  }

  /**
   * Execute single video automation cycle
   */
  async processVideo(): Promise<boolean> {
    try {
      logger.info(`🎬 [Working] Processing video #${this.stats.videosWatched + 1}`);

      // Re-search for topic if needed (after health check app restart)
      if (this.needsTopicReSearch && this.presets.searchTopic) {
        logger.info(`🔄 [Working] Re-searching for topic after health check recovery`);
        await this.searchForTopic(this.presets.searchTopic);
        this.needsTopicReSearch = false;
      }

      // Step 1: Watch video (skip waiting on first video)
      if (this.stats.videosWatched === 0) {
        logger.info(`⚡ [Working] First video - starting immediately without watching delay`);
      } else {
        await this.watchVideo();
      }
      
      // Step 2: Health check
      const { healthCheckInterval, maxHealthFailures, shadowBanInterval } = this.presets.control;
      if (this.stats.videosWatched > 0 && this.stats.videosWatched % healthCheckInterval === 0) {
        logger.info(`🩺 [Working] Performing health check on video #${this.stats.videosWatched + 1}`);
        const healthOk = await this.performHealthCheck();
        if (!healthOk) {
          this.healthFailures++;
          logger.warn(`⚠️ [Working] Health check failed (${this.healthFailures}/${maxHealthFailures})`);
          if (this.healthFailures >= maxHealthFailures) {
            logger.error(`❌ [Working] Health check failed ${maxHealthFailures} times, need to retrain UI coordinates`);
            this.healthFailureExceeded = true;
            return false;
          }
        } else {
          this.healthFailures = 0;
        }
      }
      // Shadow ban detection
      if (this.stats.videosWatched > 0 && this.stats.videosWatched % shadowBanInterval === 0) {
        logger.info(`🕵️ [Working] Checking for shadow ban on video #${this.stats.videosWatched + 1}`);
        const shadowBanned = await this.detectShadowBan();
        if (shadowBanned) {
          logger.warn(`🚫 [Working] Shadow ban detected! Reducing activity and adding longer delays`);
          await this.wait(300, 'Shadow ban recovery delay');
        }
      }
      
      // Step 3 + 4: Decide actions and scroll to next video
      const decisions = this.decideAction();
      logger.info(`🎯 [Working] Decided to do ${decisions.length} actions: ${decisions.map(d => d.action).join(', ')}`);
      for (const decision of decisions) {
        logger.info(`🎯 [Working] Action decision: ${decision.action} - ${decision.reason}`);
        switch (decision.action) {
          case 'like':
            await this.executeLike();
            break;
          case 'comment':
            await this.executeComment();
            break;
          case 'follow':
            await this.executeFollow();
            break;
          case 'next_video':
            logger.debug(`⏭️ [Working] Moving to next video (later)`);
            break;
          default:
            logger.error(`❌ [Working] Unknown action: ${decision.action}`);
            break;
        }
      }

      // Step 4: Scroll to next video
      await this.scrollToNextVideo();
      
      // Step 5: Increment video counter AFTER processing is complete
      this.stats.videosWatched++;
      
      // Check daily limits
      const totalActions = this.stats.likesGiven + this.stats.commentsPosted + this.stats.followsGiven;
      if (totalActions >= this.presets.interactions.dailyLimit) {
        logger.info(`🛑 [Working] Daily limit reached: ${totalActions}/${this.presets.interactions.dailyLimit}`);
        return false; // Stop automation
      }
      
      return true; // Continue automation
      
    } catch (error) {
      logger.error(`❌ [Working] Video processing failed:`, error);
      this.stats.errors++;
      return true; // Continue despite errors
    }
  }

  /**
   * Perform health check every 10th video to ensure we're still on normal TikTok
   */
  async performHealthCheck(): Promise<boolean> {
    logger.info(`🩺 [Working] Running health check...`);
    
    const prompt = `You are a TikTok automation health checker. Your mission is to verify we're still on normal TikTok and fix any issues.

**CRITICAL: YOU MUST CALL finish_task AS YOUR FINAL STEP (max 6 steps total)!**

**STEP-BY-STEP FLOW:**
1. take_and_analyze_screenshot(query="Check if this is normal TikTok video feed with like/comment buttons visible", action="answer_question")
2. IF normal TikTok -> finish_task(success=true, currentState="Normal TikTok", problemsDetected=[], actionsPerformed=[], message="All good")
3. IF problems detected -> try to fix them using available tools
4. After attempting fixes -> take another screenshot to verify
5. finish_task with final result

**Common problems to fix:**
- Login screens → use interact_with_screen to close or go back
- Ad overlays → find X button and tap it
- Update prompts → dismiss with "Later" or X
- Wrong tab → tap "For You" tab
- Popups → find close button
- App crashed → launch_app_activity(package_name="${this.tiktokPackage}")

If you see - "Find related content", some user profile or any other strange UI not related to normal TikTok video feed - it means that you are stuck. Just restart the app.

If something goes wrong, good solution - it to terminate and launch app again.

Before finishing the task, make sure to take a screenshot of the screen and analyze it to confirm that the problems are fixed/solved.

**STOP RULE: ALWAYS call finish_task after max 10 steps!**`;

    const HealthCheckSchema = z.object({
      success: z.boolean(),
      problemWasFixed: z.boolean().describe('Whether the problems were fixed'),
      currentState: z.string().describe('Description of what was found on screen'),
      problemsDetected: z.array(z.string()).describe('List of issues found'),
      actionsPerformed: z.array(z.string()).describe('List of actions taken to fix issues'),
    });

    try {
      const result = await interactWithScreen<z.infer<typeof HealthCheckSchema>>(
        prompt, 
        this.deviceId, 
        this.deviceManager, 
        {}, 
        HealthCheckSchema
      );
      
      if (result.success) {
        logger.info(`✅ [Working] Health check passed`);
        if (result.actionsPerformed.length > 0) {
          logger.info(`🔧 [Working] Fixed issues: ${result.actionsPerformed.join(', ')}`);
          this.needsTopicReSearch = true;
        }
      } else {
        logger.error(`❌ [Working] Health check failed`);
        logger.error(`🚨 [Working] Problems detected: ${result.problemsDetected.join(', ')}`);
        if (result.actionsPerformed.length > 0) {
          logger.info(`🔧 [Working] Attempted fixes: ${result.actionsPerformed.join(', ')}`);
        }
      }

      if (!result.success) {
        this.healthFailures++;
        logger.warn(`⚠️ [Working] Health check failed (${this.healthFailures}/3)`);
        if (this.healthFailures >= 3) {
          logger.error(`❌ [Working] Health check failed 3 times, need to retrain UI coordinates`);
          this.healthFailureExceeded = true;
        }
      } else {
        this.healthFailures = 0;
      }
      
      return result.success;
    } catch (error) {
      logger.error(`❌ [Working] Health check error:`, error);
      return false;
    }
  }

  /**
   * Search for a specific topic before scrolling videos
   * Uses learned coordinates when available, falls back to hardcoded percentages (0 API calls)
   */
  async searchForTopic(topic: string): Promise<boolean> {
    logger.info(`🔍 [Working] Searching for topic: "${topic}"`);

    try {
      const screenSize = await this.deviceManager.getScreenSize(this.deviceId);
      const centerX = Math.floor(screenSize.width / 2);

      // Step 1: Tap the search bar (use learned position or fallback to ~86% Y)
      const searchBarX = this.learnedUI.searchBar?.x ?? centerX;
      const searchBarY = this.learnedUI.searchBar?.y ?? Math.floor(screenSize.height * 0.86);
      await this.deviceManager.tapScreen(this.deviceId, searchBarX, searchBarY);
      await this.wait(1.5, 'Wait for search page to load');

      // Step 2: Type the search topic
      await this.deviceManager.inputText(this.deviceId, topic);
      await this.wait(0.5, 'After typing search query');

      // Step 3: Press Enter to submit search
      await this.deviceManager.pressKey(this.deviceId, 66);
      await this.wait(3, 'Wait for search results to load');

      // Step 4: Tap first result (use learned position or fallback to ~25% X, ~33% Y)
      const firstResultX = this.learnedUI.firstSearchResult?.x ?? Math.floor(screenSize.width * 0.25);
      const firstResultY = this.learnedUI.firstSearchResult?.y ?? Math.floor(screenSize.height * 0.33);
      await this.deviceManager.tapScreen(this.deviceId, firstResultX, firstResultY);
      await this.wait(2, 'Wait for video to start playing');

      logger.info(`✅ [Working] Topic search completed for: "${topic}"`);
      return true;
    } catch (error) {
      logger.error(`❌ [Working] Error searching for topic:`, error);
      return false;
    }
  }

  /**
   * Ensure TikTok is ready using the same pattern as learning stage
   */
  async ensureTikTokReady(): Promise<boolean> {
    logger.info(`🔍 [Working] Ensuring TikTok is ready...`);
    
    const prompt = `You are a TikTok automation agent ensuring the app is ready before starting work.

**CRITICAL: YOU MUST CALL finish_task AS YOUR FINAL STEP!**

**Your mission (maximum 3-4 steps):**
1. Take screenshot to check current state
2. If TikTok already visible -> call finish_task immediately with success:true
3. If TikTok not running -> launch it, wait, verify, then finish_task
If something is wrong, try to fix it, if you can't, call finish_task with success:false
You can tap, swipe, scroll, etc.

**STEP-BY-STEP FLOW:**
1. take_and_analyze_screenshot(query="Is the TikTok app currently open and is the main video feed visible?", action="answer_question")
2. IF result shows TikTok ready -> finish_task(success=true, message="TikTok is already running")
3. IF TikTok not ready -> launch_app_activity(package_name="${this.tiktokPackage}")
4. wait_for_ui(seconds=5, reason="Wait for TikTok to load after launching")
5. take_and_analyze_screenshot to verify
6. finish_task with final result

**STOP RULE: Call finish_task when TikTok is confirmed ready or if after 10 attempts you can't fix it!**`;

    const ResultSchema = z.object({
      success: z.boolean(),
      message: z.string(),
    });

    try {
      const result = await interactWithScreen<z.infer<typeof ResultSchema>>(
        prompt, 
        this.deviceId, 
        this.deviceManager, 
        {}, 
        ResultSchema
      );
      
      if (result.success) {
        logger.info(`✅ [Working] TikTok is ready: ${result.message}`);
      } else {
        logger.error(`❌ [Working] TikTok not ready: ${result.message}`);
      }
      
      return result.success;
    } catch (error) {
      logger.error(`❌ [Working] Error ensuring TikTok ready:`, error);
      return false;
    }
  }

  /**
   * Check for potential shadow ban by analyzing engagement patterns
   */
  async detectShadowBan(): Promise<boolean> {
    // Simple heuristic: if we've liked 20+ videos but haven't seen any likes register
    if (this.stats.likesGiven >= 20) {
      const prompt = `You are a shadow ban detector. Check if our recent likes are registering properly.

**CRITICAL: YOU MUST CALL finish_task AS YOUR FINAL STEP!**

**Your mission:**
1. take_and_analyze_screenshot(query="Look at the like button - is it highlighted/red showing our like registered?", action="answer_question")  
2. finish_task with analysis

Check if the like button appears active/highlighted (usually red heart) which would indicate our likes are registering.

**STOP RULE: Call finish_task immediately after screenshot analysis!**`;

      const ShadowBanSchema = z.object({
        shadowBanned: z.boolean(),
        reason: z.string(),
        confidence: z.string(),
      });

      try {
        const result = await interactWithScreen<z.infer<typeof ShadowBanSchema>>(
          prompt, 
          this.deviceId, 
          this.deviceManager, 
          {}, 
          ShadowBanSchema
        );
        
        if (result.shadowBanned) {
          logger.warn(`🚫 [Working] Potential shadow ban detected: ${result.reason}`);
          return true;
        }
        
        logger.debug(`✅ [Working] No shadow ban detected: ${result.reason}`);
        return false;
      } catch (error) {
        logger.error(`❌ [Working] Shadow ban detection failed:`, error);
        return false;
      }
    }
    
    return false;
  }

  /**
   * Adaptive delays based on time of day and activity
   */
  private getAdaptiveDelay(baseRange: [number, number]): number {
    const hour = new Date().getHours();
    const [min, max] = baseRange;
    
    // Slower during peak hours (12-18) to seem more human
    const peakMultiplier = (hour >= 12 && hour <= 18) ? 1.5 : 1.0;
    
    // Add some randomness based on current stats to avoid patterns
    const activityMultiplier = 1 + (this.stats.likesGiven * 0.01); // Slower as we do more
    
    const adjustedMin = min * peakMultiplier * activityMultiplier;
    const adjustedMax = max * peakMultiplier * activityMultiplier;
    
    return Math.random() * (adjustedMax - adjustedMin) + adjustedMin;
  }

  /**
   * Execute working stage with automation loop
   */
  async execute(): Promise<z.infer<typeof WorkingResultSchema>> {
    logger.info(`🚀 [Working] Starting automation loop for device: ${this.deviceId}`);

    // Step 0: Ensure TikTok is ready before automation
    const tiktokReady = await this.ensureTikTokReady();
    if (!tiktokReady) {
      return {
        success: false,
        videosWatched: 0,
        likesGiven: 0,
        commentsPosted: 0,
        followsGiven: 0,
        shouldContinue: false,
        message: 'Failed to ensure TikTok is ready for automation',
      };
    }

    // Step 0.5: Search for topic if configured
    if (this.presets.searchTopic) {
      const searchOk = await this.searchForTopic(this.presets.searchTopic);
      if (!searchOk) {
        logger.warn(`⚠️ [Working] Topic search failed, continuing with current feed`);
      }
    }

    // Pick a random session size from the preset range
    const [minVideos, maxVideos] = this.presets.session.videosPerSession;
    const sessionSize = Math.floor(Math.random() * (maxVideos - minVideos + 1)) + minVideos;
    logger.info(`🎯 [Working] Session target: ${sessionSize} videos`);

    let shouldContinue = true;
    let consecutiveErrors = 0;
    const {maxConsecutiveErrors} = this.presets.control;

    try {
      while (shouldContinue) {
        const success = await this.processVideo();

        if (!success) {
          shouldContinue = false;
          break;
        }

        // Check session video limit
        if (this.stats.videosWatched >= sessionSize) {
          logger.info(`🎯 [Working] Session target reached: ${this.stats.videosWatched}/${sessionSize} videos`);
          // shouldContinue stays true — signals the caller to schedule another session
          break;
        }

        // Error handling
        if (this.stats.errors > 0) {
          consecutiveErrors++;
          if (consecutiveErrors >= maxConsecutiveErrors) {
            logger.error(`❌ [Working] Too many consecutive errors (${consecutiveErrors}), stopping`);
            shouldContinue = false;
            break;
          }
        } else {
          consecutiveErrors = 0; // Reset on success
        }

        // Log progress every 10 videos with engagement metrics
        if (this.stats.videosWatched % 10 === 0 && this.stats.videosWatched > 0) {
          const sessionDuration = (Date.now() - this.stats.sessionStartTime) / 1000 / 60; // minutes
          const videosPerMinute = (this.stats.videosWatched / sessionDuration).toFixed(1);
          const engagementRate = ((this.stats.likesGiven + this.stats.commentsPosted + this.stats.followsGiven) / this.stats.videosWatched * 100).toFixed(1);

          logger.info(`📊 [Working] Progress: ${this.stats.videosWatched} videos, ${this.stats.likesGiven} likes, ${this.stats.commentsPosted} comments, ${this.stats.followsGiven} follows`);
          logger.info(`📈 [Working] Metrics: ${videosPerMinute} videos/min, ${engagementRate}% engagement rate, ${sessionDuration.toFixed(1)}m session`);
        }
      }

      // If health check failed too often, prompt retraining
      if (this.healthFailureExceeded) {
        return {
          success: false,
          videosWatched: this.stats.videosWatched,
          likesGiven: this.stats.likesGiven,
          commentsPosted: this.stats.commentsPosted,
          followsGiven: this.stats.followsGiven,
          shouldContinue: false,
          message: 'healthFailureExceeded',
        };
      }

      // Daily limit hit (processVideo returned false)
      const totalActions = this.stats.likesGiven + this.stats.commentsPosted + this.stats.followsGiven;
      if (!shouldContinue && totalActions >= this.presets.interactions.dailyLimit) {
        return {
          success: true,
          videosWatched: this.stats.videosWatched,
          likesGiven: this.stats.likesGiven,
          commentsPosted: this.stats.commentsPosted,
          followsGiven: this.stats.followsGiven,
          shouldContinue: false,
          message: 'dailyLimitReached',
        };
      }

      return {
        success: true,
        videosWatched: this.stats.videosWatched,
        likesGiven: this.stats.likesGiven,
        commentsPosted: this.stats.commentsPosted,
        followsGiven: this.stats.followsGiven,
        shouldContinue,
        message: `Session completed. Videos: ${this.stats.videosWatched}, Likes: ${this.stats.likesGiven}, Comments: ${this.stats.commentsPosted}, Follows: ${this.stats.followsGiven}`,
      };

    } catch (error) {
      logger.error(`❌ [Working] Automation loop failed:`, error);
      return {
        success: false,
        videosWatched: this.stats.videosWatched,
        likesGiven: this.stats.likesGiven,
        commentsPosted: this.stats.commentsPosted,
        followsGiven: this.stats.followsGiven,
        shouldContinue: false,
        message: `Automation failed: ${error}`,
      };
    }
  }

  /**
   * Cleanup and disconnect
   */
  async cleanup() {
    try {
      logger.info(`🧹 [Working] Cleaning up automation session`);
      // Could add cleanup logic here if needed
    } catch (error) {
      logger.warn(`⚠️ [Working] Cleanup warning:`, error);
    }
  }
}

/**
 * Direct Working Stage Execution
 */
export async function runWorkingStage(
  deviceId: string,
  deviceManager: DeviceManager,
  presets: AutomationPresets,
  learnedUI: LearnedUIElements,
  tiktokPackage?: string
): Promise<z.infer<typeof WorkingResultSchema>> {
  const stage = new WorkingStage(deviceId, deviceManager, presets, learnedUI, tiktokPackage);

  try {
    return await stage.execute();
  } finally {
    await stage.cleanup();
  }
} 