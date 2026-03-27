import { describe, expect, it } from "vitest";
import { buildProgram } from "./index.js";

describe("cli help", () => {
  it("lists the expected commands and backend override flag", () => {
    const help = buildProgram().helpInformation();

    expect(help).toContain("create");
    expect(help).toContain("status");
    expect(help).toContain("await");
    expect(help).toContain("call");
    expect(help).toContain("--backend-url");
  });

  it("documents create usage with base sepolia and localhost", () => {
    const createCommand = buildProgram().commands.find(
      (command) => command.name() === "create",
    );

    expect(createCommand?.helpInformation()).toContain("--chain-id");
    expect(createCommand?.helpInformation()).toContain("--backend-url");
    expect(createCommand?.helpInformation()).toContain("--allowed-method");
  });

  it("documents call usage for a ready wallet", () => {
    const callCommand = buildProgram().commands.find(
      (command) => command.name() === "call",
    );

    expect(callCommand?.helpInformation()).toContain("<wallet-id>");
    expect(callCommand?.helpInformation()).toContain("--to");
    expect(callCommand?.helpInformation()).toContain("--data");
  });
});
