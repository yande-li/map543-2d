import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const changelogPath = resolve(rootDir, 'CHANGELOG.md');
const SKIP_RE = /^(release\b|chore\(release\):)/i;
const CONVENTIONAL_RE = /^([a-z]+)(?:\([^)]+\))?:\s*(.+)$/i;
const TYPE_TO_SECTION = {
  feat: 'Features',
  fix: 'Fixed',
  perf: 'Optimizations & Build',
  build: 'Optimizations & Build',
  ci: 'Optimizations & Build',
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const rawVersion = args.find((a) => !a.startsWith('-'));
const version = rawVersion ? rawVersion.replace(/^v/, '') : 'Unreleased';

const git = (cmdArgs) =>
  execFileSync('git', cmdArgs, { cwd: rootDir, encoding: 'utf8' }).trim();

let lastTag = '';
try {
  lastTag = git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*']);
} catch {
  // No prior tag; include full history
}

const logOutput = git([
  'log',
  lastTag ? `${lastTag}..HEAD` : 'HEAD',
  '--pretty=format:%s',
]);
const subjects = logOutput ? logOutput.split(/\r?\n/).filter(Boolean) : [];

const sections = {
  Features: [],
  Fixed: [],
  'Optimizations & Build': [],
  Changed: [],
};

for (const subject of subjects) {
  if (SKIP_RE.test(subject)) continue;
  const match = subject.match(CONVENTIONAL_RE);
  const type = match ? match[1].toLowerCase() : '';
  const text = match ? match[2].trim() : subject.replace(/^-\s*/, '').trim();
  const section = TYPE_TO_SECTION[type] ?? 'Changed';
  sections[section].push(`- ${text.charAt(0).toUpperCase()}${text.slice(1)}`);
}

const bodyParts = Object.entries(sections)
  .filter(([, items]) => items.length > 0)
  .map(([title, items]) => `### ${title}\n\n${items.join('\n')}`);

if (bodyParts.length === 0) {
  console.log(`[changelog] No commits found since ${lastTag || 'start'}.`);
  process.exit(0);
}

const heading =
  version === 'Unreleased'
    ? '## [Unreleased]'
    : `## [${version}] - ${new Date().toISOString().slice(0, 10)}`;
const entry = `${heading}\n\n${bodyParts.join('\n\n')}`;

if (dryRun) {
  console.log(entry);
  process.exit(0);
}

const existing = readFileSync(changelogPath, 'utf8');
if (version !== 'Unreleased' && existing.includes(`## [${version}]`)) {
  console.error(`[changelog] Section ## [${version}] already exists.`);
  process.exit(1);
}

const headerMatch = existing.match(/^#\s+Changelog\r?\n+/i);
const insertAt = headerMatch ? headerMatch[0].length : 0;
const updated =
  existing.slice(0, insertAt) + entry + '\n\n' + existing.slice(insertAt);

writeFileSync(changelogPath, updated.replace(/\n{3,}/g, '\n\n'));
console.log(
  `[changelog] Prepended ${heading} (${subjects.length} commits since ${lastTag || 'start'}).`
);
