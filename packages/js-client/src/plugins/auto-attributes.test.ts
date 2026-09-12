import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  autoAttributesPlugin,
  AUTO_ATTRIBUTE_KEYS,
  classifyBrowser,
  classifyOS,
  classifyDeviceType,
} from "./auto-attributes";
import type { Context } from "@traffical/core";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const FIREFOX_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0";
const EDGE_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const CHROME_ANDROID_PHONE =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const CHROME_ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SAFARI_IPADOS =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const CHROME_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface FakeWindowInit {
  ua?: string;
  href?: string;
  referrer?: string;
  title?: string;
  language?: string;
  innerWidth?: number;
  coarse?: boolean;
  maxTouchPoints?: number;
  sessionStorage?: Storage | null;
}

function makeSessionStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  } as Storage;
}

/** Builds a minimal window stand-in; the plugin reads everything via `window.*`. */
function installWindow(init: FakeWindowInit = {}): { sessionStorage: Storage | null } {
  const url = new URL(init.href ?? "https://shop.example.com/products/pillow?color=blue");
  const sessionStorage = init.sessionStorage === undefined ? makeSessionStorage() : init.sessionStorage;
  const win = {
    navigator: {
      userAgent: init.ua ?? CHROME_MAC,
      language: init.language ?? "en-GB",
      maxTouchPoints: init.maxTouchPoints ?? 0,
    },
    location: {
      href: url.href,
      host: url.host,
      pathname: url.pathname,
      search: url.search,
    },
    document: {
      referrer: init.referrer ?? "https://google.com/",
      title: init.title ?? "Pillow — Shop",
    },
    innerWidth: init.innerWidth ?? 1440,
    matchMedia: (q: string) => ({ matches: q === "(pointer: coarse)" ? (init.coarse ?? false) : false }),
    sessionStorage,
  };
  (globalThis as Record<string, unknown>).window = win;
  return { sessionStorage };
}

function derive(context: Context = {}, options?: Parameters<typeof autoAttributesPlugin>[0]): Context {
  const plugin = autoAttributesPlugin(options);
  return plugin.onBeforeDecision!(context) as Context;
}

describe("autoAttributesPlugin", () => {
  beforeEach(() => {
    installWindow();
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  test("derives every key on a fully populated window", () => {
    const ctx = derive({}, undefined);
    // page keys
    expect(ctx.$url).toBe("https://shop.example.com/products/pillow?color=blue");
    expect(ctx.$host).toBe("shop.example.com");
    expect(ctx.$path).toBe("/products/pillow");
    expect(ctx.$query).toBe("color=blue");
    expect(ctx.$referrer).toBe("https://google.com/");
    expect(ctx.$page_title).toBe("Pillow — Shop");
    // UA keys
    expect(ctx.$browser).toBe("chrome");
    expect(ctx.$os).toBe("macos");
    expect(ctx.$device_type).toBe("desktop");
    // locale / tz
    expect(ctx.$locale).toBe("en-GB");
    expect(typeof ctx.$timezone).toBe("string");
    expect((ctx.$timezone as string).length).toBeGreaterThan(0);
    // no utm on this URL and nothing persisted → omitted, not empty
    expect("$utm_source" in ctx).toBe(false);
  });

  test("derives the five utm keys from the query string", () => {
    installWindow({
      href: "https://shop.example.com/?utm_source=newsletter&utm_medium=email&utm_campaign=spring&utm_term=pillow&utm_content=hero",
    });
    const ctx = derive();
    expect(ctx.$utm_source).toBe("newsletter");
    expect(ctx.$utm_medium).toBe("email");
    expect(ctx.$utm_campaign).toBe("spring");
    expect(ctx.$utm_term).toBe("pillow");
    expect(ctx.$utm_content).toBe("hero");
    expect(ctx.$query).toBe(
      "utm_source=newsletter&utm_medium=email&utm_campaign=spring&utm_term=pillow&utm_content=hero"
    );
  });

  test("only emits $-prefixed keys from AUTO_ATTRIBUTE_KEYS (no un-prefixed leakage)", () => {
    installWindow({
      href: "https://shop.example.com/?utm_source=a&utm_medium=b&utm_campaign=c&utm_term=d&utm_content=e",
    });
    const ctx = derive();
    const keys = Object.keys(ctx);
    for (const k of keys) {
      expect(k.startsWith("$")).toBe(true);
      expect(AUTO_ATTRIBUTE_KEYS as readonly string[]).toContain(k);
    }
    expect(keys.sort()).toEqual([...AUTO_ATTRIBUTE_KEYS].sort());
  });

  test("caller-supplied context wins over derived keys", () => {
    const ctx = derive({ $browser: "custom", $path: "/override", userId: "u1" });
    expect(ctx.$browser).toBe("custom");
    expect(ctx.$path).toBe("/override");
    expect(ctx.userId).toBe("u1");
    expect(ctx.$host).toBe("shop.example.com");
  });

  test("include restricts to the listed keys", () => {
    const ctx = derive({}, { include: ["$path", "$browser"] });
    expect(Object.keys(ctx).sort()).toEqual(["$browser", "$path"]);
  });

  test("exclude removes keys, applied after include", () => {
    const ctx = derive({}, { exclude: ["$url", "$page_title", "$referrer"] });
    expect("$url" in ctx).toBe(false);
    expect("$page_title" in ctx).toBe(false);
    expect("$referrer" in ctx).toBe(false);
    expect(ctx.$path).toBe("/products/pillow");

    const both = derive({}, { include: ["$path", "$host"], exclude: ["$host"] });
    expect(Object.keys(both)).toEqual(["$path"]);
  });

  test("utm values persist in sessionStorage and are re-read on a URL without utm params", () => {
    const { sessionStorage } = installWindow({
      href: "https://shop.example.com/?utm_source=newsletter&utm_campaign=spring",
    });
    derive();
    expect(sessionStorage!.getItem("traffical:utm")).toBe(
      JSON.stringify({ $utm_source: "newsletter", $utm_campaign: "spring" })
    );

    // Next page of the same session: same storage, no utm in the URL.
    installWindow({ href: "https://shop.example.com/checkout", sessionStorage });
    const ctx = derive();
    expect(ctx.$utm_source).toBe("newsletter");
    expect(ctx.$utm_campaign).toBe("spring");
    expect("$utm_medium" in ctx).toBe(false);
    expect(ctx.$path).toBe("/checkout");
  });

  test("a fresh utm set on a later URL replaces the persisted one", () => {
    const { sessionStorage } = installWindow({ href: "https://shop.example.com/?utm_source=a" });
    derive();
    installWindow({ href: "https://shop.example.com/?utm_source=b&utm_medium=cpc", sessionStorage });
    const ctx = derive();
    expect(ctx.$utm_source).toBe("b");
    expect(ctx.$utm_medium).toBe("cpc");
    expect(sessionStorage!.getItem("traffical:utm")).toBe(JSON.stringify({ $utm_source: "b", $utm_medium: "cpc" }));
  });

  test("persistUtm: false neither writes nor reads sessionStorage", () => {
    const { sessionStorage } = installWindow({ href: "https://shop.example.com/?utm_source=newsletter" });
    sessionStorage!.setItem("traffical:utm", JSON.stringify({ $utm_medium: "stale" }));
    const first = derive({}, { persistUtm: false });
    expect(first.$utm_source).toBe("newsletter");
    expect("$utm_medium" in first).toBe(false);
    expect(sessionStorage!.getItem("traffical:utm")).toBe(JSON.stringify({ $utm_medium: "stale" }));

    installWindow({ href: "https://shop.example.com/checkout", sessionStorage });
    const second = derive({}, { persistUtm: false });
    expect("$utm_source" in second).toBe(false);
    expect("$utm_medium" in second).toBe(false);
  });

  test("survives a missing or throwing sessionStorage", () => {
    installWindow({ href: "https://shop.example.com/?utm_source=x", sessionStorage: null });
    expect(derive().$utm_source).toBe("x");

    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    installWindow({ href: "https://shop.example.com/?utm_source=y", sessionStorage: throwing });
    expect(derive().$utm_source).toBe("y");
  });

  test("SSR: without window the context passes through untouched", () => {
    delete (globalThis as { window?: unknown }).window;
    const input = { userId: "u1" };
    const out = derive(input);
    expect(out).toBe(input);
  });

  test("re-derives on every decision (SPA navigation)", () => {
    const plugin = autoAttributesPlugin();
    expect((plugin.onBeforeDecision!({}) as Context).$path).toBe("/products/pillow");
    (globalThis as { window: { location: { pathname: string } } }).window.location.pathname = "/cart";
    expect((plugin.onBeforeDecision!({}) as Context).$path).toBe("/cart");
  });

  test("empty page fields are omitted rather than sent as empty strings", () => {
    installWindow({ href: "https://shop.example.com/", referrer: "", title: "" });
    const ctx = derive();
    expect("$referrer" in ctx).toBe(false);
    expect("$page_title" in ctx).toBe(false);
    expect("$query" in ctx).toBe(false);
    expect(ctx.$path).toBe("/");
  });

  test("$device_type falls back to pointer + width when the UA is a desktop class", () => {
    installWindow({ ua: CHROME_LINUX, coarse: true, innerWidth: 600 });
    expect(derive().$device_type).toBe("mobile");
    installWindow({ ua: CHROME_LINUX, coarse: true, innerWidth: 900 });
    expect(derive().$device_type).toBe("tablet");
    installWindow({ ua: CHROME_LINUX, coarse: true, innerWidth: 1400 });
    expect(derive().$device_type).toBe("desktop");
    installWindow({ ua: CHROME_LINUX, coarse: false, innerWidth: 600 });
    expect(derive().$device_type).toBe("desktop");
  });

  test("iPadOS desktop-class UA is classified via maxTouchPoints", () => {
    installWindow({ ua: SAFARI_IPADOS, maxTouchPoints: 5 });
    const ctx = derive();
    expect(ctx.$os).toBe("ios");
    expect(ctx.$device_type).toBe("tablet");
    expect(ctx.$browser).toBe("safari");
  });
});

describe("UA classification", () => {
  test("browser", () => {
    expect(classifyBrowser(CHROME_MAC)).toBe("chrome");
    expect(classifyBrowser(SAFARI_IPHONE)).toBe("safari");
    expect(classifyBrowser(FIREFOX_WIN)).toBe("firefox");
    expect(classifyBrowser(EDGE_WIN)).toBe("edge");
    expect(classifyBrowser(CHROME_ANDROID_PHONE)).toBe("chrome");
    expect(classifyBrowser("curl/8.4.0")).toBe("other");
    expect(classifyBrowser("")).toBe("other");
  });

  test("os", () => {
    expect(classifyOS(CHROME_MAC)).toBe("macos");
    expect(classifyOS(SAFARI_IPHONE)).toBe("ios");
    expect(classifyOS(FIREFOX_WIN)).toBe("windows");
    expect(classifyOS(EDGE_WIN)).toBe("windows");
    expect(classifyOS(CHROME_ANDROID_PHONE)).toBe("android");
    expect(classifyOS(CHROME_LINUX)).toBe("linux");
    expect(classifyOS("curl/8.4.0")).toBe("other");
  });

  test("device type from UA class", () => {
    const desktop = { coarsePointer: false, width: 1440 };
    expect(classifyDeviceType(SAFARI_IPHONE, desktop)).toBe("mobile");
    expect(classifyDeviceType(CHROME_ANDROID_PHONE, desktop)).toBe("mobile");
    expect(classifyDeviceType(CHROME_ANDROID_TABLET, desktop)).toBe("tablet");
    expect(classifyDeviceType(CHROME_MAC, desktop)).toBe("desktop");
    expect(classifyDeviceType(FIREFOX_WIN, desktop)).toBe("desktop");
  });
});
