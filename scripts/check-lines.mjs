// Count physical lines, including comments and blank lines, in first-party code and configuration.
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const maximum = 500;
const extensions = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.html', '.css', '.svg', '.sh', '.ps1', '.nsh', '.json', '.yaml', '.yml',
]);
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'out']);
const lockfiles = new Set(['pnpm-lock.yaml', 'package-lock.json']);
const violations = [];
let checked = 0;

/** A file's physical lines. A final newline terminates a line; an empty file has zero. */
function lineCount(path) {
  const lines = readFileSync(path, 'utf8').split(/\r\n|[\n\r]/);
  if (lines.at(-1) === '') lines.pop();
  return lines.length;
}

function checkDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) checkDirectory(path);
      continue;
    }
    if (!entry.isFile() || !extensions.has(extname(path)) || lockfiles.has(entry.name)) continue;

    const lines = lineCount(path);
    checked++;
    if (lines > maximum) violations.push(`${relative(root, path)} (${lines} lines)`);
  }
}

checkDirectory(root);
// The README is the one document besides AGENTS.md: at most 50 lines.
const readmeMaximum = 50;
const readmeLines = lineCount(join(root, 'README.md'));
if (readmeLines > readmeMaximum) violations.push(`README.md (${readmeLines} lines; it keeps to ${readmeMaximum})`);
if (violations.length) {
  console.error(`Over the line limits (${maximum} a handwritten file, ${readmeMaximum} the README):\n${violations.sort().join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Checked ${checked} handwritten files against the ${maximum}-line limit, and the README against ${readmeMaximum}.`);
}
