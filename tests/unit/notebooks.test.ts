import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { InkStore } from '../../src/document/InkStore';
import { openNotebookLibrary } from '../../src/persistence/notebooks';
it('keeps named notebook snapshots isolated, orders saves and restores active selection', async () => {
  const lib = await openNotebookLibrary(),
    first = new InkStore(),
    second = new InkStore();
  const a = {
      id: 'first',
      name: 'First notebook',
      document: first.getSnapshot(),
    },
    b = {
      id: 'second',
      name: 'Second notebook',
      document: second.getSnapshot(),
    };
  await Promise.all([lib.save(a, true), lib.save(b, true)]);
  expect(await lib.active()).toBe('second');
  let rows = await lib.list();
  expect(rows).toHaveLength(2);
  expect(rows.find((r) => r.id === 'first')?.document.documentId).not.toBe(
    rows.find((r) => r.id === 'second')?.document.documentId,
  );
  await lib.save({ ...a, name: 'Renamed' }, true);
  expect(await lib.active()).toBe('first');
  rows = await lib.list();
  expect(rows.find((r) => r.id === 'first')?.name).toBe('Renamed');
  await expect(lib.save({ ...b, name: ' ' })).rejects.toThrow('name');
  expect(await lib.active()).toBe('first');
  await lib.remove('second');
  expect(await lib.list()).toHaveLength(1);
  lib.close();
});
