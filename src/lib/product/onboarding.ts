/**
 * First-Time User Onboarding Flow
 * Instant music playback, no signup friction, immediate "wow effect feed"
 */

import type { Song } from "@/types/database";

interface OnboardingState {
  step: "landing" | "preview" | "signup" | "complete";
  userId?: string;
  previewSongId?: string;
}

class OnboardingEngine {
  private state: OnboardingState = { step: "landing" };

  /**
   * Start onboarding flow
   */
  startOnboarding(): OnboardingState {
    this.state = { step: "landing" };
    return this.state;
  }

  /**
   * User lands on homepage - show preview mode
   */
  enterPreviewMode(songId: string): OnboardingState {
    this.state = { step: "preview", previewSongId: songId };
    return this.state;
  }

  /**
   * User signs up
   */
  completeSignup(userId: string): OnboardingState {
    this.state = { step: "signup", userId };
    return this.state;
  }

  /**
   * Onboarding complete - show personalized feed
   */
  completeOnboarding(): OnboardingState {
    this.state = { step: "complete" };
    return this.state;
  }

  /**
   * Get current onboarding step
   */
  getCurrentStep(): OnboardingState["step"] {
    return this.state.step;
  }

  /**
   * Check if user needs onboarding
   */
  needsOnboarding(userId?: string): boolean {
    if (!userId) return true;
    // Check if user has completed onboarding
    // This would query the database
    return false; // Assume completed for now
  }

  /**
   * Get "wow effect" feed for new users
   */
  async getWowEffectFeed(): Promise<Song[]> {
    // Return curated feed of high-quality songs
    // This would use the feed diversity engine with special config
    return [];
  }
}

// Singleton instance
let onboardingEngine: OnboardingEngine | null = null;

export function getOnboardingEngine(): OnboardingEngine {
  if (!onboardingEngine) {
    onboardingEngine = new OnboardingEngine();
  }
  return onboardingEngine;
}

/**
 * Onboarding steps configuration
 */
export const ONBOARDING_STEPS = {
  LANDING: {
    title: "Welcome to SONARA",
    description: "Discover your next favorite song",
    action: "Start Listening",
  },
  PREVIEW: {
    title: "Preview Mode",
    description: "Listen to music without signing up",
    action: "Sign Up to Save",
  },
  SIGNUP: {
    title: "Create Your Account",
    description: "Save your favorite songs and artists",
    action: "Complete",
  },
  COMPLETE: {
    title: "Welcome to SONARA",
    description: "Your personalized feed is ready",
    action: "Start Exploring",
  },
};
