import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home, { metadata } from "@/app/page";
import { autoKotSaved, saveAutoKot } from "@/app/(staff)/kds/_components/kot-print";

afterEach(() => { vi.unstubAllGlobals(); });

describe("Tableeqr branding and compatibility", () => {
  it("renders the renamed homepage wordmark even where the name is split across elements", () => {
    const html = renderToStaticMarkup(createElement(Home));
    expect(html.replace(/<[^>]+>/g, "")).toContain("Tableeqr");
    expect(html).toContain("One Tableeqr.");
    expect(html).not.toMatch(/TableQR|TABLEQR/);
    expect(metadata.title).toContain("Tableeqr");
  });

  it("has no old display-brand spelling in active app source", () => {
    const violations: string[] = [];
    const scan = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) scan(file);
        else if (/\.(?:tsx?|js|html|xml|json)$/.test(file) && !file.endsWith(".test.ts")) {
          // Uppercase secret names and case-sensitive table-QR identifiers are compatibility APIs.
          if (/\bTableQR\b|\bTABLEQR\b/.test(fs.readFileSync(file, "utf8"))) violations.push(file);
        }
      }
    };
    scan(path.resolve("src"));
    scan(path.resolve("public"));
    expect(violations).toEqual([]);
  });

  it("renames Android display labels while preserving the installed application's update identity", () => {
    const config = JSON.parse(fs.readFileSync("rider-app/capacitor.config.json", "utf8"));
    expect(config.appName).toBe("Tableeqr Rider");
    expect(config.appId).toBe("com.craftory.tableqr.rider");
    const strings = fs.readFileSync("rider-app/android/app/src/main/res/values/strings.xml", "utf8");
    expect(strings).toContain('<string name="app_name">Tableeqr Rider</string>');
    expect(strings).not.toContain("TableQR Rider");
  });

  it("preserves and migrates the kitchen's saved auto-print preference", () => {
    const values = new Map([["tableqr.kds.autoKot", "1"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    expect(autoKotSaved()).toBe(true);
    expect(values.get("tableeqr.kds.autoKot")).toBe("1");
    expect(values.has("tableqr.kds.autoKot")).toBe(false);
    saveAutoKot(false);
    expect(autoKotSaved()).toBe(false);
  });

  it("replaces old branded offline shell caches and retains unrelated caches", async () => {
    const handlers = new Map<string, (event: { waitUntil: (work: Promise<unknown>) => void }) => void>();
    const deleted: string[] = [];
    const claim = vi.fn();
    vm.runInNewContext(fs.readFileSync("public/sw.js", "utf8"), {
      self: { addEventListener: (name: string, handler: typeof handlers extends Map<string, infer H> ? H : never) => handlers.set(name, handler), clients: { claim } },
      caches: {
        keys: async () => ["tableqr-staff-shell-v1", "tableqr-staff-assets-v1", "tableeqr-staff-shell-v1", "unrelated-cache"],
        delete: async (name: string) => { deleted.push(name); },
      },
    });
    let pending: Promise<unknown> | undefined;
    handlers.get("activate")!({ waitUntil: (work) => { pending = work; } });
    await pending;
    expect(deleted).toEqual(["tableqr-staff-shell-v1", "tableqr-staff-assets-v1"]);
    expect(claim).toHaveBeenCalledOnce();
  });

  it("routes staff console pages to the saved POS after a network failure", async () => {
    type ServiceWorkerEvent = { request?: { method: string; mode: string; url: string }; respondWith?: (response: Promise<Response> | Response) => void; waitUntil?: (work: Promise<unknown>) => void };
    const handlers = new Map<string, (event: ServiceWorkerEvent) => void>();
    vm.runInNewContext(fs.readFileSync("public/sw.js", "utf8"), {
      self: { addEventListener: (name: string, handler: (event: ServiceWorkerEvent) => void) => handlers.set(name, handler), location: { origin: "https://tableeqr.example" }, clients: { claim: vi.fn() } },
      caches: {}, fetch: () => Promise.reject(new Error("offline")), URL, Response,
    });
    let navigationResponse: Promise<Response> | Response | undefined;
    const event: ServiceWorkerEvent = { request: { method: "GET", mode: "navigate", url: "https://tableeqr.example/console/dashboard" }, respondWith: (response) => { navigationResponse = response; } };
    handlers.get("fetch")!(event);
    const response = await navigationResponse!;
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://tableeqr.example/offline-pos");

    let loginWasIntercepted = false;
    const login: ServiceWorkerEvent = { request: { method: "GET", mode: "navigate", url: "https://tableeqr.example/console/login" }, respondWith: () => { loginWasIntercepted = true; } };
    handlers.get("fetch")!(login);
    expect(loginWasIntercepted).toBe(false);
  });

  it("keeps the old kitchen preference readable if browser storage cannot migrate it", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => key === "tableqr.kds.autoKot" ? "1" : null,
      setItem: () => { throw new Error("Storage full"); },
      removeItem: vi.fn(),
    });
    expect(autoKotSaved()).toBe(true);
    expect(localStorage.removeItem).not.toHaveBeenCalled();
  });
});
