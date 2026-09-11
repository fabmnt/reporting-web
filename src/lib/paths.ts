// Astro serializes `Astro.url.pathname` with a trailing slash for directory
// routes ("/admin/"), so every comparison normalizes first.
export function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.replace(/\/+$/, "");
  return path;
}

export function isSamePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

export function isActivePath(href: string, currentPath: string): boolean {
  const current = normalizePath(currentPath);
  const target = normalizePath(href);
  if (target === "/") return current === "/";
  return current === target || current.startsWith(`${target}/`);
}
