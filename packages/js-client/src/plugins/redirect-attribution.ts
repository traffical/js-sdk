import type { TrafficalPlugin } from "./types.js";
import type { ExposureEvent, TrackEvent, TrackAttribution } from "@traffical/core";

const COOKIE_NAME = "traffical_rdr";
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface RedirectAttributionPluginOptions {
  /** Cookie name to read attribution from. Default: "traffical_rdr" */
  cookieName?: string;
  /** How long the attribution cookie is valid in ms. Default: 24 hours */
  expiryMs?: number;
}

interface StoredAttribution {
  l: string; // layerId
  p: string; // policyId
  a: string; // allocationName
  ts: number; // timestamp
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  try {
    for (const part of document.cookie.split(";")) {
      const [k, v] = part.trim().split("=");
      if (k === name && v) return decodeURIComponent(v);
    }
  } catch {
    // cookie access failed
  }
  return null;
}

function parseAttribution(
  cookieName: string,
  expiryMs: number
): TrackAttribution | null {
  const raw = readCookie(cookieName);
  if (!raw) return null;

  try {
    const data: StoredAttribution = JSON.parse(raw);
    if (Date.now() - data.ts > expiryMs) return null;
    return {
      layerId: data.l,
      policyId: data.p,
      allocationName: data.a,
    };
  } catch {
    return null;
  }
}

export function createRedirectAttributionPlugin(
  options: RedirectAttributionPluginOptions = {}
): TrafficalPlugin {
  const cookieName = options.cookieName ?? COOKIE_NAME;
  const expiryMs = options.expiryMs ?? DEFAULT_EXPIRY_MS;

  function inject(event: { attribution?: TrackAttribution[] }): void {
    const attr = parseAttribution(cookieName, expiryMs);
    if (!attr) return;
    event.attribution = event.attribution ?? [];
    const already = event.attribution.some(
      (a) => a.layerId === attr.layerId && a.policyId === attr.policyId
    );
    if (!already) {
      event.attribution.push(attr);
    }
  }

  return {
    name: "redirect-attribution",

    onTrack(event: TrackEvent): boolean | void {
      inject(event);
      return true;
    },

    onExposure(event: ExposureEvent): boolean | void {
      inject(event as unknown as { attribution?: TrackAttribution[] });
      return true;
    },
  };
}
