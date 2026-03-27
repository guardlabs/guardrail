import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config as loadDotenvFile } from "dotenv";

function normalizeStartDirectory(startDirectory?: string) {
  return resolve(startDirectory ?? process.cwd());
}

function findEnvFile(fileName: string, startDirectory?: string) {
  let currentDirectory = normalizeStartDirectory(startDirectory);

  while (true) {
    const candidate = join(currentDirectory, fileName);

    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
}

export function loadEnvFiles(startDirectory?: string) {
  const loadedFiles: string[] = [];

  for (const fileName of [".env.local", ".env"]) {
    const filePath = findEnvFile(fileName, startDirectory);

    if (!filePath) {
      continue;
    }

    loadDotenvFile({
      path: filePath,
      override: false,
    });
    loadedFiles.push(filePath);
  }

  return loadedFiles;
}
