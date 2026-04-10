import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  localWalletRequestSchema,
  type LocalWalletRequest,
} from "@guardlabs/guardrail-core";

function resolveStoreDirectory() {
  return (
    process.env.GUARDRAIL_LOCAL_STORE_DIR ??
    join(homedir(), ".guardrail", "wallets")
  );
}

export async function getStoreDirectory() {
  const directory = resolveStoreDirectory();
  await mkdir(directory, {
    recursive: true,
    mode: 0o700,
  });

  return directory;
}

function getWalletFilePath(walletId: string) {
  return join(resolveStoreDirectory(), `${walletId}.json`);
}

export async function saveLocalWalletRequest(request: LocalWalletRequest) {
  const normalizedRequest = localWalletRequestSchema.parse(request);

  const directory = await getStoreDirectory();
  const filePath = join(directory, `${normalizedRequest.walletId}.json`);

  await writeFile(filePath, `${JSON.stringify(normalizedRequest, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(filePath, 0o600);

  return filePath;
}

export async function readLocalWalletRequest(walletId: string) {
  const filePath = getWalletFilePath(walletId);
  const raw = await readFile(filePath, "utf8");

  try {
    return localWalletRequestSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error(
      `Local wallet file ${filePath} is not a supported mode-B wallet. Delete it and recreate the wallet request.`,
    );
  }
}
