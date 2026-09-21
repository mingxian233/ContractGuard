import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const skippedDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage', '.test-dist']);
const markdownFiles = await findMarkdownFiles(projectRoot);
const failures = [];
let checkedLinks = 0;

for (const file of markdownFiles) {
  const source = await readFile(file, 'utf8');
  for (const target of markdownTargets(source)) {
    if (isExternalOrAnchor(target)) continue;
    checkedLinks += 1;
    const pathPart = stripFragmentAndQuery(target);
    if (!pathPart) continue;
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(pathPart);
    } catch {
      failures.push(`${relativeToRoot(file)} -> invalid URL encoding: ${target}`);
      continue;
    }
    const destination = resolve(dirname(file), decodedPath);
    try {
      await access(destination);
    } catch {
      failures.push(`${relativeToRoot(file)} -> missing: ${target}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`Documentation link check failed (${failures.length}):\n${failures.map((item) => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Documentation links OK: ${markdownFiles.length} files, ${checkedLinks} local links.\n`);
}

async function findMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await findMarkdownFiles(fullPath));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') results.push(fullPath);
  }
  return results;
}

function markdownTargets(source) {
  const targets = [];
  const linkPattern = /!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g;
  for (const match of source.matchAll(linkPattern)) targets.push(match[1].replace(/^<|>$/g, ''));
  return targets;
}

function isExternalOrAnchor(target) {
  return target.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//');
}

function stripFragmentAndQuery(target) {
  return target.split('#', 1)[0].split('?', 1)[0];
}

function relativeToRoot(path) {
  return path.slice(projectRoot.length + 1).replaceAll('\\', '/');
}
