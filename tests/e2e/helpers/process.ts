import { spawn, type ChildProcess } from "node:child_process";

function createCommandString(command: string, args: string[]) {
  return [command, ...args].join(" ");
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type ManagedProcess = {
  name: string;
  child: ChildProcess;
  output: {
    stdout: string;
    stderr: string;
  };
  stop(): Promise<void>;
};

export async function runCommand(input: {
  command: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}) {
  const args = input.args ?? [];
  const child = spawn(input.command, args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      resolve(code ?? 0);
    });
  });

  if (exitCode !== 0) {
    throw new Error(
      [
        `Command failed: ${createCommandString(input.command, args)}`,
        stdout.trim(),
        stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return {
    stdout,
    stderr,
  };
}

export function startProcess(input: {
  name: string;
  command: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}): ManagedProcess {
  const args = input.args ?? [];
  const child = spawn(input.command, args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = {
    stdout: "",
    stderr: "",
  };

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    output.stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    output.stderr += chunk;
  });

  child.once("error", (error) => {
    output.stderr += `${String(error)}\n`;
  });

  return {
    name: input.name,
    child,
    output,
    async stop() {
      if (child.exitCode !== null || child.killed) {
        return;
      }

      child.kill("SIGTERM");

      const exited = await Promise.race([
        new Promise<boolean>((resolve) => {
          child.once("exit", () => {
            resolve(true);
          });
        }),
        sleep(5_000).then(() => false),
      ]);

      if (!exited && child.exitCode === null) {
        child.kill("SIGKILL");
        await new Promise<void>((resolve) => {
          child.once("exit", () => {
            resolve();
          });
        });
      }
    },
  };
}

export async function pollUntil<T>(
  action: () => Promise<T>,
  input: {
    timeoutMs: number;
    intervalMs?: number;
    isReady: (value: T) => boolean;
    description: string;
  },
) {
  const startedAt = Date.now();
  const intervalMs = input.intervalMs ?? 500;
  let lastError: unknown;

  while (Date.now() - startedAt < input.timeoutMs) {
    try {
      const value = await action();

      if (input.isReady(value)) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(intervalMs);
  }

  const details =
    lastError instanceof Error ? ` Last error: ${lastError.message}` : "";

  throw new Error(
    `Timed out while waiting for ${input.description}.${details}`,
  );
}

export async function waitForHttpOk(
  url: string,
  input: {
    timeoutMs: number;
    intervalMs?: number;
  },
) {
  return pollUntil(
    async () => {
      const response = await fetch(url);
      return response.ok;
    },
    {
      timeoutMs: input.timeoutMs,
      intervalMs: input.intervalMs,
      isReady: (ready) => ready,
      description: `HTTP readiness on ${url}`,
    },
  );
}
