import { z } from 'zod';

import type { DeviceManager } from '@/core/DeviceManager.js';
import type { AutomationPresets } from '@/config/presets.js';
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
      confidence: z.number().optional(),
      label: z.string().optional(),
    }),
    commentButton: z.object({
      found: z.boolean(),
      coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
      boundingBox: z.object({ y1: z.number(), x1: z.number(), y2: z.number(), x2: z.number() }).optional(),
      confidence: z.number().optional(),
      label: z.string().optional(),
    }),
    commentInputField: z.object({
      found: z.boolean(),
      coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
      boundingBox: z.object({ y1: z.number(), x1: z.number(), y2: z.number(), x2: z.number() }).optional(),
      confidence: z.number().optional(),
      label: z.string().optional(),
    }),
    commentSendButton: z.object({
      found: z.boolean(),
      coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
      boundingBox: z.object({ y1: z.number(), x1: z.number(), y2: z.number(), x2: z.number() }).optional(),
      confidence: z.number().optional(),
      label: z.string().optional(),
    }),
    commentCloseButton: z.object({
      found: z.boolean(),
      coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
      boundingBox: z.object({ y1: z.number(), x1: z.number(), y2: z.number(), x2: z.number() }).optional(),
      confidence: z.number().optional(),
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
      - Comment button: WHITE CIRCLE with THREE DOTS and COMMENT COUNT number below it (e.g., "444", "1.2K", "567"). This is NOT a speech bubble icon. Look for a circular white icon with three horizontal dots (...) inside and a number underneath. Usually located below the like button.
    4. **LEARN COMMENT FLOW**: Practice comment writing sequence:
      - Click comment button
      - Wait 1 second for comment UI to load
      - Take screenshot to analyze comment interface
      - Find comment input field (text input area)
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
    2. Find comment input field coordinates
    3. Click input field → wait 1s → type "Nice video" (or any other realistic test comment)
    4. Take screenshot to confirm text entered
    5. Find red/colored send button coordinates
    6. Click send button to actually post the comment (complete the flow, not keyboard button, but the send button in TikTok UI)
    7. Wait 2s for comment to be posted
    8. Find close/back button to close comment interface (X button or back arrow)
    9. Test close button to return to main TikTok feed
    10. Save all coordinates for working stage

    ## How to finish the learning stage
    Run final function 'finish_task' with the result.
    Do not close keyboard using other tools. it should be automatically by submitting comment.

    - When you have found ALL UI elements (like, comment, input field, send button, close button), return success:true
    - If missing any UI elements, return success:false


    For screenshot, use take_and_analyze_screenshot tool. But use it only for one query per call. Like one for like button, one for comment button, one for input field, one for send button.

    **LIKE BUTTON DETECTION**: When searching for the like button, ask specifically to "find the WHITE HEART ICON with NUMERICAL LIKE COUNT displayed below it (e.g., heart + '88.4K'). Do NOT select the circular user profile image, usernames, or other UI elements. The correct target is a small white heart with numbers underneath it."

    **COMMENT BUTTON DETECTION**: When searching for the comment button, ask specifically to "find the WHITE CIRCLE with THREE DOTS (...) and COMMENT COUNT number below it (e.g., circle with dots + '444'). Do NOT select speech bubble icons, share buttons, or other UI elements. The correct target is a circular white icon with three horizontal dots inside and a number underneath."

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