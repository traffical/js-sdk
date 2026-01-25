import { describe, test, expect, beforeEach, spyOn } from "bun:test";
import { PluginManager, type TrafficalPlugin } from "./index";

describe("PluginManager", () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  test("register adds plugin", () => {
    const plugin: TrafficalPlugin = { name: "test-plugin" };
    manager.register(plugin);
    
    expect(manager.get("test-plugin")).toBe(plugin);
  });

  test("register prevents duplicates", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    
    manager.register({ name: "test" });
    manager.register({ name: "test" });
    
    expect(warnSpy).toHaveBeenCalled();
    expect(manager.getAll()).toHaveLength(1);
    
    warnSpy.mockRestore();
  });

  test("unregister removes plugin", () => {
    manager.register({ name: "test" });
    expect(manager.get("test")).toBeDefined();
    
    const removed = manager.unregister("test");
    
    expect(removed).toBe(true);
    expect(manager.get("test")).toBeUndefined();
  });

  test("unregister returns false for missing plugin", () => {
    expect(manager.unregister("missing")).toBe(false);
  });

  test("plugins sorted by priority (high first)", () => {
    manager.register({ plugin: { name: "low" }, priority: 1 });
    manager.register({ plugin: { name: "high" }, priority: 10 });
    manager.register({ plugin: { name: "medium" }, priority: 5 });
    
    const names = manager.getAll().map((p) => p.name);
    expect(names).toEqual(["high", "medium", "low"]);
  });

  test("runBeforeDecision modifies context", () => {
    manager.register({
      name: "enricher",
      onBeforeDecision: (ctx) => ({ ...ctx, enriched: true }),
    });

    const result = manager.runBeforeDecision({ userId: "123" });
    
    expect(result).toEqual({ userId: "123", enriched: true });
  });

  test("runBeforeDecision chains modifications", () => {
    manager.register({
      plugin: {
        name: "first",
        onBeforeDecision: (ctx) => ({ ...ctx, first: true }),
      },
      priority: 10,
    });
    manager.register({
      plugin: {
        name: "second",
        onBeforeDecision: (ctx) => ({ ...ctx, second: true }),
      },
      priority: 1,
    });

    const result = manager.runBeforeDecision({});
    
    expect(result).toEqual({ first: true, second: true });
  });

  test("runDecision calls all plugins", () => {
    const calls: string[] = [];
    
    manager.register({
      name: "a",
      onDecision: () => calls.push("a"),
    });
    manager.register({
      name: "b",
      onDecision: () => calls.push("b"),
    });

    manager.runDecision({
      decisionId: "dec_1",
      assignments: {},
      metadata: { timestamp: "", unitKeyValue: "", layers: [] },
    });
    
    expect(calls).toEqual(["a", "b"]);
  });

  test("runExposure can cancel tracking", () => {
    manager.register({
      name: "blocker",
      onExposure: () => false,
    });

    const result = manager.runExposure({
      type: "exposure",
      decisionId: "dec_1",
      orgId: "",
      projectId: "",
      env: "",
      unitKey: "",
      timestamp: "",
      assignments: {},
      layers: [],
    });
    
    expect(result).toBe(false);
  });

  test("runExposure allows tracking by default", () => {
    manager.register({
      name: "observer",
      onExposure: () => {}, // No return value
    });

    const result = manager.runExposure({
      type: "exposure",
      decisionId: "dec_1",
      orgId: "",
      projectId: "",
      env: "",
      unitKey: "",
      timestamp: "",
      assignments: {},
      layers: [],
    });
    
    expect(result).toBe(true);
  });

  test("runInitialize awaits async hooks", async () => {
    let initialized = false;
    
    manager.register({
      name: "async-init",
      onInitialize: async () => {
        await new Promise((r) => setTimeout(r, 10));
        initialized = true;
      },
    });

    await manager.runInitialize();
    
    expect(initialized).toBe(true);
  });

  test("runDestroy calls cleanup hooks", () => {
    let destroyed = false;
    
    manager.register({
      name: "cleanup",
      onDestroy: () => { destroyed = true; },
    });

    manager.runDestroy();
    
    expect(destroyed).toBe(true);
  });

  test("plugin errors don't break other plugins", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const calls: string[] = [];
    
    manager.register({
      plugin: { name: "first", onDecision: () => calls.push("first") },
      priority: 10,
    });
    manager.register({
      plugin: {
        name: "broken",
        onDecision: () => { throw new Error("boom"); },
      },
      priority: 5,
    });
    manager.register({
      plugin: { name: "last", onDecision: () => calls.push("last") },
      priority: 1,
    });

    manager.runDecision({
      decisionId: "",
      assignments: {},
      metadata: { timestamp: "", unitKeyValue: "", layers: [] },
    });
    
    expect(calls).toEqual(["first", "last"]);
    expect(warnSpy).toHaveBeenCalled();
    
    warnSpy.mockRestore();
  });

  test("runConfigUpdate calls all plugins with bundle", () => {
    const bundles: unknown[] = [];
    
    manager.register({
      name: "config-observer",
      onConfigUpdate: (bundle) => bundles.push(bundle),
    });

    const mockBundle = {
      version: "2024-01-01T00:00:00Z",
      orgId: "org_1",
      projectId: "proj_1",
      env: "production",
      hashing: { unitKey: "userId", bucketCount: 1000 },
      parameters: [],
      layers: [],
    };

    manager.runConfigUpdate(mockBundle);
    
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toBe(mockBundle);
  });

  test("runResolve calls all plugins with params", () => {
    const paramsList: unknown[] = [];
    
    manager.register({
      name: "resolve-observer",
      onResolve: (params) => paramsList.push(params),
    });

    const mockParams = { "ui.color": "#000", "ui.size": 16 };

    manager.runResolve(mockParams);
    
    expect(paramsList).toHaveLength(1);
    expect(paramsList[0]).toBe(mockParams);
  });
});

