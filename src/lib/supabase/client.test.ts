import { beforeAll, describe, expect, it } from "vitest";

describe("supabase browser client", () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  });

  it("creates a client without throwing", async () => {
    const { createClient } = await import("./client");
    expect(() => createClient()).not.toThrow();
  });
});
