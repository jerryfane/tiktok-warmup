/**
 * Automation presets and configuration
 */

export interface AutomationPresets {
  tiktokAppPackage: string; // Will be dynamically detected, this is just fallback
  tiktokLoadTime: number;
  searchTopic?: string; // Optional topic to search before scrolling (e.g., "texting my crush")
  video: {
    watchDuration: [number, number]; // [min, max] seconds for normal viewing
    quickSkipChance: number;         // 0-1 probability to skip after 1 second
    quickSkipDuration: number;       // seconds to watch before quick skip
    scrollDelay: [number, number];   // [min, max] seconds
    fastSwipeChance: number;            // 0-1 probability to trigger a fast swipe burst
    fastSwipeCount: [number, number];   // [min, max] videos to rapidly swipe through
    fastSwipeDelay: [number, number];   // [min, max] seconds between rapid swipes
  };
  
  interactions: {
    likeChance: number;     // 0-1 probability
    commentChance: number;  // 0-1 probability
    followChance: number;   // 0-1 probability
    dailyLimit: number;     // max actions per day
  };
  
  comments: {
    templates: string[];
    useAI: boolean;
    maxLength: number;
  };
  
  // Control settings for health checks, errors, and ban detection
  control: {
    healthCheckInterval: number;   // number of videos between health checks
    maxHealthFailures: number;     // max consecutive health check failures
    shadowBanInterval: number;     // number of videos between shadow ban checks
    maxConsecutiveErrors: number;  // max consecutive processing errors before stop
  };

  // Session settings for warmup loop
  session: {
    videosPerSession: [number, number];    // [min, max] videos before resting
    restBetweenSessions: [number, number]; // [min, max] rest in minutes
    maxSessionsPerDay: number;             // safety cap on sessions per day
  };
}

/**
 * Default automation settings
 */
export const AUTOMATION_PRESETS: AutomationPresets = {
  tiktokAppPackage: 'com.zhiliaoapp.musically',
  tiktokLoadTime: 3,
  searchTopic: 'texting my bf',
  video: {
    watchDuration: [5, 10],   // Watch 5-10 seconds normally
    quickSkipChance: 0.2,     // Skip quickly on 20% of videos (1 in 5)
    quickSkipDuration: 1,     // Watch only 1 second before skipping
    scrollDelay: [1, 3],      // Wait 1-3 seconds between videos
    fastSwipeChance: 0.15,    // 15% chance per video cycle
    fastSwipeCount: [2, 5],   // Rapidly swipe through 2-5 videos
    fastSwipeDelay: [0.3, 0.8], // Very short delays between swipes
  },
  
  interactions: {
    likeChance: 0.7,          // Like 70% of videos
    commentChance: 0.01,      // Comment on 35% of videos
    followChance: 0.99,       // Follow 15% of creators
    dailyLimit: 500,          // Max 500 actions per day
  },
  
  comments: {
    templates: [
      "amazing",
      "love this content",
      "so cool",
      "great video",
      "nice",
      "this is fire",
      "cant stop watching",
      "so good",
      "perfect",
      "love it",
      "this hits different",
      "absolutely love this",
      "so talented",
      "incredible",
      "this is everything",
    ],
    useAI: true,
    maxLength: 50,
  },
  
  control: {
    healthCheckInterval: 10, // Every 10 videos check screen if it is healthy and looks like TikTok feed
    maxHealthFailures: 3, // Max 3 health check failures before retraining UI coordinates
    shadowBanInterval: 50, // Every 50 videos check if the account is shadow banned
    maxConsecutiveErrors: 5, // Max 5 consecutive errors before stopping
  },

  session: {
    videosPerSession: [20, 40],    // Watch 20-40 videos per session
    restBetweenSessions: [60, 180], // Rest 1-3 hours between sessions
    maxSessionsPerDay: 5,           // Max 5 sessions per day
  },
}; 