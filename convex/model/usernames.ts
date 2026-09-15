import { appError } from "./appErrors";

// Usernames are stored lowercased, so sign-in does not depend on the case the
// user types. Letters, numbers, dots, dashes and underscores keep a username
// safe to put in a URL.
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

// Accepts what the sign-in form and the sign-up form send, plus the raw names
// a migration reads from another system. Throws when the result is not a
// username this app can store.
export function usernameFromInput(value: string): string {
  const username = value.trim().toLowerCase();

  if (!USERNAME_PATTERN.test(username)) {
    throw appError({ code: "INVALID_USERNAME" });
  }

  return username;
}
