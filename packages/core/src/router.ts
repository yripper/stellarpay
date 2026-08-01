import { RouteRule } from "./types.js";

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
 * Routes are sorted exact-first to prefer direct matches over wildcards.
 *
 * @param routes - A record of pattern -> rule, where patterns are "METHOD /path" or "METHOD /path/*"
 * @returns Compiled routes sorted for efficient matching
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

  // Sort: exact routes first (they have higher priority), then wildcards
  compiled.sort((a, b) => {
    const aIsExact = a.exact !== undefined ? 1 : 0;
    const bIsExact = b.exact !== undefined ? 1 : 0;
    return bIsExact - aIsExact; // Exact (1) comes before wildcard (0)
  });

  return compiled;
}

/**
 * Matches a request against compiled routes.
 * Returns the first matching route or undefined if no match is found.
 *
 * @param compiled - Compiled routes from compileRoutes()
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
