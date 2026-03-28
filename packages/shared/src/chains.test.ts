import { describe, expect, it } from "vitest";
import {
  BASE_SEPOLIA_CHAIN_ID,
  getSupportedChainById,
  isSupportedChainId,
  SUPPORTED_CHAIN_IDS,
  supportedChains,
} from "./chains.js";

describe("supported chains", () => {
  it("exports the centralized V1 supported chain list", () => {
    expect(SUPPORTED_CHAIN_IDS).toEqual([BASE_SEPOLIA_CHAIN_ID]);
    expect(supportedChains).toHaveLength(1);
    expect(supportedChains[0]).toMatchObject({
      id: 84532,
      key: "base-sepolia",
      name: "Base Sepolia",
    });
  });

  it("resolves supported chains by id", () => {
    expect(isSupportedChainId(BASE_SEPOLIA_CHAIN_ID)).toBe(true);
    expect(getSupportedChainById(BASE_SEPOLIA_CHAIN_ID)?.name).toBe(
      "Base Sepolia",
    );
    expect(getSupportedChainById(1)).toBeUndefined();
  });
});
