import { describe, expect, it } from "vitest";
import { buildProgram } from "./index.js";

describe("cli help", () => {
  it("lists the expected commands and backend override flag", () => {
    const help = buildProgram().helpInformation();

    expect(help).toContain("create");
    expect(help).toContain("status");
    expect(help).toContain("await");
    expect(help).toContain("call");
    expect(help).toContain("sign-typed-data");
    expect(help).toContain("--backend-url");
    expect(help).toContain("Supported chains");
    expect(help).toContain("84532 (Base Sepolia)");
  });

  it("documents create usage with base sepolia and localhost", () => {
    const createCommand = buildProgram().commands.find(
      (command) => command.name() === "create",
    );

    expect(createCommand?.helpInformation()).toContain("--chain-id");
    expect(createCommand?.helpInformation()).toContain("--backend-url");
    expect(createCommand?.helpInformation()).toContain("84532 (Base Sepolia)");
    expect(createCommand?.helpInformation()).toContain(
      "Create a wallet provisioning request",
    );
  });

  it("documents call usage for a ready wallet", () => {
    const callCommand = buildProgram().commands.find(
      (command) => command.name() === "call",
    );

    expect(callCommand?.helpInformation()).toContain("<wallet-id>");
    expect(callCommand?.helpInformation()).toContain("--to");
    expect(callCommand?.helpInformation()).toContain("--data");
  });

  it("documents typed data signing usage for a ready wallet", () => {
    const signTypedDataCommand = buildProgram().commands.find(
      (command) => command.name() === "sign-typed-data",
    );

    expect(signTypedDataCommand?.helpInformation()).toContain("<wallet-id>");
    expect(signTypedDataCommand?.helpInformation()).toContain("--typed-data-file");
    expect(signTypedDataCommand?.helpInformation()).toContain("--typed-data-json");
  });
});
