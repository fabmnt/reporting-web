import { Password } from "@convex-dev/auth/providers/Password";
import { type ConvexCredentialsUserConfig } from "@convex-dev/auth/providers/ConvexCredentials";
import { convexAuth, type ConvexCredentialsConfig } from "@convex-dev/auth/server";
import type { Value } from "convex/values";

import { appError } from "./model/appErrors";
import { usernameFromInput } from "./model/usernames";

// The Password provider identifies an account by the string its `profile`
// callback puts in `email`, and stores that string on the library-owned
// `users.email` field. It never checks that the value looks like an address,
// so this app keeps the username there.
function usernameFrom(params: Record<string, Value | undefined>): string {
  const value = params.username;
  return usernameFromInput(typeof value === "string" ? value : "");
}

// The Password provider reports failed credentials by throwing plain errors
// whose message is one of its internal result strings. Translate the known
// ones into coded errors the client can localize; anything else is a real
// fault and keeps its raw message.
// "InvalidAccountId" and "InvalidSecret" collapse into one code so signing in
// with a wrong username and a wrong password look the same to an attacker.
function localizedCredentialError(cause: unknown): unknown {
  if (!(cause instanceof Error)) return cause;
  switch (cause.message) {
    case "InvalidAccountId":
    case "InvalidSecret":
      return appError({ code: "INVALID_CREDENTIALS" });
    case "TooManyFailedAttempts":
      return appError({ code: "TOO_MANY_FAILED_ATTEMPTS" });
    default:
      // Sign-up against a taken username throws inside the store mutation, so
      // the marker arrives embedded in a server error.
      return cause.message.includes("already exists")
        ? appError({ code: "ACCOUNT_ALREADY_EXISTS" })
        : cause;
  }
}

// The library keeps a credentials provider's real configuration in an
// internal `options` field and, when it materializes the config, merges
// `options` over the top level, so a top-level `authorize` override is
// silently ignored. The wrapper has to live inside `options`.
type PasswordProvider = ConvexCredentialsConfig & {
  options: ConvexCredentialsUserConfig;
};

const password = Password({
  profile: (params) => ({ email: usernameFrom(params) }),
}) as PasswordProvider;
const passwordWithLocalizedErrors: PasswordProvider = {
  ...password,
  options: {
    ...password.options,
    authorize: async (credentials, ctx) => {
      try {
        return await password.options.authorize(credentials, ctx);
      } catch (cause) {
        throw localizedCredentialError(cause);
      }
    },
  },
};

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [passwordWithLocalizedErrors],
});
