import type { Messages } from "../en";
import { admin } from "./admin";
import { app } from "./app";
import { clinics } from "./clinics";
import { common } from "./common";
import { conditions } from "./conditions";
import { errors } from "./errors";
import { reports } from "./reports";
import { security } from "./security";

export const es: Messages = {
  common,
  app,
  errors,
  reports,
  conditions,
  clinics,
  admin,
  security,
};
