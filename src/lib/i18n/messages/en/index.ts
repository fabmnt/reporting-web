import { admin } from "./admin";
import { app } from "./app";
import { clinics } from "./clinics";
import { common } from "./common";
import { conditions } from "./conditions";
import { errors } from "./errors";
import { operations } from "./operations";
import { reports } from "./reports";

// English is the source of truth for the message shape: every other language
// is checked against this type, so a missing entry fails the build.
export const en = {
  common,
  app,
  operations,
  errors,
  reports,
  conditions,
  clinics,
  admin,
};

export type Messages = typeof en;
