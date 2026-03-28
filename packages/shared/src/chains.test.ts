import { describe, expect, it } from "vitest";
import * as chainsModule from "./chains.js";
import {
  getSupportedChainById,
  isSupportedChainId,
  SUPPORTED_CHAIN_IDS,
  supportedChains,
} from "./chains.js";

describe("supported chains", () => {
  it("keeps internal chain constants private", () => {
    expect("BASE_SEPOLIA_CHAIN_ID" in chainsModule).toBe(false);
    expect("BASE_SEPOLIA_OFFICIAL_USDC_ADDRESS" in chainsModule).toBe(false);
  });

  it("exports the centralized V1 supported chain list", () => {
    expect(SUPPORTED_CHAIN_IDS).toEqual([84532]);
    expect(supportedChains).toHaveLength(1);
    expect(supportedChains[0]).toMatchObject({
      id: 84532,
      key: "base-sepolia",
      name: "Base Sepolia",
      officialUsdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      viemChain: {
        id: 84532,
        name: "Base Sepolia",
      },
    });
  });

  it("resolves supported chains by id", () => {
    expect(isSupportedChainId(84532)).toBe(true);
    expect(getSupportedChainById(84532)?.name).toBe("Base Sepolia");
    expect(getSupportedChainById(1)).toBeUndefined();
  });
});
