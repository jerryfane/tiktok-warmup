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
    likeButton: z.object({
      found: z.boolean(),
      coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
      boundingBox: z.object({ y1: z.number(), x1: z.number(), y2: z.number(), x2: z.number() }).optional(),
      confidence: z.number().nullable().optional(),
      label: z.string().optional(),
    }),
    commentButton: z.object({
      found: z.boolean(),
      coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
      boundingBox: z.object({ y1: z.number(), x1: z.number(), y2: z.number(), x2: z.number() }).optional(),
      confidence: z.number().nullable().optional(),
      label: z.string().optional(),
    }),
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

const getPrompt = (tiktokPackage: string) => `You are a TikTok automation agent in the LEARNING stage. Your mission:

    1. **FIRST**: Check device connection and launch TikTok app
    If not - find the app and launch it using launchApp with package name: "${tiktokPackage}"
    2. **THEN**: Take screenshots to analyze the TikTok interface
    3. **FIND**: Locate key UI elements and their exact coordinates:
      - Like button: WHITE/LIGHT COLORED HEART ICON with a NUMERICAL LIKE COUNT below it (e.g., "88.4K", "1.2M", "567"). This is NOT the circular user profile image. The heart is small, white/light colored, and ALWAYS has numbers directly underneath it. Located on the right side of screen.
      - Comment button: SPEECH BUBBLE ICON (comment icon) with a COMMENT COUNT number below it (e.g., "444", "1.2K", "567"). It looks like a speech bubble or chat bubble shape. Located on the RIGHT SIDE of the screen, directly below the heart/like button. CRITICAL: Do NOT tap the "+" button in the bottom navigation bar — that creates a new post, it is NOT the comment button!
    4. **LEARN COMMENT FLOW**: Practice comment writing sequence:
      - Click comment button
      - Wait 1 second for comment UI to load
      - Take screenshot to analyze comment interface
      - Find comment input field — the "Add comment..." input at the BOTTOM of the comments overlay (NOT the search bar at the top)
      - Find send button (usually red/colored button)
      - Test the full flow: click input → type test → find send button

    **IMPORTANT RULES:**
    - Use the provided tools to interact with the phone
    - Take screenshots frequently to see current state.
    - If TikTok is not open, launch it using launchApp with packageName: "${tiktokPackage}"
    - Be patient - wait for UI to load between actions
    - Try different approaches if first attempts fail
    - **MUST LEARN COMMENT FLOW**: Don't finish until you've found comment input and send button
    - Only return success:true when ALL UI elements are found including comment input and send button
    - **CRITICAL**: The like button is a WHITE HEART ICON WITH LIKE COUNT NUMBERS below it (♥ + "88.4K"), NOT the circular user profile image, NOT usernames, NOT share buttons. The target has TWO parts: heart shape + numerical text underneath. Look for this exact combination.


    **Error Handling:**
    - If you can't reach the goal. Maybe some coordinates are wrong. Try to find the object again.

    ## Comment Learning Sequence:
    1. Click comment button → wait 1s → screenshot
    2. Find comment input field coordinates — look for "Add comment..." text at the BOTTOM of the comment overlay, NOT the search bar
    3. Click input field → wait 1s → type "Nice video" (or any other realistic test comment)
    4. Take screenshot to confirm text entered
    5. Find red/colored send button coordinates
    6. Click send button to actually post the comment (complete the flow, not keyboard button, but the send button in TikTok UI)
    7. Wait 2s for comment to be posted
    8. Press Android back button to return to main TikTok feed
    9. Save all coordinates for working stage

    ## Follow Button Learning Sequence (after returning to the feed from comment flow):
    1. Swipe LEFT on the screen (from right to left) to navigate to the creator's profile page
    2. Wait 2 seconds for the profile page to load
    3. Take a screenshot and find the RED "Follow" button on the profile page
       - Use: take_and_analyze_screenshot(query="find the red Follow button on this TikTok profile page", action="find_object")
       - It's a prominent red/pink button, usually near the top of the profile
       - If the button says "Following" or "Friends", the user is already followed — still record the coordinates
    4. Save the Follow button coordinates
    5. Press Android back button to return to the video feed
    6. Wait 1 second for the feed to reload

    ## How to finish the learning stage
    Run final function 'finish_task' with the result.
    Do not close keyboard using other tools. it should be automatically by submitting comment.

    - When you have found ALL UI elements (like, comment, input field, send button, AND follow button), return success:true
    - If missing any UI elements, return success:false


    For screenshot, use take_and_analyze_screenshot tool. But use it only for one query per call. Like one for like button, one for comment button, one for input field, one for send button.

    **LIKE BUTTON DETECTION**: When searching for the like button, ask specifically to "find the WHITE HEART ICON with NUMERICAL LIKE COUNT displayed below it (e.g., heart + '88.4K'). Do NOT select the circular user profile image, usernames, or other UI elements. The correct target is a small white heart with numbers underneath it."

    **COMMENT BUTTON DETECTION**: When searching for the comment button, ask specifically to "find the SPEECH BUBBLE / COMMENT ICON with a COMMENT COUNT number below it (e.g., '444', '1.2K'). It is a speech bubble or chat bubble shape on the RIGHT SIDE of the screen, directly below the heart/like button. IMPORTANT: Do NOT tap the '+' button in the bottom navigation bar — that is for creating new posts! Do NOT select share buttons, bookmark icons, or the user profile image."

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
    likeButton: uiElementSchema,
    commentButton: uiElementSchema,
    commentInputField: uiElementSchema,
    commentSendButton: uiElementSchema,
    followButton: uiElementSchema,
  }),
  nextStage: z.enum(['learning', 'working']),
  message: z.string(),
  stepsUsed: z.number(),
});

const getSearchTopicPrompt = (tiktokPackage: string, searchTopic: string) =>
  `You are a TikTok automation agent in the LEARNING stage. Your mission is to search for a topic and then learn all the UI element coordinates on the resulting video.

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

    3. **LEARN UI ELEMENTS** (on the opened video from search):
    Take screenshots to find and record these UI elements:
      - Like button: WHITE/LIGHT COLORED HEART ICON with a NUMERICAL LIKE COUNT below it (e.g., "88.4K", "1.2M", "567"). This is NOT the circular user profile image. The heart is small, white/light colored, and ALWAYS has numbers directly underneath it. Located on the right side of screen.
      - Comment button: SPEECH BUBBLE ICON (comment icon) with a COMMENT COUNT number below it (e.g., "444", "1.2K", "567"). It looks like a speech bubble or chat bubble shape. Located on the RIGHT SIDE of the screen, directly below the heart/like button. CRITICAL: Do NOT tap the "+" button in the bottom navigation bar — that creates a new post, it is NOT the comment button!
    4. **LEARN COMMENT FLOW**: Practice comment writing sequence:
      - Click comment button
      - Wait 1 second for comment UI to load
      - Take screenshot to analyze comment interface
      - Find comment input field — the "Add comment..." input at the BOTTOM of the comments overlay (NOT the search bar at the top)
      - Find send button (usually red/colored button)
      - Test the full flow: click input → type test → find send button
      - Click send button to actually post the comment
      - Wait 2s for comment to be posted
      - Press Android back button to return to the video

    **IMPORTANT RULES:**
    - Use the provided tools to interact with the phone
    - Take screenshots frequently to see current state.
    - If TikTok is not open, launch it using launchApp with packageName: "${tiktokPackage}"
    - Be patient - wait for UI to load between actions
    - Try different approaches if first attempts fail
    - **MUST LEARN COMMENT FLOW**: Don't finish until you've found comment input and send button
    - Only return success:true when ALL UI elements are found including comment input and send button
    - **CRITICAL**: The like button is a WHITE HEART ICON WITH LIKE COUNT NUMBERS below it (♥ + "88.4K"), NOT the circular user profile image, NOT usernames, NOT share buttons. The target has TWO parts: heart shape + numerical text underneath. Look for this exact combination.

    **Error Handling:**
    - If you can't reach the goal. Maybe some coordinates are wrong. Try to find the object again.

    ## Comment Learning Sequence:
    1. Click comment button → wait 1s → screenshot
    2. Find comment input field coordinates — look for "Add comment..." text at the BOTTOM of the comment overlay, NOT the search bar
    3. Click input field → wait 1s → type "Nice video" (or any other realistic test comment)
    4. Take screenshot to confirm text entered
    5. Find red/colored send button coordinates
    6. Click send button to actually post the comment (complete the flow, not keyboard button, but the send button in TikTok UI)
    7. Wait 2s for comment to be posted
    8. Press Android back button to return to the video
    9. Save all coordinates for working stage

    ## Follow Button Learning Sequence (after returning to the video from comment flow):
    1. Swipe LEFT on the screen (from right to left) to navigate to the creator's profile page
    2. Wait 2 seconds for the profile page to load
    3. Take a screenshot and find the RED "Follow" button on the profile page
       - Use: take_and_analyze_screenshot(query="find the red Follow button on this TikTok profile page", action="find_object")
       - It's a prominent red/pink button, usually near the top of the profile
       - If the button says "Following" or "Friends", the user is already followed — still record the coordinates
    4. Save the Follow button coordinates
    5. Press Android back button to return to the video feed
    6. Wait 1 second for the feed to reload

    ## How to finish the learning stage
    Run final function 'finish_task' with the result.
    Do not close keyboard using other tools. it should be automatically by submitting comment.

    - When you have found ALL UI elements (searchBar, firstSearchResult, like, comment, input field, send button, AND follow button), return success:true
    - If missing any required UI elements, return success:false

    For screenshot, use take_and_analyze_screenshot tool. But use it only for one query per call. Like one for like button, one for comment button, one for input field, one for send button.

    **LIKE BUTTON DETECTION**: When searching for the like button, ask specifically to "find the WHITE HEART ICON with NUMERICAL LIKE COUNT displayed below it (e.g., heart + '88.4K'). Do NOT select the circular user profile image, usernames, or other UI elements. The correct target is a small white heart with numbers underneath it."

    **COMMENT BUTTON DETECTION**: When searching for the comment button, ask specifically to "find the SPEECH BUBBLE / COMMENT ICON with a COMMENT COUNT number below it (e.g., '444', '1.2K'). It is a speech bubble or chat bubble shape on the RIGHT SIDE of the screen, directly below the heart/like button. IMPORTANT: Do NOT tap the '+' button in the bottom navigation bar — that is for creating new posts! Do NOT select share buttons, bookmark icons, or the user profile image."

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