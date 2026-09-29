import { afterEach, describe, expect, it } from "vitest";
import { supabaseUrl } from "@/lib/storage";

const saved = { db: process.env.DATABASE_URL, url: process.env.SUPABASE_URL };
afterEach(() => {
  process.env.DATABASE_URL = saved.db;
  if (saved.url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = saved.url;
});

describe("Supabase address", () => {
  it("is worked out from the database URL, pooled or direct", () => {
    delete process.env.SUPABASE_URL;
    process.env.DATABASE_URL = "postgresql://postgres.abcdefghijklmnopqrst:p%40ss@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";
    expect(supabaseUrl()).toBe("https://abcdefghijklmnopqrst.supabase.co");
    process.env.DATABASE_URL = "postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres";
    expect(supabaseUrl()).toBe("https://abcdefghijklmnopqrst.supabase.co");
  });

  it("uses SUPABASE_URL when set, and gives up on other databases", () => {
    process.env.SUPABASE_URL = "https://custom.example.co/";
    expect(supabaseUrl()).toBe("https://custom.example.co");
    delete process.env.SUPABASE_URL;
    process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:54329/daybook";
    expect(supabaseUrl()).toBeNull();
  });
});
