import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
const [capturePath, annotationPath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw new Error(
    'Usage: node scripts/benchmark/capture/import.mjs CAPTURE_OR_NOTEBOOK ANNOTATION NEW_CORPUS',
  );
const capture = JSON.parse(await readFile(capturePath, 'utf8'));
const annotation = JSON.parse(await readFile(annotationPath, 'utf8'));
const bundle = await build({
  entryPoints: ['scripts/benchmark/corpus/schema.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { validateCorpus } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const sample = {
  ...annotation,
  ...(capture.format === 'calcink-vector-capture'
    ? { capturedAt: capture.capturedAt, input: capture.input }
    : {}),
  document: capture.document ?? capture,
};
const corpus = validateCorpus({
  format: 'calcink-labelled-corpus',
  version: 1,
  corpusId: annotation.corpusId ?? sample.id,
  notes:
    'Human ink import; provenance and labels supplied by the annotator. Import is not verification of human authorship.',
  samples: [sample],
});
await writeFile(outputPath, `${JSON.stringify(corpus, null, 2)}\n`, {
  flag: 'wx',
});
console.log(
  `Validated annotated import saved to ${outputPath}; original capture preserved.`,
);
