import type { TrafficalPlugin } from "./types.js";
import type { Context } from "@traffical/core";

/**
 * Every context key the auto-attributes plugin can derive. All keys live in the
 * reserved `$` namespace so they never collide with customer keys; the
 * dashboard registers them as system attributes (`managedBy: system`,
 * `source: plugin:web`).
 */
export const AUTO_ATTRIBUTE_KEYS = [
  "$browser",
  "$os",
  "$device_type",
  "$url",
  "$host",
  "$path",
  "$query",
  "$referrer",
  "$page_title",
  "$utm_source",
  "$utm_medium",
  "$utm_campaign",
  "$utm_term",
  "$utm_content",
  "$locale",
  "$timezone",
] as const;

export type AutoAttributeKey = (typeof AUTO_ATTRIBUTE_KEYS)[number];

export type AutoBrowser = "chrome" | "edge" | "firefox" | "safari" | "other";
export type AutoOS = "ios" | "android" | "macos" | "windows" | "linux" | "other";
export type AutoDeviceType = "mobile" | "tablet" | "desktop";

export interface AutoAttributesPluginOptions {
  /** Only derive these keys. Default: every key in `AUTO_ATTRIBUTE_KEYS`. */
  include?: AutoAttributeKey[];
  /** Never derive these keys. Applied after `include`. */
  exclude?: AutoAttributeKey[];
  /**
   * Persist `$utm_*` values in `sessionStorage` (key `traffical:utm`) when the
   * landing URL carries them, and re-read them on later pages of the same
   * session whose URL has none. Default: true.
   */
  persistUtm?: boolean;
}

const UTM_STORAGE_KEY = "traffical:utm";
const UTM_KEYS = [
  "$utm_source",
  "$utm_medium",
  "$utm_campaign",
  "$utm_term",
  "$utm_content",
] as const satisfies readonly AutoAttributeKey[];

type UtmRecord = Partial<Record<(typeof UTM_KEYS)[number], string>>;

/* ------------------------------------------------------------------ */
/* UA classification — deliberately coarse; UA-class only, no versions */
/* ------------------------------------------------------------------ */

export function classifyBrowser(ua: string): AutoBrowser {
  if (/\bEdg(?:e|A|iOS)?\//.test(ua)) return "edge";
  if (/\bOPR\/|\bOpera\b/.test(ua)) return "other";
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) return "firefox";
  if (/\bChrome\/|\bCriOS\/|\bChromium\//.test(ua)) return "chrome";
  if (/\bSafari\//.test(ua) && /\bVersion\/|\bMobile\//.test(ua)) return "safari";
  return "other";
}

export function classifyOS(ua: string, maxTouchPoints = 0): AutoOS {
  if (/\b(?:iPhone|iPad|iPod)\b/.test(ua)) return "ios";
  // iPadOS 13+ reports a desktop Macintosh UA but is the only "Mac" with touch.
  if (/\bMacintosh\b/.test(ua) && maxTouchPoints > 1) return "ios";
  if (/\bAndroid\b/.test(ua)) return "android";
  if (/\bWindows\b/.test(ua)) return "windows";
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return "macos";
  if (/\bCrOS\b|\bLinux\b|\bX11\b/.test(ua)) return "linux";
  return "other";
}

export function classifyDeviceType(
  ua: string,
  opts: { coarsePointer: boolean; width: number; maxTouchPoints?: number }
): AutoDeviceType {
  if (/\biPad\b/.test(ua)) return "tablet";
  if (/\bMacintosh\b/.test(ua) && (opts.maxTouchPoints ?? 0) > 1) return "tablet";
  if (/\biPhone\b|\biPod\b/.test(ua)) return "mobile";
  if (/\bAndroid\b/.test(ua)) return /\bMobile\b/.test(ua) ? "mobile" : "tablet";
  if (/\bMobi\b/.test(ua)) return "mobile";
  if (opts.coarsePointer) {
    if (opts.width < 768) return "mobile";
    if (opts.width < 1024) return "tablet";
  }
  return "desktop";
}

/* ------------------------------------------------------------------ */

function readStoredUtm(win: Window): UtmRecord | null {
  try {
    const raw = win.sessionStorage?.getItem(UTM_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const out: UtmRecord = {};
    for (const k of UTM_KEYS) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v === "string" && v) out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

function writeStoredUtm(win: Window, utm: UtmRecord): void {
  try {
    win.sessionStorage?.setItem(UTM_STORAGE_KEY, JSON.stringify(utm));
  } catch {
    // storage may be unavailable (private mode, quota, disabled)
  }
}

function utmFromSearch(search: string): UtmRecord {
  const out: UtmRecord = {};
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return out;
  }
  for (const k of UTM_KEYS) {
    const v = params.get(k.slice(1)); // "$utm_source" → "utm_source"
    if (v) out[k] = v;
  }
  return out;
}

function deriveAll(win: Window, persistUtm: boolean): Record<AutoAttributeKey, string | undefined> {
  const nav = win.navigator;
  const loc = win.location;
  const doc = win.document;
  const ua = nav?.userAgent ?? "";
  const maxTouchPoints = typeof nav?.maxTouchPoints === "number" ? nav.maxTouchPoints : 0;

  let coarsePointer = false;
  try {
    coarsePointer = typeof win.matchMedia === "function" && win.matchMedia("(pointer: coarse)").matches;
  } catch {
    // matchMedia may throw in exotic embeddings
  }
  const width = typeof win.innerWidth === "number" && win.innerWidth > 0 ? win.innerWidth : 1024;

  const search = loc?.search ?? "";
  let utm = utmFromSearch(search);
  if (persistUtm) {
    if (Object.keys(utm).length) {
      writeStoredUtm(win, utm);
    } else {
      utm = readStoredUtm(win) ?? {};
    }
  }

  let locale: string | undefined = nav?.language || undefined;
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    timezone = undefined;
  }
  if (locale === undefined) {
    try {
      locale = Intl.DateTimeFormat().resolvedOptions().locale || undefined;
    } catch {
      locale = undefined;
    }
  }

  const query = search.startsWith("?") ? search.slice(1) : search;

  return {
    $browser: classifyBrowser(ua),
    $os: classifyOS(ua, maxTouchPoints),
    $device_type: classifyDeviceType(ua, { coarsePointer, width, maxTouchPoints }),
    $url: loc?.href || undefined,
    $host: loc?.host || undefined,
    $path: loc?.pathname || undefined,
    $query: query || undefined,
    $referrer: doc?.referrer || undefined,
    $page_title: doc?.title || undefined,
    $utm_source: utm.$utm_source,
    $utm_medium: utm.$utm_medium,
    $utm_campaign: utm.$utm_campaign,
    $utm_term: utm.$utm_term,
    $utm_content: utm.$utm_content,
    $locale: locale,
    $timezone: timezone,
  };
}

/**
 * Auto-collected web attributes. Injects `$`-prefixed browser/page/UTM/locale
 * keys into every decision context via `onBeforeDecision` (same hook as the
 * redirect plugin). Caller-supplied context always wins; keys that cannot be
 * derived are omitted rather than sent empty. Re-derived on every decision so
 * SPA navigation is covered without patching `history`. SSR-safe: without a
 * `window` the context passes through untouched.
 *
 * @example
 * ```ts
 * const client = await createTrafficalClient({
 *   …,
 *   plugins: [autoAttributesPlugin({ exclude: ["$page_title"] })],
 * });
 * ```
 */
export function autoAttributesPlugin(options: AutoAttributesPluginOptions = {}): TrafficalPlugin {
  const persistUtm = options.persistUtm ?? true;

  const active = new Set<AutoAttributeKey>(
    options.include ? options.include.filter((k) => (AUTO_ATTRIBUTE_KEYS as readonly string[]).includes(k)) : AUTO_ATTRIBUTE_KEYS
  );
  for (const k of options.exclude ?? []) active.delete(k);

  return {
    name: "auto-attributes",

    onBeforeDecision(context: Context): Context {
      if (typeof window === "undefined") return context;
      let derived: Record<AutoAttributeKey, string | undefined>;
      try {
        derived = deriveAll(window, persistUtm);
      } catch {
        return context;
      }
      const out: Context = {};
      for (const k of active) {
        const v = derived[k];
        if (v !== undefined) out[k] = v;
      }
      return { ...out, ...context };
    },
  };
}

/** Alias with the `create*Plugin` naming used by the other bundled plugins. */
export const createAutoAttributesPlugin = autoAttributesPlugin;
