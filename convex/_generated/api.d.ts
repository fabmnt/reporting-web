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
import type * as carrierApi from "../carrierApi.js";
import type * as clinics from "../clinics.js";
import type * as executeReport from "../executeReport.js";
import type * as googleApi from "../googleApi.js";
import type * as googleSheets from "../googleSheets.js";
import type * as http from "../http.js";
import type * as migrations_backfillClientClinicCounts from "../migrations/backfillClientClinicCounts.js";
import type * as migrations_dataCleanup from "../migrations/dataCleanup.js";
import type * as migrations_executeReportConditions from "../migrations/executeReportConditions.js";
import type * as migrations_importCccDirectory from "../migrations/importCccDirectory.js";
import type * as migrations_importLegacyClinics from "../migrations/importLegacyClinics.js";
import type * as migrations_importLegacyStaff from "../migrations/importLegacyStaff.js";
import type * as migrations_renameStaffAccount from "../migrations/renameStaffAccount.js";
import type * as migrations_reportTypesCleanup from "../migrations/reportTypesCleanup.js";
import type * as migrations_reportTypesSeed from "../migrations/reportTypesSeed.js";
import type * as model_appErrors from "../model/appErrors.js";
import type * as model_assignments from "../model/assignments.js";
import type * as model_carrierBots from "../model/carrierBots.js";
import type * as model_clientKey from "../model/clientKey.js";
import type * as model_clients from "../model/clients.js";
import type * as model_clinicSheetColumns from "../model/clinicSheetColumns.js";
import type * as model_executeRules from "../model/executeRules.js";
import type * as model_reportConditions from "../model/reportConditions.js";
import type * as model_reportResults from "../model/reportResults.js";
import type * as model_reportTypeSeed from "../model/reportTypeSeed.js";
import type * as model_reportTypes from "../model/reportTypes.js";
import type * as model_reporting from "../model/reporting.js";
import type * as model_staff from "../model/staff.js";
import type * as model_tokens from "../model/tokens.js";
import type * as model_usernames from "../model/usernames.js";
import type * as passwordSetup from "../passwordSetup.js";
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
  carrierApi: typeof carrierApi;
  clinics: typeof clinics;
  executeReport: typeof executeReport;
  googleApi: typeof googleApi;
  googleSheets: typeof googleSheets;
  http: typeof http;
  "migrations/backfillClientClinicCounts": typeof migrations_backfillClientClinicCounts;
  "migrations/dataCleanup": typeof migrations_dataCleanup;
  "migrations/executeReportConditions": typeof migrations_executeReportConditions;
  "migrations/importCccDirectory": typeof migrations_importCccDirectory;
  "migrations/importLegacyClinics": typeof migrations_importLegacyClinics;
  "migrations/importLegacyStaff": typeof migrations_importLegacyStaff;
  "migrations/renameStaffAccount": typeof migrations_renameStaffAccount;
  "migrations/reportTypesCleanup": typeof migrations_reportTypesCleanup;
  "migrations/reportTypesSeed": typeof migrations_reportTypesSeed;
  "model/appErrors": typeof model_appErrors;
  "model/assignments": typeof model_assignments;
  "model/carrierBots": typeof model_carrierBots;
  "model/clientKey": typeof model_clientKey;
  "model/clients": typeof model_clients;
  "model/clinicSheetColumns": typeof model_clinicSheetColumns;
  "model/executeRules": typeof model_executeRules;
  "model/reportConditions": typeof model_reportConditions;
  "model/reportResults": typeof model_reportResults;
  "model/reportTypeSeed": typeof model_reportTypeSeed;
  "model/reportTypes": typeof model_reportTypes;
  "model/reporting": typeof model_reporting;
  "model/staff": typeof model_staff;
  "model/tokens": typeof model_tokens;
  "model/usernames": typeof model_usernames;
  passwordSetup: typeof passwordSetup;
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

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
