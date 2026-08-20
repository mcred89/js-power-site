import { serializedRecordsEqual } from './recordComparison';

describe('serialized record comparison', () => {
  it('ignores object key order and missing versus undefined properties', () => {
    const left = { id: 'r1', nested: { b: 2, omitted: undefined, a: 1 } };
    const right = { nested: { a: 1, b: 2 }, id: 'r1', missing: undefined };
    expect(serializedRecordsEqual(left, right)).toBe(true);
    expect(left.nested).toEqual({ b: 2, omitted: undefined, a: 1 });
  });

  it('treats array holes, undefined, and null equally while preserving order', () => {
    expect(serializedRecordsEqual([, undefined, null], [null, null, null])).toBe(true);
    expect(serializedRecordsEqual([1, 2], [2, 1])).toBe(false);
  });

  it('includes unknown nested fields in the comparison', () => {
    expect(serializedRecordsEqual(
      { id: 'r1', unknown: { retained: true } },
      { id: 'r1', unknown: { retained: false } },
    )).toBe(false);
  });
});
