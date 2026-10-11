import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { movePhotosToBucket, storeMenuImage } from "@/server/menu-storage";

// Photos in a bucket (Cloudflare R2): new uploads go there, and photos still saved on the machine
// move over at start-up so a redeploy cannot wipe them. The bucket is faked here.

const sent: { Key: string; ContentType: string }[] = [];
let root: string;

beforeAll(async () => {
  vi.stubEnv("MENU_STORAGE_DRIVER", "r2");
  vi.stubEnv("MENU_STORAGE_BUCKET", "photos");
  vi.stubEnv("MENU_STORAGE_ENDPOINT", "https://acc.r2.cloudflarestorage.com");
  vi.stubEnv("MENU_STORAGE_PUBLIC_URL", "https://pub-x.r2.dev/");
  vi.stubEnv("MENU_STORAGE_ACCESS_KEY_ID", "key");
  vi.stubEnv("MENU_STORAGE_SECRET_ACCESS_KEY", "secret");
  vi.spyOn(S3Client.prototype, "send").mockImplementation(async (cmd: { input?: unknown }) => {
    sent.push(cmd.input as { Key: string; ContentType: string });
    return {} as never;
  });
  root = await mkdtemp(path.join(tmpdir(), "photos-"));
});

afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("menu photos in R2", () => {
  it("uploads the photo and its small copy and returns the public address", async () => {
    const bytes = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#c9482b" } }).jpeg().toBuffer();
    const res = await storeMenuImage({ tenantId: "t1", brandId: "b1", filename: "x.jpg", contentType: "image/jpeg", bytes });
    expect(res.url).toBe(`https://pub-x.r2.dev/${res.key}`);
    expect(sent.map((x) => x.Key)).toEqual([res.key, res.key.replace(/\.webp$/, "-sm.webp")]);
    expect(sent.every((x) => x.ContentType === "image/webp")).toBe(true);
  });

  it("moves photos still on the machine into the bucket and repoints the menu", async () => {
    sent.length = 0;
    const dir = path.join(root, "public", "uploads", "menus", "t1", "b1");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "a.webp"), "full");
    await writeFile(path.join(dir, "a-sm.webp"), "small");
    const rows: Record<string, { id: string; url: string }[]> = {
      menu_items: [{ id: "i1", url: "/uploads/menus/t1/b1/a.webp" }, { id: "i2", url: "/uploads/menus/t1/b1/gone.webp" }],
      menu_categories: [],
      brands: [],
    };
    const updates: unknown[][] = [];
    const sql = {
      query: async (q: string, values?: unknown[]) => {
        if (q.startsWith("select")) return [rows[q.split(" from ")[1].split(" ")[0]]];
        updates.push(values!);
        return [{}];
      },
    };
    const res = await movePhotosToBucket(sql, root);
    expect(res).toEqual({ moved: 1, missing: 1 });
    expect(sent.map((x) => x.Key)).toEqual(["menus/t1/b1/a.webp", "menus/t1/b1/a-sm.webp"]);
    expect(updates).toEqual([["https://pub-x.r2.dev/menus/t1/b1/a.webp", "i1", "/uploads/menus/t1/b1/a.webp"]]);
  });

  it("does nothing while photos are kept on the machine", async () => {
    vi.stubEnv("MENU_STORAGE_DRIVER", "local");
    expect(await movePhotosToBucket({ query: async () => { throw new Error("no queries expected"); } }, root)).toEqual({ moved: 0, missing: 0 });
  });
});
