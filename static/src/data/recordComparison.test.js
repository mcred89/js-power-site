import { serializedRecordsEqual } from './recordComparison';

describe('serialized record comparison', () => {
  it('short-circuits with JSON-compatible undefined and array semantics', () => {
    expect(serializedRecordsEqual({ a: 1, ignored: undefined }, { a: 1 })).toBe(true);
    expect(serializedRecordsEqual([undefined, NaN], [null, null])).toBe(true);
    expect(serializedRecordsEqual([1, 2], [2, 1])).toBe(false);
  });
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

  it('matches JSON handling for dates, toJSON, functions, and symbols', () => {
    expect(serializedRecordsEqual(
      { date: new Date('2025-01-01T00:00:00.000Z'), omitted: () => true },
      { date: '2025-01-01T00:00:00.000Z', omitted: Symbol('ignored') },
    )).toBe(true);
    expect(serializedRecordsEqual([() => true, Symbol('x')], [null, null])).toBe(true);
    expect(() => serializedRecordsEqual({ value: 1n }, { value: 1n })).toThrow(TypeError);
  });

  it('unwraps boxed primitives and invokes each toJSON once', () => {
    const calls = { left: 0, right: 0 };
    const left = { boxed: new Number(3), custom: { toJSON() { calls.left += 1; return { value: 4 }; } } }; // eslint-disable-line no-new-wrappers
    const right = { boxed: 3, custom: { toJSON() { calls.right += 1; return { value: 4 }; } } };
    expect(serializedRecordsEqual(left, right)).toBe(true);
    expect(calls).toEqual({ left: 1, right: 1 });
    expect(serializedRecordsEqual([new String('x'), new Boolean(false)], ['x', false])).toBe(true); // eslint-disable-line no-new-wrappers
  });
});
