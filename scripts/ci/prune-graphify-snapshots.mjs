#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const KEEP_COUNT = 2;
const DATE_DIRECTORY = /^(\d{4})-(\d{2})-(\d{2})$/;
const KNOWN_BACKUP_FILES = [
  'graph.json',
  'GRAPH_REPORT.md',
  '.graphify_labels.json',
  '.graphify_analysis.json',
  'manifest.json',
  '.graphify_semantic_marker',
  'cost.json',
];

function parseArgs(argv) {
  let mode = 'dry-run';
  let repoRoot = process.cwd();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      mode = 'apply';
      continue;
    }
    if (argument === '--dry-run') {
      mode = 'dry-run';
      continue;
    }
    if (argument === '--repo-root') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--repo-root requires a path');
      }
      repoRoot = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }

  return { mode, repoRoot: path.resolve(repoRoot) };
}

function normalizeGitPath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function readGitPathSet(repoRoot, args) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args.join(' ')} readback failed`);
  }
  return new Set(
    result.stdout
      .split('\0')
      .filter(Boolean)
      .map(normalizeGitPath),
  );
}

function isValidDateDirectory(name) {
  const match = DATE_DIRECTORY.exec(name);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function readJsonObject(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (value === null || typeof value !== 'object') {
    throw new Error('JSON root is not an object');
  }
  return value;
}

function relativeRepoPath(repoRoot, filePath) {
  return normalizeGitPath(path.relative(repoRoot, filePath));
}

function listRegularKnownFiles(snapshotPath) {
  return KNOWN_BACKUP_FILES.flatMap((name) => {
    const filePath = path.join(snapshotPath, name);
    try {
      if (!fs.lstatSync(filePath).isFile()) {
        return [];
      }
      return [{ name, filePath }];
    } catch {
      return [];
    }
  });
}

function buildPlan(repoRoot) {
  const graphDir = path.join(repoRoot, 'graphify-out');
  const currentGraph = path.join(graphDir, 'graph.json');
  const warnings = [];

  if (!fs.existsSync(graphDir) || !fs.lstatSync(graphDir).isDirectory()) {
    throw new Error('graphify-out is missing or is not a directory');
  }
  if (!fs.existsSync(currentGraph) || !fs.lstatSync(currentGraph).isFile()) {
    throw new Error('current graphify-out/graph.json is missing or is not a file');
  }
  try {
    readJsonObject(currentGraph);
  } catch {
    throw new Error('current graphify-out/graph.json is not valid JSON');
  }

  const tracked = readGitPathSet(repoRoot, ['ls-files', '-z']);
  const staged = readGitPathSet(repoRoot, ['diff', '--cached', '--name-only', '-z']);
  const dateDirectories = fs
    .readdirSync(graphDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isValidDateDirectory(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  const validSnapshots = [];
  for (const name of dateDirectories) {
    const snapshotPath = path.join(graphDir, name);
    const snapshotGraph = path.join(snapshotPath, 'graph.json');
    if (!fs.existsSync(snapshotGraph) || !fs.lstatSync(snapshotGraph).isFile()) {
      warnings.push(`${name}: missing graph.json; left untouched`);
      continue;
    }
    try {
      readJsonObject(snapshotGraph);
    } catch {
      warnings.push(`${name}: invalid graph.json; left untouched`);
      continue;
    }
    validSnapshots.push({ name, snapshotPath });
  }

  const keep = validSnapshots.slice(0, KEEP_COUNT);
  const pruneCandidates = validSnapshots.slice(KEEP_COUNT);
  const protectedSnapshots = [];
  const plannedFiles = [];
  const skippedFiles = [];

  for (const snapshot of pruneCandidates) {
    const files = listRegularKnownFiles(snapshot.snapshotPath);
    const protectedPaths = files.filter(({ filePath }) => {
      const relativePath = relativeRepoPath(repoRoot, filePath);
      return tracked.has(relativePath) || staged.has(relativePath);
    });
    if (protectedPaths.length > 0) {
      protectedSnapshots.push(snapshot.name);
      skippedFiles.push(
        ...protectedPaths.map(({ filePath }) => relativeRepoPath(repoRoot, filePath)),
      );
      continue;
    }
    plannedFiles.push(
      ...files.map(({ filePath }) => relativeRepoPath(repoRoot, filePath)),
    );
  }

  return {
    graphDir,
    keep: keep.map(({ name }) => name),
    pruneCandidates: pruneCandidates.map(({ name }) => name),
    protectedSnapshots,
    plannedFiles,
    skippedFiles,
    warnings,
  };
}

function applyPlan(repoRoot, plan) {
  const warnings = [...plan.warnings];
  let deletedFiles = 0;
  for (const relativePath of plan.plannedFiles) {
    const filePath = path.join(repoRoot, ...relativePath.split('/'));
    try {
      fs.unlinkSync(filePath);
      deletedFiles += 1;
    } catch {
      warnings.push(`${relativePath}: delete failed; left untouched`);
    }
  }
  return { deletedFiles, warnings };
}

function main() {
  const { mode, repoRoot } = parseArgs(process.argv.slice(2));
  const plan = buildPlan(repoRoot);
  const result = mode === 'apply'
    ? applyPlan(repoRoot, plan)
    : { deletedFiles: 0, warnings: plan.warnings };
  const status = result.warnings.length > 0 ? 'partial' : 'verified';

  console.log(
    JSON.stringify(
      {
        status,
        mode,
        repoRoot,
        graphifyOutput: 'graphify-out',
        keepCount: plan.keep.length,
        keep: plan.keep,
        pruneCandidateCount: plan.pruneCandidates.length,
        protectedSnapshotCount: plan.protectedSnapshots.length,
        protectedSnapshots: plan.protectedSnapshots,
        plannedFileCount: plan.plannedFiles.length,
        deletedFileCount: result.deletedFiles,
        skippedFileCount: plan.skippedFiles.length,
        warnings: result.warnings,
      },
      null,
      2,
    ),
  );
  if (mode === 'dry-run' && plan.plannedFiles.length > 0) {
    console.log('dry-run: no files changed');
  }
}

try {
  main();
} catch (error) {
  console.error(`[graphify snapshot prune] warning: ${error.message}`);
  process.exitCode = 2;
}
