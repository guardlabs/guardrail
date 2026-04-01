import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, "..");
const combinedCoverageDir = resolve(workspaceRoot, "coverage");

const coverageProjects = [
  {
    label: "@conduit/shared",
    cwd: resolve(workspaceRoot, "packages/shared"),
    summaryPath: resolve(workspaceRoot, "packages/shared/coverage/coverage-summary.json"),
    command: ["pnpm", "--filter", "@conduit/shared", "test:coverage"],
  },
  {
    label: "@conduit/zerodev",
    cwd: resolve(workspaceRoot, "packages/zerodev"),
    summaryPath: resolve(workspaceRoot, "packages/zerodev/coverage/coverage-summary.json"),
    command: ["pnpm", "--filter", "@conduit/zerodev", "test:coverage"],
  },
  {
    label: "@conduit/backend",
    cwd: resolve(workspaceRoot, "apps/backend"),
    summaryPath: resolve(workspaceRoot, "apps/backend/coverage/coverage-summary.json"),
    command: ["pnpm", "--filter", "@conduit/backend", "test:coverage"],
  },
  {
    label: "@conduit/cli",
    cwd: resolve(workspaceRoot, "apps/cli"),
    summaryPath: resolve(workspaceRoot, "apps/cli/coverage/coverage-summary.json"),
    command: ["pnpm", "--filter", "@conduit/cli", "test:coverage"],
  },
  {
    label: "@conduit/frontend",
    cwd: resolve(workspaceRoot, "apps/frontend"),
    summaryPath: resolve(workspaceRoot, "apps/frontend/coverage/coverage-summary.json"),
    command: ["pnpm", "--filter", "@conduit/frontend", "test:coverage"],
  },
  {
    label: "@conduit/e2e",
    cwd: resolve(workspaceRoot, "tests/e2e"),
    summaryPath: resolve(workspaceRoot, "tests/e2e/coverage/coverage-summary.json"),
    setupCommand: ["pnpm", "build"],
    command: ["pnpm", "--filter", "@conduit/e2e", "test:coverage"],
  },
];

const metricKeys = ["lines", "statements", "functions", "branches"];

function runCommand(command, cwd) {
  const [file, ...args] = command;
  const result = spawnSync(file, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function formatPercent(covered, total) {
  if (total === 0) {
    return "100.00";
  }

  return ((covered / total) * 100).toFixed(2);
}

function loadSummary(summaryPath) {
  if (!existsSync(summaryPath)) {
    throw new Error(`Missing coverage summary at ${summaryPath}`);
  }

  return JSON.parse(readFileSync(summaryPath, "utf8"));
}

function buildEmptyTotals() {
  return Object.fromEntries(
    metricKeys.map((metric) => [
      metric,
      {
        total: 0,
        covered: 0,
        skipped: 0,
        pct: 100,
      },
    ]),
  );
}

rmSync(combinedCoverageDir, { force: true, recursive: true });

const perProject = [];
const aggregateTotals = buildEmptyTotals();

for (const project of coverageProjects) {
  const projectCoverageDir = resolve(project.cwd, "coverage");
  rmSync(projectCoverageDir, { force: true, recursive: true });

  if (project.setupCommand) {
    runCommand(project.setupCommand, workspaceRoot);
  }

  runCommand(project.command, workspaceRoot);

  const summary = loadSummary(project.summaryPath);
  const total = summary.total;

  perProject.push({
    name: project.label,
    coverage: Object.fromEntries(
      metricKeys.map((metric) => {
        const stats = total[metric];

        return [
          metric,
          {
            total: stats.total,
            covered: stats.covered,
            skipped: stats.skipped,
            pct: Number(formatPercent(stats.covered, stats.total)),
          },
        ];
      }),
    ),
    summaryPath: project.summaryPath,
  });

  for (const metric of metricKeys) {
    aggregateTotals[metric].total += total[metric].total;
    aggregateTotals[metric].covered += total[metric].covered;
    aggregateTotals[metric].skipped += total[metric].skipped;
  }
}

for (const metric of metricKeys) {
  aggregateTotals[metric].pct = Number(
    formatPercent(aggregateTotals[metric].covered, aggregateTotals[metric].total),
  );
}

mkdirSync(combinedCoverageDir, { recursive: true });

const combinedSummary = {
  generatedAt: new Date().toISOString(),
  total: aggregateTotals,
  projects: perProject,
};

writeFileSync(
  resolve(combinedCoverageDir, "combined-summary.json"),
  `${JSON.stringify(combinedSummary, null, 2)}\n`,
);

console.log("\nCombined coverage");
for (const metric of metricKeys) {
  const stats = aggregateTotals[metric];
  console.log(
    `${metric.padEnd(10)} ${String(stats.pct).padStart(6)}% (${stats.covered}/${stats.total})`,
  );
}

console.log(`\nWrote ${resolve(combinedCoverageDir, "combined-summary.json")}`);
