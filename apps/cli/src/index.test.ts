import { describe, expect, it } from "vitest";
import { buildProgram } from "./index.js";

describe("cli help", () => {
  it("lists the expected commands and backend override flag", () => {
    const help = buildProgram().helpInformation();

    expect(help).toContain("provision and manage secure wallet rails for autonomous agents");
    expect(help).toContain("create [options]                       create a wallet provisioning request");
    expect(help).toContain("status [options] <wallet-id>           inspect a wallet");
    expect(help).toContain(
      "create [options]                       create a wallet provisioning request\n  status [options] <wallet-id>           inspect a wallet",
    );
    expect(help).not.toContain(
      "create [options]                       create a wallet provisioning request\n  \n  supported chains:",
    );
    expect(help).toContain("create");
    expect(help).toContain("status");
    expect(help).toContain("await");
    expect(help).toContain("call");
    expect(help).toContain("sign-typed-data");
    expect(help).toContain("x402-sign");
    expect(help).toContain("x402-fetch");
    expect(help).toContain("--backend-url");
    expect(help).toContain("supported chains");
    expect(help).toContain("84532 (Base Sepolia)");
  });

  it("documents create usage with base sepolia and localhost", () => {
    const createCommand = buildProgram().commands.find(
      (command) => command.name() === "create",
    );
    const createHelp = createCommand?.helpInformation();

    expect(createHelp).toContain("--chain-id");
    expect(createHelp).toContain("--backend-url");
    expect(createHelp).toContain("supported chains");
    expect(createHelp).toContain("84532 (Base Sepolia)");
    expect(createHelp).toContain(
      "create a wallet provisioning request",
    );
    expect(createHelp).toContain(
      "create a wallet provisioning request\n\nsupported chains:\n  84532 (Base Sepolia)\n\nOptions:",
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

  it("documents x402 signing usage for the ready conduit wallet signer", () => {
    const x402SignCommand = buildProgram().commands.find(
      (command) => command.name() === "x402-sign",
    );

    expect(x402SignCommand?.helpInformation()).toContain("<wallet-id>");
    expect(x402SignCommand?.helpInformation()).toContain("--payment-required-header");
  });

  it("documents x402 fetch usage for protected resources", () => {
    const x402FetchCommand = buildProgram().commands.find(
      (command) => command.name() === "x402-fetch",
    );

    expect(x402FetchCommand?.helpInformation()).toContain("<wallet-id>");
    expect(x402FetchCommand?.helpInformation()).toContain("<url>");
  });
});
