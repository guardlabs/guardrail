import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  localWalletRequestSchema,
  type LocalWalletRequest,
} from "@agent-wallet/shared";

function resolveStoreDirectory() {
  return (
    process.env.AGENT_WALLET_LOCAL_STORE_DIR ??
    join(homedir(), ".agent-wallet", "wallets")
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
  localWalletRequestSchema.parse(request);

  const directory = await getStoreDirectory();
  const filePath = join(directory, `${request.walletId}.json`);

  await writeFile(filePath, `${JSON.stringify(request, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(filePath, 0o600);

  return filePath;
}

export async function readLocalWalletRequest(walletId: string) {
  const filePath = getWalletFilePath(walletId);
  const raw = await readFile(filePath, "utf8");
  return localWalletRequestSchema.parse(JSON.parse(raw));
}
