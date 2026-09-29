import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closePool, q } from "@/lib/db";
import { fileView, normalizeData, type FileData } from "@/lib/scratch";
import { copyItem, createItem, deleteItem, finishUpload, mediaUrls, startUpload, sweepAbandonedUploads, updateItem } from "@/lib/services/scratch";
import { searchAll } from "@/lib/services/search";
import { evaluateSheet, showCell } from "@/lib/sheet";
import { MAX_FILE_BYTES, resetStore, useMemoryStore } from "@/lib/storage";
import { resetDb } from "./helpers";

let mem: ReturnType<typeof useMemoryStore>;
beforeEach(async () => {
  await resetDb();
  await q("delete from scratch_items");
  mem = useMemoryStore();
});
afterEach(resetStore);
afterAll(closePool);

const put = (path: string, bytes = 1234, mime = "image/png") => mem.set(path, { data: new Uint8Array(bytes), mime });

describe("new scratchpad formats", () => {
  it("cleans checklists, tables, links and code", () => {
    expect(normalizeData("checklist", { items: [{ id: "a", text: "Milk", done: true }, { text: 5 }, "junk"] })).toMatchObject({
      items: [{ id: "a", text: "Milk", done: true }, { text: "", done: false }],
    });
    expect(normalizeData("table", { rows: [["1", 2], ["x"]] })).toEqual({ rows: [["1", "2"], ["x", ""]] });
    expect(normalizeData("link", { url: "example.com/a", note: "read" })).toEqual({ url: "https://example.com/a", note: "read" });
    expect(normalizeData("code", { lang: "cobol", code: "x" })).toEqual({ lang: "text", code: "x" });
  });

  it("picks the right preview for a file", () => {
    expect(fileView("a.jpg", "image/jpeg")).toBe("image");
    expect(fileView("a.mov", "video/quicktime")).toBe("video");
    expect(fileView("report.pdf", "application/octet-stream")).toBe("pdf");
    expect(fileView("data.csv", "")).toBe("csv");
    expect(fileView("plan.md", "")).toBe("markdown");
    expect(fileView("script.py", "")).toBe("text");
    expect(fileView("budget.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("office");
    expect(fileView("proposal.docx", "")).toBe("office");
    expect(fileView("archive.zip", "application/zip")).toBe("other");
  });
});

describe("table formulas", () => {
  const show = (rows: string[][]) => evaluateSheet(rows).map((r) => r.map(showCell));
  it("adds up cells, ranges and percentages", () => {
    expect(show([
      ["Rent", "18000"],
      ["Food", "6,500"],
      ["Total", "=SUM(B1:B2)"],
      ["GST", "=B3*18%"],
      ["Avg", "=avg(B1:B2)"],
      ["Count", "=COUNT(B1:B4)"],
    ])).toEqual([
      ["Rent", "18000"], ["Food", "6500"], ["Total", "24500"], ["GST", "4410"], ["Avg", "12250"], ["Count", "4"],
    ]);
  });
  it("shows errors in the cell instead of breaking", () => {
    expect(show([["=A2", "=A1"], ["=B1", "=1/0"], ["hello", "=A3+1"]])).toEqual([
      ["#CYCLE", "#CYCLE"], ["#CYCLE", "#DIV/0"], ["hello", "#ERR"],
    ]);
  });
});

describe("files in the scratchpad", () => {
  it("uploads in two steps: reserve, then confirm once the file has arrived", async () => {
    const { row, uploadUrl } = await startUpload("2026-09-29", "file", { name: "Site photo (1).JPG", mime: "image/jpeg", size: 5000 });
    const f = row.data as FileData;
    expect(f.status).toBe("uploading");
    expect(f.path).toMatch(/^2026-09-29\/[0-9a-f]{16}-Site_photo_1_.JPG$/);
    expect(uploadUrl).toBe(`memory://upload/${f.path}`);
    await expect(finishUpload(row.id)).rejects.toThrow(/did not arrive/);
    put(f.path, 4321, "image/jpeg");
    const done = await finishUpload(row.id, { width: 800, height: 600 });
    expect(done.data).toMatchObject({ status: "ready", size: 4321, width: 800, height: 600, mime: "image/jpeg" });
    expect((await mediaUrls([done])).get(done.id)).toBe(`memory://get/${f.path}`);
  });

  it("refuses empty and oversized files", async () => {
    await expect(startUpload("2026-09-29", "file", { name: "x.bin", mime: "", size: 0 })).rejects.toThrow(/empty/);
    await expect(startUpload("2026-09-29", "file", { name: "big.mov", mime: "video/quicktime", size: MAX_FILE_BYTES + 1 })).rejects.toThrow(/limit is 50 MB/);
  });

  it("never lets an edit point an item at another file", async () => {
    const { row } = await startUpload("2026-09-29", "voice", { name: "memo.webm", mime: "audio/webm", size: 900 });
    put((row.data as FileData).path, 900, "audio/webm");
    await finishUpload(row.id);
    const edited = await updateItem(row.id, { data: { path: "someone/else.pdf", name: "evil", transcript: "Call Rahul about the pilot" } });
    expect(edited.data).toMatchObject({ path: (row.data as FileData).path, name: "memo.webm", transcript: "Call Rahul about the pilot" });
  });

  it("copies the file with the item, and deletes a file only when no item uses it", async () => {
    const { row } = await startUpload("2026-09-28", "file", { name: "plan.pdf", mime: "application/pdf", size: 100 });
    const path = (row.data as FileData).path;
    put(path, 100, "application/pdf");
    await finishUpload(row.id);
    const copy = await copyItem(row.id, "2026-09-29");
    const copyPath = (copy.data as FileData).path;
    expect(copyPath).not.toBe(path);
    expect(mem.has(copyPath)).toBe(true);
    await deleteItem(row.id);
    expect(mem.has(path)).toBe(false);
    expect(mem.has(copyPath)).toBe(true);
  });

  it("cleans up uploads abandoned for a day", async () => {
    const { row } = await startUpload("2026-09-28", "file", { name: "half.mov", mime: "video/mp4", size: 100 });
    put((row.data as FileData).path);
    await q("update scratch_items set created_at = now() - interval '2 days' where id = $1", [row.id]);
    expect(await sweepAbandonedUploads()).toBe(1);
    expect(mem.size).toBe(0);
  });

  it("search finds file names, transcripts, checklist items and links", async () => {
    const { row } = await startUpload("2026-09-29", "file", { name: "GST-return-Sept.pdf", mime: "application/pdf", size: 10 });
    put((row.data as FileData).path, 10);
    await finishUpload(row.id);
    await createItem("2026-09-29", "checklist", "", { items: [{ text: "Book GST consultant", done: false }] });
    await createItem("2026-09-29", "link", "", { url: "https://gst.gov.in", note: "" });
    const hits = (await searchAll("gst")).filter((h) => h.kind === "scratch");
    expect(hits.length).toBe(3);
  });
});
