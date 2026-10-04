import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
export function sourceIdentity() {
  const paths = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter(
      (p) =>
        p &&
        !p.startsWith('docs/evidence/') &&
        !p.startsWith('docs/reviews/') &&
        !p.startsWith('docs/tasks/') &&
        p !== 'docs/PROGRESS.md' &&
        existsSync(p),
    )
    .sort();
  const hash = createHash('sha256');
  for (const path of paths) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(path));
  }
  return hash.digest('hex');
}
