import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const bundle = await build({
  entryPoints: ['benchmark/corpus/schema.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { validateCorpus, canonicalJson, corpusCounts } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const [command, inputPath, outputPath] = process.argv.slice(2);
if (
  !['validate', 'freeze', 'verify'].includes(command) ||
  !inputPath ||
  (command === 'freeze' && !outputPath)
)
  throw new Error(
    'Usage: node benchmark/corpus/cli.mjs validate CORPUS | freeze CORPUS NEW_LOCK | verify LOCK',
  );
const digest = (value) => createHash('sha256').update(value).digest('hex');
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const corpus = validateCorpus(command === 'verify' ? input.corpus : input);
const hash = digest(canonicalJson(corpus));
if (command === 'verify') {
  if (
    input.format !== 'calcink-frozen-corpus' ||
    input.version !== 1 ||
    input.corpusSha256 !== hash
  )
    throw new Error('Frozen corpus integrity verification failed');
}
const counts = corpusCounts(corpus);
if (command === 'freeze') {
  if (!counts.evaluation.samples || !counts.evaluation.writers)
    throw new Error(
      'Cannot freeze an empty evaluation corpus or claim missing real ink as evidence',
    );
  await writeFile(
    outputPath,
    `${JSON.stringify({ format: 'calcink-frozen-corpus', version: 1, frozenAt: new Date().toISOString(), corpusSha256: hash, counts, corpus }, null, 2)}\n`,
    { flag: 'wx' },
  );
}
console.log(
  JSON.stringify(
    {
      status: counts.evaluation.samples
        ? 'VALID_REAL_COLLECTION'
        : 'BLOCKED_WITH_EVIDENCE',
      corpusSha256: hash,
      counts,
      warning:
        'Provenance is an annotation attestation, not automatically verified human authorship. Binomial intervals do not account for writer clustering.',
    },
    null,
    2,
  ),
);
