import { describe, expect, test } from 'bun:test';
import { carryOverRenamedStorage } from '../src/lib/utils/renamedStorage';

function memoryStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}

describe('renamed storage', () => {
  test('voicebox keys move to their herga names', () => {
    const storage = memoryStorage({ 'voicebox.onboarding': '{"step":"download"}', other: 'x' });
    carryOverRenamedStorage(storage);
    expect(storage.getItem('herga.onboarding')).toBe('{"step":"download"}');
    expect(storage.getItem('voicebox.onboarding')).toBeNull();
    expect(storage.getItem('other')).toBe('x');
  });

  test('the UI store keeps its theme', () => {
    const storage = memoryStorage({ 'voicebox-ui': '{"state":{"theme":"dark"}}' });
    carryOverRenamedStorage(storage);
    expect(storage.getItem('herga-ui')).toBe('{"state":{"theme":"dark"}}');
    expect(storage.length).toBe(1);
  });

  test('a value already under the new name wins', () => {
    const storage = memoryStorage({ 'voicebox.setup.open': '1', 'herga.setup.open': '0' });
    carryOverRenamedStorage(storage);
    expect(storage.getItem('herga.setup.open')).toBe('0');
    expect(storage.length).toBe(1);
  });
});
