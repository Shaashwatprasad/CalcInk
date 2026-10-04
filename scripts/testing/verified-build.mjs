import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { sourceIdentity } from './source-identity.mjs';
function artifactIdentity() {
  const paths = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? paths(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
    );
  const hash = createHash('sha256');
  for (const path of paths('dist').sort())
    hash.update(path).update('\0').update(readFileSync(path));
  return hash.digest('hex');
}
export function verifyBuild(path) {
  const record = JSON.parse(readFileSync(path, 'utf8'));
  if (
    record.sourceHash !== sourceIdentity() ||
    record.artifactHash !== artifactIdentity() ||
    record.exitCode !== 0
  )
    throw new Error(
      'Verified build is stale or failed; rebuild the current source',
    );
  return record;
}
if (process.argv[1]?.endsWith('/verified-build.mjs')) {
  const mode = process.argv[2],
    path = process.argv[3];
  if (!path) throw new Error('Build evidence path is required');
  if (mode === 'verify')
    process.stdout.write(JSON.stringify(verifyBuild(path)) + '\n');
  else if (mode === 'build') {
    const sourceHash = sourceIdentity(),
      startedAt = new Date().toISOString();
    const result = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
    const finalSourceHash = sourceIdentity();
    if (result.status !== 0 || sourceHash !== finalSourceHash)
      throw new Error('Build failed or source changed while building');
    writeFileSync(
      path,
      JSON.stringify(
        {
          sourceHash,
          artifactHash: artifactIdentity(),
          startedAt,
          finishedAt: new Date().toISOString(),
          exitCode: 0,
        },
        null,
        2,
      ) + '\n',
    );
  } else throw new Error('Use build or verify');
}
