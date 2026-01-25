/**
 * @traffical/svelte - SvelteKit Helpers Tests
 */
import { describe, test, expect, mock } from "bun:test";
import { loadTrafficalBundle, resolveParamsSSR } from "./sveltekit.js";
// =============================================================================
// Test Fixtures
// =============================================================================
const mockBundle = {
    version: new Date().toISOString(),
    orgId: "org_test",
    projectId: "proj_test",
    env: "test",
    hashing: {
        unitKey: "userId",
        bucketCount: 10000,
    },
    parameters: [
        {
            key: "checkout.ctaText",
            type: "string",
            default: "Buy Now",
            layerId: "layer_1",
            namespace: "checkout",
        },
    ],
    layers: [
        {
            id: "layer_1",
            policies: [],
        },
    ],
    domBindings: [],
};
// =============================================================================
// loadTrafficalBundle Tests
// =============================================================================
describe("loadTrafficalBundle", () => {
    test("returns bundle on successful fetch", async () => {
        const mockFetch = mock(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockBundle),
        }));
        const result = await loadTrafficalBundle({
            orgId: "org_123",
            projectId: "proj_456",
            env: "production",
            apiKey: "pk_test",
            fetch: mockFetch,
        });
        expect(result.bundle).toEqual(mockBundle);
        expect(result.error).toBeUndefined();
    });
    test("returns null bundle on HTTP error", async () => {
        const mockFetch = mock(() => Promise.resolve({
            ok: false,
            status: 404,
            statusText: "Not Found",
        }));
        const result = await loadTrafficalBundle({
            orgId: "org_123",
            projectId: "proj_456",
            env: "production",
            apiKey: "pk_test",
            fetch: mockFetch,
        });
        expect(result.bundle).toBeNull();
        expect(result.error).toBe("HTTP 404: Not Found");
    });
    test("returns null bundle on network error", async () => {
        const mockFetch = mock(() => Promise.reject(new Error("Network error")));
        const result = await loadTrafficalBundle({
            orgId: "org_123",
            projectId: "proj_456",
            env: "production",
            apiKey: "pk_test",
            fetch: mockFetch,
        });
        expect(result.bundle).toBeNull();
        expect(result.error).toBe("Network error");
    });
    test("uses correct URL format", async () => {
        let capturedUrl = "";
        const mockFetch = mock((url) => {
            capturedUrl = url;
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockBundle),
            });
        });
        await loadTrafficalBundle({
            orgId: "org_123",
            projectId: "proj_456",
            env: "staging",
            apiKey: "pk_test",
            fetch: mockFetch,
        });
        expect(capturedUrl).toBe("https://sdk.traffical.io/v1/config/proj_456?env=staging");
    });
    test("uses custom baseUrl when provided", async () => {
        let capturedUrl = "";
        const mockFetch = mock((url) => {
            capturedUrl = url;
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockBundle),
            });
        });
        await loadTrafficalBundle({
            orgId: "org_123",
            projectId: "proj_456",
            env: "production",
            apiKey: "pk_test",
            fetch: mockFetch,
            baseUrl: "https://custom.api.com",
        });
        expect(capturedUrl).toBe("https://custom.api.com/v1/config/proj_456?env=production");
    });
    test("includes authorization header", async () => {
        let capturedOptions;
        const mockFetch = mock((_url, options) => {
            capturedOptions = options;
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockBundle),
            });
        });
        await loadTrafficalBundle({
            orgId: "org_123",
            projectId: "proj_456",
            env: "production",
            apiKey: "pk_secret_key",
            fetch: mockFetch,
        });
        expect(capturedOptions?.headers).toEqual({
            "Content-Type": "application/json",
            Authorization: "Bearer pk_secret_key",
        });
    });
});
// =============================================================================
// resolveParamsSSR Tests
// =============================================================================
describe("resolveParamsSSR", () => {
    test("returns defaults when bundle is null", () => {
        const defaults = {
            "checkout.ctaText": "Default",
        };
        const result = resolveParamsSSR(null, { userId: "user_123" }, defaults);
        expect(result).toEqual(defaults);
    });
    test("resolves parameters from bundle", () => {
        const defaults = {
            "checkout.ctaText": "Fallback",
        };
        const result = resolveParamsSSR(mockBundle, { userId: "user_123" }, defaults);
        expect(result["checkout.ctaText"]).toBe("Buy Now");
    });
    test("uses context for resolution", () => {
        const defaults = {
            "checkout.ctaText": "Fallback",
        };
        // Both should resolve to the same value since we're using defaults
        const result1 = resolveParamsSSR(mockBundle, { userId: "user_1" }, defaults);
        const result2 = resolveParamsSSR(mockBundle, { userId: "user_2" }, defaults);
        // Without active policies, results should be the same (bundle defaults)
        expect(result1["checkout.ctaText"]).toBe("Buy Now");
        expect(result2["checkout.ctaText"]).toBe("Buy Now");
    });
});
