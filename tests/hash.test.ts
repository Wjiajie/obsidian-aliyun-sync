import { describe, expect, it } from "vitest";
import { encodeText, hashBuffer } from "../src/lib/hash";

describe("content hash", () => {
  it("uses SHA-1 for file content hashes", () => {
    expect(hashBuffer(encodeText("abc"))).toBe("A9993E364706816ABA3E25717850C26C9CD0D89D");
  });
});
