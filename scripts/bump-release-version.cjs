const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function getExistingTagOnHead() {
  try {
    const tags = runGit(['tag', '--points-at', 'HEAD', '--list', 'v*'])
      .split(/\r?\n/)
      .map(tag => tag.trim())
      .filter(Boolean);
    return tags[0] || '';
  } catch {
    return '';
  }
}

function getLatestVersionTag() {
  try {
    const tags = runGit(['tag', '--list', 'v*', '--sort=-version:refname'])
      .split(/\r?\n/)
      .map(tag => tag.trim())
      .filter(Boolean);
    return tags[0] || '';
  } catch {
    return '';
  }
}

function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return `${major}.${minor}.${patch + 1}`;
}

const pkgPath = path.join(process.cwd(), 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const existingTag = getExistingTagOnHead();
const latestTag = getLatestVersionTag();

const version = existingTag
  ? existingTag.replace(/^v/, '')
  : bumpPatch((latestTag || pkg.version).replace(/^v/, ''));

pkg.version = version;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

process.stdout.write(
  `${JSON.stringify({
    version,
    tag: `v${version}`,
    existingTag: Boolean(existingTag),
  })}\n`,
);
