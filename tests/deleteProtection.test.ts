import { describe, expect, it } from "vitest";
import { checkDeleteProtection } from "../src/sync/deleteProtection";
import type { SyncOperation } from "../src/types";

function deleteOp(path: string): SyncOperation {
  return { path, kind: "delete-local", destructive: true, reason: "test" };
}

describe("delete protection", () => {
  it("passes when there are no deletes", () => {
    expect(checkDeleteProtection([], 10, { maxDeleteCount: 1, maxDeletePercentage: 1 }).ok).toBe(true);
  });

  it("blocks excessive delete counts", () => {
    const result = checkDeleteProtection([deleteOp("a"), deleteOp("b")], 10, {
      maxDeleteCount: 1,
      maxDeletePercentage: 100
    });
    expect(result.ok).toBe(false);
  });

  it("blocks excessive delete percentage", () => {
    const result = checkDeleteProtection([deleteOp("a")], 2, {
      maxDeleteCount: 10,
      maxDeletePercentage: 40
    });
    expect(result.ok).toBe(false);
  });
});
