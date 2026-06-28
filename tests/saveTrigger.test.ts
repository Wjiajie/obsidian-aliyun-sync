import { describe, expect, it } from "vitest";
import { shouldRunSaveTriggeredSync } from "../src/sync/saveTrigger";

describe("save-triggered sync guard", () => {
  it("allows small save-triggered path batches", () => {
    expect(shouldRunSaveTriggeredSync(["a.md", "b.md"], 3).ok).toBe(true);
  });

  it("skips empty save-triggered path batches", () => {
    const decision = shouldRunSaveTriggeredSync([], 3);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain("no changed paths");
  });

  it("skips suspicious bulk save-triggered path batches", () => {
    const decision = shouldRunSaveTriggeredSync(["a.md", "b.md", "c.md", "d.md"], 3);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain("4 path events");
  });
});
