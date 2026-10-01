// The account security screen: turning the authenticator-app second factor on
// and off, and the recovery codes that outlive a lost phone.
export const security = {
  pageTitle: "Security",
  title: "Two-factor authentication",
  description:
    "Ask for a code from an authenticator app in addition to your password when you sign in.",
  status: {
    on: "On",
    off: "Off",
  },
  enable: "Set up authenticator app",
  setup: {
    title: "Set up your authenticator app",
    description:
      "Scan the QR code with Google Authenticator, 1Password, Authy or another authenticator app, or enter the key by hand.",
    passwordHint: "Confirm your password before setting up an authenticator.",
    keyLabel: "Setup key",
    codeLabel: "Code from the app",
    codeHint: "Enter the 6-digit code the app shows for this account.",
    confirm: "Turn on",
    restart: "Start over",
  },
  recovery: {
    title: "Save your recovery codes",
    description:
      "Each code signs you in once if you lose your phone. They are shown only this time.",
    copy: "Copy codes",
    copied: "Copied",
    download: "Download .txt",
    done: "Done",
  },
  enabled: {
    remaining: (count: number) =>
      count === 0
        ? "No recovery codes left."
        : count === 1
          ? "1 recovery code left."
          : `${count} recovery codes left.`,
    disable: "Turn off",
  },
  disable: {
    title: "Turn off two-factor authentication",
    description: "Enter your password and a current code from your authenticator app.",
    password: "Password",
    code: "Code or recovery code",
    confirm: "Turn off",
  },
  regenerate: {
    title: "Generate new recovery codes",
    description:
      "Enter your password and an authenticator or recovery code. All old recovery codes will stop working.",
    confirm: "Generate codes",
  },
  failures: {
    regenerate: "Could not generate new recovery codes.",
    setup: "Could not start the setup.",
    confirm: "Turning on two-factor authentication failed.",
    disable: "Turning off two-factor authentication failed.",
    copy: "Copying failed. Select the codes and copy them by hand.",
  },
};
