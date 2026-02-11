import { z } from 'zod';

import type { AutomationPresets } from '@/config/presets.js';
import type { DeviceManager } from '@/core/DeviceManager.js';
import { interactWithScreen } from '@/tools/interaction.js';
/**
 * Learning Stage Result Schema
 */
const LearningResultSchema = z.object({
  success: z.boolean(),
  tiktokLaunched: z.boolean(),
  uiElementsFound: z.object({
    commentInputField: z.object({
      found: z.boolean(),
      coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
      boundingBox: z.object({ y1: z.number(), x1: z.number(), y2: z.number(), x2: z.number() }).optional(),
      confidence: z.number().nullable().optional(),
      label: z.string().optional(),
    }),
    commentSendButton: z.object({
      found: z.boolean(),
      coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
      boundingBox: z.object({ y1: z.number(), x1: z.number(), y2: z.number(), x2: z.number() }).optional(),
      confidence: z.number().nullable().optional(),
      label: z.string().optional(),
    }),
    followButton: z.object({
      found: z.boolean(),
      coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
      boundingBox: z.object({ y1: z.number(), x1: z.number(), y2: z.number(), x2: z.number() }).optional(),
      confidence: z.number().nullable().optional(),
      label: z.string().optional(),
    }),
  }),
  nextStage: z.enum(['learning', 'working']),
  message: z.string(),
  stepsUsed: z.number(),
});

const getPrompt = (tiktokPackage: string) => `You are a TikTok automation agent in the LEARNING stage. Your mission is to learn the comment flow and follow button coordinates.

    1. **FIRST**: Check device connection and launch TikTok app
    If not - find the app and launch it using launchApp with package name: "${tiktokPackage}"
    2. **THEN**: Take screenshots to confirm you are on the main TikTok video feed.

    **IMPORTANT RULES:**
    - Use the provided tools to interact with the phone
    - Take screenshots frequently to see current state.
    - If TikTok is not open, launch it using launchApp with packageName: "${tiktokPackage}"
    - Be patient - wait for UI to load between actions
    - Try different approaches if first attempts fail
    - **MUST LEARN COMMENT FLOW**: Don't finish until you've found comment input and send button
    - Only return success:true when ALL required UI elements are found (comment input, send button, and follow button)

    **Error Handling:**
    - If you can't reach the goal. Maybe some coordinates are wrong. Try to find the object again.

    ## Comment Learning Sequence:
    1. Find the "Add comment..." bar at the BOTTOM of the video feed screen (NOT the search bar at the top). This is a text input bar visible on the main feed without opening any overlay.
    2. Tap the "Add comment..." bar to activate the comment input field. Record its coordinates as "commentInputField".
    3. Wait 1 second for the keyboard and comment UI to appear.
    4. Take a screenshot to analyze the comment interface.
    5. Type "Nice video" (or any other realistic test comment).
    6. Take screenshot to confirm text entered.
    7. Find the red/colored send button and record its coordinates as "commentSendButton".
    8. Click send button to actually post the comment (the send button in TikTok UI, not the keyboard button).
    9. Wait 2s for comment to be posted (after sending, TikTok auto-returns to the feed).
    10. Save all coordinates for working stage.

    ## Follow Button Learning Sequence (after comment flow):
    1. On the video feed, swipe from the CENTER of the screen to the LEFT to open the creator's profile page.
       - Use swipeScreen: from center (width/2, height/2) to left (width*0.1, height/2) with duration 300ms
    2. Wait 2 seconds for the profile page to load.
    3. Take a screenshot and find the RED "Follow" button on the profile page.
       - Use: take_and_analyze_screenshot(query="find the red Follow button on this TikTok profile page", action="find_object")
       - It's a prominent red/pink button, usually near the top of the profile
       - If the button says "Following" or "Friends", the user is already followed — still record the coordinates
    4. Save the Follow button coordinates as "followButton".
    5. Press Android back button to return to the video feed.
    6. Wait 1 second for the feed to reload.

    ## How to finish the learning stage
    Run final function 'finish_task' with the result.
    Do not close keyboard using other tools. it should be closed automatically by submitting comment.

    - When you have found ALL UI elements (commentInputField, commentSendButton, AND followButton), return success:true
    - If missing any UI elements, return success:false

    For screenshot, use take_and_analyze_screenshot tool. But use it only for one query per call.

    Start by checking device connection and launching TikTok!`

/**
 * Learning Stage Implementation
 * Uses AI SDK generateObject with maxSteps to learn TikTok interface
 */
export class LearningStage {
  private deviceId: string;
  private deviceManager: DeviceManager;
  private presets: AutomationPresets;

  constructor(deviceId: string, deviceManager: DeviceManager, presets: AutomationPresets) {
    this.deviceId = deviceId;
    this.deviceManager = deviceManager;
    this.presets = presets;
  }
  
  /**
   * Execute learning stage with AI agent
   */
  async execute(tiktokPackage?: string): Promise<z.infer<typeof LearningResultSchema>> {
    console.log(`🧠 [Learning] Starting learning stage for device: ${this.deviceId}`);

    const packageToUse = tiktokPackage ?? this.presets.tiktokAppPackage;
    const prompt = getPrompt(packageToUse);
    return await interactWithScreen<z.infer<typeof LearningResultSchema>>(prompt, this.deviceId, this.deviceManager, {}, LearningResultSchema);
  }

  /**
   * Cleanup and disconnect
   */
  async cleanup() {
    try {
      // TODO: Implement cleanup
    } catch (error) {
      console.warn(`⚠️ [Learning] Cleanup warning:`, error);
    }
  }
}

/**
 * UI element shape reused across schemas
 */
const uiElementSchema = z.object({
  found: z.boolean(),
  coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
  boundingBox: z.object({ y1: z.number(), x1: z.number(), y2: z.number(), x2: z.number() }).optional(),
  confidence: z.number().nullable().optional(),
  label: z.string().optional(),
});

/**
 * Search Topic Learning Result Schema
 * Combines search flow coordinates with all standard UI elements.
 */
const SearchTopicLearningResultSchema = z.object({
  success: z.boolean(),
  tiktokLaunched: z.boolean(),
  uiElementsFound: z.object({
    searchBar: uiElementSchema,
    firstSearchResult: uiElementSchema,
    commentInputField: uiElementSchema,
    commentSendButton: uiElementSchema,
    followButton: uiElementSchema,
  }),
  nextStage: z.enum(['learning', 'working']),
  message: z.string(),
  stepsUsed: z.number(),
});

const getSearchTopicPrompt = (tiktokPackage: string, searchTopic: string) =>
  `You are a TikTok automation agent in the LEARNING stage. Your mission is to search for a topic and then learn the comment flow and follow button coordinates on the resulting video.

    1. **LAUNCH**: Check device connection and launch TikTok app
    If not open — launch it using launchApp with package name: "${tiktokPackage}"

    2. **SEARCH FOR TOPIC**:
    - Take a screenshot to confirm you are on the main TikTok feed.
    - Find the search bar/icon — it is typically near the top of the screen (a full-width bar or a magnifying glass icon in the top-right area). Tap it and record its coordinates as "searchBar".
    - Wait 1-2 seconds for the search page to load.
    - Type the search topic: "${searchTopic}"
    - Press Enter (keycode 66) to submit the search.
    - Wait 2-3 seconds for search results to load.
    - Take a screenshot. Find the FIRST video/content thumbnail in the search results. Record its coordinates as "firstSearchResult". This is typically the first visual content item below the search tabs.
    - Tap the first result to open the video.
    - Wait 2 seconds for the video to load.

    3. **LEARN COMMENT FLOW** (on the opened video from search):
    - Find the "Add comment..." bar at the BOTTOM of the video feed screen (NOT the search bar at the top). This is a text input bar visible on the main feed without opening any overlay.
    - Tap the "Add comment..." bar to activate the comment input field. Record its coordinates as "commentInputField".
    - Wait 1 second for the keyboard and comment UI to appear.
    - Take a screenshot to analyze the comment interface.
    - Type "Nice video" (or any other realistic test comment).
    - Take screenshot to confirm text entered.
    - Find the red/colored send button and record its coordinates as "commentSendButton".
    - Click send button to actually post the comment (the send button in TikTok UI, not the keyboard button).
    - Wait 2s for comment to be posted (after sending, TikTok auto-returns to the feed).

    4. **FOLLOW BUTTON LEARNING** (after comment flow):
    - On the video feed, swipe from the CENTER of the screen to the LEFT to open the creator's profile page.
      - Use swipeScreen: from center (width/2, height/2) to left (width*0.1, height/2) with duration 300ms
    - Wait 2 seconds for the profile page to load.
    - Take a screenshot and find the RED "Follow" button on the profile page.
      - Use: take_and_analyze_screenshot(query="find the red Follow button on this TikTok profile page", action="find_object")
      - It's a prominent red/pink button, usually near the top of the profile
      - If the button says "Following" or "Friends", the user is already followed — still record the coordinates
    - Save the Follow button coordinates as "followButton".
    - Press Android back button to return to the video feed.
    - Wait 1 second for the feed to reload.

    **IMPORTANT RULES:**
    - Use the provided tools to interact with the phone
    - Take screenshots frequently to see current state.
    - If TikTok is not open, launch it using launchApp with packageName: "${tiktokPackage}"
    - Be patient - wait for UI to load between actions
    - Try different approaches if first attempts fail
    - **MUST LEARN COMMENT FLOW**: Don't finish until you've found comment input and send button

    **Error Handling:**
    - If you can't reach the goal. Maybe some coordinates are wrong. Try to find the object again.

    ## How to finish the learning stage
    Run final function 'finish_task' with the result.
    Do not close keyboard using other tools. it should be closed automatically by submitting comment.

    - When you have found ALL UI elements (searchBar, firstSearchResult, commentInputField, commentSendButton, AND followButton), return success:true
    - If missing any required UI elements, return success:false

    For screenshot, use take_and_analyze_screenshot tool. But use it only for one query per call.

    Start by checking device connection and launching TikTok!`;

/**
 * Unified search + UI learning stage.
 * Searches for a topic, opens the first result, then learns all UI coordinates on that video.
 */
export async function runSearchTopicLearningStage(
  deviceId: string,
  deviceManager: DeviceManager,
  presets: AutomationPresets,
  searchTopic: string,
  tiktokPackage?: string,
): Promise<z.infer<typeof SearchTopicLearningResultSchema>> {
  console.log(`🔍🧠 [Learning] Starting unified search+learning stage for device: ${deviceId}, topic: "${searchTopic}"`);

  const packageToUse = tiktokPackage ?? presets.tiktokAppPackage;
  const prompt = getSearchTopicPrompt(packageToUse, searchTopic);
  return await interactWithScreen<z.infer<typeof SearchTopicLearningResultSchema>>(
    prompt,
    deviceId,
    deviceManager,
    {},
    SearchTopicLearningResultSchema,
    35,
  );
}

/**
 * Direct Learning Stage Execution
 */
export async function runLearningStage(
  deviceId: string,
  deviceManager: DeviceManager,
  presets: AutomationPresets,
  tiktokPackage?: string
): Promise<z.infer<typeof LearningResultSchema>> {
  const stage = new LearningStage(deviceId, deviceManager, presets);

  try {
    return await stage.execute(tiktokPackage);
  } finally {
    await stage.cleanup();
  }
} 