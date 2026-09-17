/**
 * Client names are free text, so the stored key is the normalized name. This
 * module holds the rule alone, with no imports of its own: the directory import
 * script runs it under Node's type stripping, which resolves only the paths
 * written in the module it loads, so a helper that brings in the rest of the
 * app cannot be run that way.
 */
export function clientKeyFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
