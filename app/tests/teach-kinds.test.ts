import { describe, expect, test } from 'bun:test';
import {
  chipKey,
  groupKinds,
  TEACH_KINDS,
  visibleChips,
} from '../src/components/WritingStyle/teach/kinds';

describe('kinds of conversation', () => {
  test("the style's own kinds come first, in catalog order", () => {
    const { own, other } = groupKinds(['email', 'coding_agent']);
    expect(own).toEqual(['coding_agent', 'email']);
    expect(other).toEqual(TEACH_KINDS.filter((kind) => !own.includes(kind)));
  });

  test('with no kinds of its own, every kind is listed once', () => {
    expect(groupKinds([])).toEqual({ own: [], other: TEACH_KINDS });
  });
});

describe('picked-up chips', () => {
  const chips = ['a', 'b', 'c', 'd', 'e'].map((code) => ({ code, value: null }));

  test('a collapsed row shows the limit and counts the rest', () => {
    expect(visibleChips(chips, 3, false)).toEqual({ shown: chips.slice(0, 3), hidden: 2 });
  });

  test('expanded, or short enough, shows them all', () => {
    expect(visibleChips(chips, 3, true)).toEqual({ shown: chips, hidden: 0 });
    expect(visibleChips(chips.slice(0, 2), 3, false)).toEqual({
      shown: chips.slice(0, 2),
      hidden: 0,
    });
  });

  test('keys tell chips with the same code apart by value', () => {
    expect(chipKey({ code: 'term', value: 'Zed' })).not.toBe(
      chipKey({ code: 'term', value: 'Qwen' }),
    );
  });
});
