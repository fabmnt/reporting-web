import type { Messages } from "../en";
import { admin } from "./admin";
import { app } from "./app";
import { clinics } from "./clinics";
import { common } from "./common";
import { conditions } from "./conditions";
import { errors } from "./errors";
import { operations } from "./operations";
import { reports } from "./reports";

export const es: Messages = {
  common,
  app,
  operations,
  errors,
  reports,
  conditions,
  clinics,
  admin,
};
