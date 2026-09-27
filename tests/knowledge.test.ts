// SPDX-License-Identifier: MIT
// Pons Family: knowledge base tests for Jay, the pons.family support agent.

import { describe, expect, it } from "vitest";
import { loadKnowledgeBase, searchKnowledge } from "../src/knowledge/loader.js";

const kb = loadKnowledgeBase();

describe("knowledge base", () => {
  it("loads every file in a deterministic order", () => {
    expect(kb.fullText.startsWith('<doc file="00-overview.md">')).toBe(true);
    expect(loadKnowledgeBase().fullText).toBe(kb.fullText);
  });

  it("contains the facts Jay must quote exactly", () => {
    for (const fact of [
      "4663",
      "0.0005 ETH",
      "4.2 ETH",
      "70% creator",
      "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB",
    ]) {
      expect(kb.fullText).toContain(fact);
    }
  });

  it("finds the right section for common questions", () => {
    expect(searchKnowledge(kb, "creator fee split")[0]?.file).toBe("20-fees.md");
    expect(searchKnowledge(kb, "anti-snipe launch protection")[0]?.heading).toMatch(
      /Launch protection/,
    );
    expect(searchKnowledge(kb, "chain id rpc")[0]?.file).toBe("50-chain.md");
  });

  it("returns nothing for stopword-only queries", () => {
    expect(searchKnowledge(kb, "how do I")).toEqual([]);
  });
});
