import { describe, expect, it } from "vitest";
import { buildProgram } from "./index.js";

describe("cli help", () => {
  it("lists the expected commands and backend override flag", () => {
    const help = buildProgram().helpInformation();

    expect(help).toContain("create");
    expect(help).toContain("status");
    expect(help).toContain("await");
    expect(help).toContain("--backend-url");
  });
});
