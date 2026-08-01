import type { RouteRule } from "./types.js";

/** Compiled route for fast matching. */
export type CompiledRoute = {
  pattern: string;
  method: string;
  exact?: string;
  prefix?: string;
  rule: RouteRule;
};

/**
 * Compiles a route table into an optimized structure for matching.
 * Routes are sorted exact-first, then by wildcard prefix length (longest first).
 * This ensures exact matches take priority, and overlapping wildcards are matched
 * by most-specific (longest prefix) first. For example, "GET /api/admin/*" will
 * match "/api/admin/x" before "GET /api/*", even if declared in reverse order.
 *
 * @param routes - A record of pattern -> rule, where patterns are "METHOD /path" or "METHOD /path/*"
 * @returns Compiled routes sorted for efficient matching (exact, then wildcard by specificity)
 */
export function compileRoutes(routes: Record<string, RouteRule>): CompiledRoute[] {
  const compiled: CompiledRoute[] = [];

  for (const [pattern, rule] of Object.entries(routes)) {
    const spaceIndex = pattern.indexOf(" ");
    const method = pattern.slice(0, spaceIndex);
    const path = pattern.slice(spaceIndex + 1);

    if (path.endsWith("/*")) {
      // Wildcard route: pattern ends with /*
      const prefix = path.slice(0, -2); // Remove "/*"
      // Note: "GET /*" results in prefix: "", which matches every path including bare "/"
      compiled.push({
        pattern,
        method,
        prefix,
        rule,
      });
    } else {
      // Exact route
      compiled.push({
        pattern,
        method,
        exact: path,
        rule,
      });
    }
  }

  // Sort: exact routes first (they have higher priority), then wildcards by prefix length (longest first).
  // This ensures overlapping wildcards are matched by most-specific prefix first.
  compiled.sort((a, b) => {
    const aIsExact = a.exact !== undefined ? 1 : 0;
    const bIsExact = b.exact !== undefined ? 1 : 0;

    // Primary: exact routes come first
    if (bIsExact !== aIsExact) {
      return bIsExact - aIsExact; // Exact (1) comes before wildcard (0)
    }

    // Tie-break: if both are wildcards, longest prefix first (most-specific)
    if (aIsExact === 0) {
      const aLen = a.prefix?.length ?? 0;
      const bLen = b.prefix?.length ?? 0;
      return bLen - aLen; // Longer prefix first
    }

    return 0;
  });

  return compiled;
}

/**
 * Matches a request against compiled routes.
 * Routes are checked in the compiled order: exact matches first, then wildcards by specificity.
 * Returns the first matching route or undefined if no match is found.
 *
 * @param compiled - Compiled routes from compileRoutes() (pre-sorted for priority)
 * @param method - HTTP method (e.g., "GET", "POST") — method-sensitive
 * @param pathname - Request pathname (query string already stripped by caller)
 * @returns Match result with pattern and rule, or undefined
 */
export function matchRoute(
  compiled: CompiledRoute[],
  method: string,
  pathname: string
): { pattern: string; rule: RouteRule } | undefined {
  for (const route of compiled) {
    if (route.method !== method) {
      continue;
    }

    if (route.exact !== undefined) {
      // Exact match required
      if (route.exact === pathname) {
        return { pattern: route.pattern, rule: route.rule };
      }
    } else if (route.prefix !== undefined) {
      // Wildcard match: pathname must start with prefix + "/"
      if (pathname.startsWith(route.prefix + "/")) {
        return { pattern: route.pattern, rule: route.rule };
      }
    }
  }

  return undefined;
}
