// One bot of a clinic as the Control Central API reports it. `pattern` is the
// regular expression the clinic sheet's carrier column has to match for the
// bot to take the row, and `status` is the line the API shows: Active, 2FA,
// Bad Credentials and so on.
export type CarrierBot = {
  name: string;
  pattern: string;
  status: string;
};

export type CarrierMatcher = {
  name: string;
  matches: (carrierCell: string) => boolean;
};

// A bot with any other status cannot run, so its rows stay out of the report.
// The old tool listed the same four.
const USABLE_BOT_STATUSES = ["Active", "Bad Credentials", "2FA", "Security Question"];

// Real clinic patterns run past five hundred characters, because one
// expression covers every carrier name and state a bot answers to. This bound
// only refuses a body that could not be a pattern at all.
const MAX_PATTERN_LENGTH = 2_000;

type JsPattern = { source: string; flags: string };

// The API hands out Python patterns. The inline (?i) flag is not valid
// JavaScript, and Python's re.match anchors at the start of the text while
// RegExp.test searches anywhere, so both differences are folded away here.
function toJsPattern(pattern: string): JsPattern | null {
  const trimmed = pattern.trim();
  if (trimmed === "" || trimmed.length > MAX_PATTERN_LENGTH) return null;
  const body = trimmed.replace(/\(\?i\)/g, "");
  return { source: `^(?:${body})`, flags: trimmed.includes("(?i)") ? "i" : "" };
}

export function carrierMatcher(bot: CarrierBot): CarrierMatcher | null {
  const pattern = toJsPattern(bot.pattern);
  if (pattern === null) return null;

  let regex: RegExp;
  try {
    regex = new RegExp(pattern.source, pattern.flags);
  } catch {
    return null;
  }

  return { name: bot.name, matches: (carrierCell) => regex.test(carrierCell.trim()) };
}

export function isUsableCarrierBot(bot: CarrierBot): boolean {
  return USABLE_BOT_STATUSES.includes(bot.status);
}

// The bots that can take rows, in the order the API listed them. A bot whose
// pattern does not compile is left out instead of failing the whole clinic,
// and it says so in the logs: rows quietly missing from the results are harder
// to explain than a line of output.
export function usableCarrierMatchers(bots: CarrierBot[]): CarrierMatcher[] {
  const matchers: CarrierMatcher[] = [];
  for (const bot of bots) {
    if (!isUsableCarrierBot(bot)) continue;
    const matcher = carrierMatcher(bot);
    if (matcher === null) {
      console.log(`Carrier pattern of ${bot.name} is not a pattern this app can run.`);
      continue;
    }
    matchers.push(matcher);
  }
  return matchers;
}

// Every bot the clinic cannot run right now, which is what tells an operator
// why rows are missing from the results.
export function inactiveCarrierBots(bots: CarrierBot[]): Array<{ name: string; status: string }> {
  return bots
    .filter((bot) => bot.status !== "Active")
    .map((bot) => ({ name: bot.name, status: bot.status }));
}

function carrierStatusOf(status: unknown): string {
  if (typeof status !== "object" || status === null) return "";
  const description = (status as { description?: unknown }).description;
  return typeof description === "string" ? description : "";
}

function carrierBotOf(entry: unknown): CarrierBot | null {
  if (typeof entry !== "object" || entry === null) return null;

  const record = entry as {
    bot?: unknown;
    regex?: unknown;
    isSharedRegExp?: unknown;
    status?: unknown;
  };
  if (typeof record.bot !== "object" || record.bot === null) return null;

  const definition = record.bot as { botName?: unknown; regex?: unknown };
  if (typeof definition.botName !== "string") return null;
  const name = definition.botName.trim();
  if (name === "") return null;

  // A shared bot carries one pattern for every clinic; the rest carry a
  // pattern written for this clinic alone.
  const pattern = record.isSharedRegExp === true ? definition.regex : record.regex;
  if (typeof pattern !== "string") return null;

  return { name, pattern, status: carrierStatusOf(record.status) };
}

/**
 * Reads the bot list of one clinic document. Returns null when the body is not
 * the shape the API documents, so the caller reports an unavailable API
 * instead of an empty clinic.
 */
export function parseCarrierBots(payload: unknown): CarrierBot[] | null {
  if (typeof payload !== "object" || payload === null) return null;
  const entries = (payload as { clinicBot?: unknown }).clinicBot;
  if (!Array.isArray(entries)) return null;

  const bots: CarrierBot[] = [];
  for (const entry of entries) {
    const bot = carrierBotOf(entry);
    if (bot !== null) bots.push(bot);
  }
  return bots;
}
