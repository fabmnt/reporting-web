/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as clinics from "../clinics.js";
import type * as googleSheets from "../googleSheets.js";
import type * as http from "../http.js";
import type * as migrations_dataCleanup from "../migrations/dataCleanup.js";
import type * as migrations_importLegacySheetColumns from "../migrations/importLegacySheetColumns.js";
import type * as model_appErrors from "../model/appErrors.js";
import type * as model_clinicSheetColumns from "../model/clinicSheetColumns.js";
import type * as model_reportConditions from "../model/reportConditions.js";
import type * as model_reportOperations from "../model/reportOperations.js";
import type * as model_reportTypes from "../model/reportTypes.js";
import type * as model_reporting from "../model/reporting.js";
import type * as model_staff from "../model/staff.js";
import type * as reportConditions from "../reportConditions.js";
import type * as reportTypes from "../reportTypes.js";
import type * as reports from "../reports.js";
import type * as sheets from "../sheets.js";
import type * as staffAccounts from "../staffAccounts.js";
import type * as staffAuth from "../staffAuth.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  clinics: typeof clinics;
  googleSheets: typeof googleSheets;
  http: typeof http;
  "migrations/dataCleanup": typeof migrations_dataCleanup;
  "migrations/importLegacySheetColumns": typeof migrations_importLegacySheetColumns;
  "model/appErrors": typeof model_appErrors;
  "model/clinicSheetColumns": typeof model_clinicSheetColumns;
  "model/reportConditions": typeof model_reportConditions;
  "model/reportOperations": typeof model_reportOperations;
  "model/reportTypes": typeof model_reportTypes;
  "model/reporting": typeof model_reporting;
  "model/staff": typeof model_staff;
  reportConditions: typeof reportConditions;
  reportTypes: typeof reportTypes;
  reports: typeof reports;
  sheets: typeof sheets;
  staffAccounts: typeof staffAccounts;
  staffAuth: typeof staffAuth;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
