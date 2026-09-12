import type { TrafficalPlugin, PluginClientAPI } from "./types.js";
import type { DecisionResult, Context } from "@traffical/core";

const RDR_COOKIE = "traffical_rdr";
const RDR_MAX_AGE = 24 * 60 * 60; // 24 hours in seconds

export interface RedirectPluginOptions {
  /** Parameter key to check for a redirect URL. Default: "redirect.url" */
  parameterKey?: string;
  /** How to compare the resolved URL with the current location.
   *  "pathname" compares against window.location.pathname (default).
   *  "href" compares against the full window.location.href. */
  compareMode?: "pathname" | "href";
  /** Cookie name for redirect attribution. Default: "traffical_rdr" */
  cookieName?: string;
}

function setCookie(name: string, value: string, maxAge: number): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
  } catch {
    // cookie access may fail
  }
}

export function createRedirectPlugin(
  options: RedirectPluginOptions = {}
): TrafficalPlugin {
  const parameterKey = options.parameterKey ?? "redirect.url";
  const compareMode = options.compareMode ?? "pathname";
  const cookieName = options.cookieName ?? RDR_COOKIE;

  return {
    name: "redirect",

    onInitialize(client: PluginClientAPI): void {
      if (typeof window === "undefined") return;

      client.decide({
        context: {},
        defaults: { [parameterKey]: "" },
      });
    },

    /**
     * Injects the current pathname under the literal, flat key
     * `"url.pathname"` (one property whose name contains a dot — NOT a nested
     * `{ url: { pathname } }` object). The evaluator resolves a condition
     * field flat-key-first, then by dot-path traversal (sdk-spec "Field
     * lookup"), so a policy condition on `url.pathname` matches this key
     * directly and would equally match a nested shape supplied by the caller.
     * Caller-supplied context wins over the injected key.
     */
    onBeforeDecision(context: Context): Context {
      if (typeof window === "undefined") return context;
      return {
        "url.pathname": window.location.pathname,
        ...context,
      };
    },

    onDecision(decision: DecisionResult): void {
      const url = decision.assignments[parameterKey];
      if (typeof url !== "string" || !url) return;

      const current =
        compareMode === "href"
          ? window.location.href
          : window.location.pathname;

      if (url === current) return;

      const layer = decision.metadata.layers.find(
        (l) => l.policyId && l.allocationName
      );
      if (layer) {
        setCookie(
          cookieName,
          JSON.stringify({
            l: layer.layerId,
            p: layer.policyId,
            a: layer.allocationName,
            ts: Date.now(),
          }),
          RDR_MAX_AGE
        );
      }

      window.location.replace(url);
    },
  };
}
