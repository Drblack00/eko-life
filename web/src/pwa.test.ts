import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * PWA contract tests (node-only): the manifest must be valid JSON with the
 * fields Chrome's installability check requires, every declared icon must
 * exist on disk, and the service worker must be the safe hand-rolled one
 * (versioned cache, /api/* never intercepted). Real-browser checks
 * (manifest 200 + content-type, SW registration, installability) are done
 * against a served production build.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const pub = join(root, "public");

const manifestRaw = readFileSync(join(pub, "manifest.webmanifest"), "utf8");
const manifest = JSON.parse(manifestRaw);
const sw = readFileSync(join(pub, "sw.js"), "utf8");
const indexHtml = readFileSync(join(root, "index.html"), "utf8");

describe("PWA manifest", () => {
  it("is valid JSON with required installability fields", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Array.isArray(manifest.icons)).toBe(true);
  });

  it("declares raster 192px and 512px icons plus a maskable icon", () => {
    const icons = manifest.icons as Array<{
      src: string;
      sizes: string;
      type: string;
      purpose?: string;
    }>;
    const has = (sizes: string, purpose: string) =>
      icons.some(
        (i) =>
          i.sizes === sizes &&
          (i.purpose ?? "any") === purpose &&
          i.type === "image/png"
      );
    expect(has("192x192", "any")).toBe(true);
    expect(has("512x512", "any")).toBe(true);
    expect(has("512x512", "maskable")).toBe(true);
  });

  it("every declared icon exists in public/", () => {
    for (const icon of manifest.icons as Array<{ src: string }>) {
      const disk = join(pub, icon.src.replace(/^\//, ""));
      expect(existsSync(disk), `missing icon file: ${icon.src}`).toBe(true);
    }
  });
});

describe("service worker", () => {
  it("uses a versioned cache and takes control safely", () => {
    expect(sw).toMatch(/const CACHE = "eko-life-[\w-]+-v\d+"/);
    expect(sw).toContain("skipWaiting()");
    expect(sw).toContain("clients.claim()");
  });

  it("never intercepts /api/* requests", () => {
    expect(sw).toContain('"/api/"');
    // The /api branch must respond with a bare network fetch (no cache put).
    const apiBranch = sw.slice(sw.indexOf('"/api/"'), sw.indexOf('"/api/"') + 120);
    expect(apiBranch).toContain("fetch(request)");
    expect(apiBranch).not.toContain("cache.put");
  });

  it("has a fetch handler for offline shell fallback", () => {
    expect(sw).toContain('addEventListener("fetch"');
    expect(sw).toContain('request.mode === "navigate"');
  });
});

describe("index.html wiring", () => {
  it("links the manifest, theme color, and iOS tags", () => {
    expect(indexHtml).toContain('rel="manifest"');
    expect(indexHtml).toContain('name="theme-color"');
    expect(indexHtml).toContain('name="apple-mobile-web-app-capable"');
    expect(indexHtml).toContain('rel="apple-touch-icon"');
  });
});
