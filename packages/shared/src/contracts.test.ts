import { describe, expect, it } from "vitest";
import {
  canTransitionStatus,
  normalizePermissionScope,
  selectorSchema,
} from "./contracts.js";

describe("shared contracts", () => {
  it("normalizes duplicate selectors", () => {
    const scope = normalizePermissionScope({
      chainId: 8453,
      targetContract: "0x1111111111111111111111111111111111111111",
      allowedMethods: ["0xa9059cbb", "0xa9059cbb"],
    });

    expect(scope.allowedMethods).toEqual(["0xa9059cbb"]);
  });

  it("validates selector format", () => {
    expect(() => selectorSchema.parse("0xa9059cbb")).not.toThrow();
    expect(() => selectorSchema.parse("transfer(address,uint256)")).toThrow();
  });

  it("enforces the status graph", () => {
    expect(canTransitionStatus("created", "link_opened")).toBe(true);
    expect(canTransitionStatus("created", "ready")).toBe(false);
  });
});
