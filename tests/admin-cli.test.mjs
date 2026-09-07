import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("operator CLI", () => {
  it("generates both cryptographic keys and exits successfully", () => {
    const output = execFileSync(process.execPath, ["scripts/admin.mjs", "keys:generate"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const lines = output.trim().split(/\r?\n/);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^REVIEW_TOKEN_ENCRYPTION_KEY=[A-Za-z0-9_-]{43}$/);
    expect(lines[1]).toMatch(/^REVIEW_SESSION_SIGNING_KEY=[A-Za-z0-9_-]{64}$/);
  });
});
