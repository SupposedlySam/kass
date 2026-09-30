import { describe, expect, test } from 'bun:test';
import { isNewerVersion } from '../src/lib/utils/releases';

describe('update check', () => {
  test('a higher major, minor or patch is newer', () => {
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('0.6.0', '0.5.9')).toBe(true);
    expect(isNewerVersion('0.5.1', '0.5.0')).toBe(true);
  });

  test('compares numbers, not text', () => {
    expect(isNewerVersion('0.10.0', '0.9.0')).toBe(true);
    expect(isNewerVersion('0.9.0', '0.10.0')).toBe(false);
  });

  test('the same or an older release is not an update', () => {
    expect(isNewerVersion('0.5.0', '0.5.0')).toBe(false);
    expect(isNewerVersion('0.4.5', '0.5.0')).toBe(false);
  });

  test('anything but a plain version is never newer', () => {
    expect(isNewerVersion('0.6.0-beta.1', '0.5.0')).toBe(false);
    expect(isNewerVersion('latest', '0.5.0')).toBe(false);
  });
});
