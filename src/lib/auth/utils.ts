/**
 * SONARA Authentication Utilities
 * 
 * Provides helper functions for authentication operations
 * including error handling, validation, and type safety.
 */

import type { AuthError } from "@supabase/supabase-js";

export type AuthErrorCode = 
  | "invalid_credentials"
  | "invalid_email"
  | "invalid_password"
  | "user_already_exists"
  | "weak_password"
  | "email_not_confirmed"
  | "auth_error"
  | "unknown_error";

export interface AuthErrorResult {
  code: AuthErrorCode;
  message: string;
  original?: AuthError;
}

export interface AuthSuccessResult {
  success: true;
}

export type AuthResult = AuthErrorResult | AuthSuccessResult;

/**
 * Parse Supabase auth error to user-friendly message
 */
export function parseAuthError(error: AuthError | Error | null): AuthErrorResult {
  if (!error) {
    return {
      code: "unknown_error",
      message: "An unknown error occurred",
    };
  }

  const message = "message" in error ? error.message : String(error);

  // Map common Supabase errors
  if (message.includes("Invalid login credentials")) {
    return {
      code: "invalid_credentials",
      message: "Invalid email or password. Please try again.",
      original: error as AuthError,
    };
  }

  if (message.includes("invalid email")) {
    return {
      code: "invalid_email",
      message: "Please enter a valid email address.",
      original: error as AuthError,
    };
  }

  if (message.includes("Password")) {
    return {
      code: "invalid_password",
      message: "Password must be at least 6 characters long.",
      original: error as AuthError,
    };
  }

  if (message.includes("already registered") || message.includes("duplicate")) {
    return {
      code: "user_already_exists",
      message: "An account with this email already exists.",
      original: error as AuthError,
    };
  }

  if (message.includes("email not confirmed")) {
    return {
      code: "email_not_confirmed",
      message: "Please confirm your email before signing in.",
      original: error as AuthError,
    };
  }

  // Generic auth error
  if (message.includes("Auth")) {
    return {
      code: "auth_error",
      message: message || "Authentication failed. Please try again.",
      original: error as AuthError,
    };
  }

  return {
    code: "unknown_error",
    message: message || "An error occurred. Please try again.",
    original: error as AuthError,
  };
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength
 */
export function isValidPassword(password: string): boolean {
  // Minimum 6 characters
  return password.length >= 6;
}

/**
 * Validate username format
 */
export function isValidUsername(username: string): boolean {
  // 3-20 characters, alphanumeric + underscore/hyphen
  const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
  return usernameRegex.test(username);
}

/**
 * Get auth error message for display
 */
export function getAuthErrorMessage(error: AuthError | Error | null): string {
  const parsed = parseAuthError(error);
  return parsed.message;
}
