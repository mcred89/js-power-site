const OMIT = {};

// Prepare each visited value exactly once, matching JSON.stringify without constructing a
// canonical copy. This matters for stateful toJSON methods and boxed primitive records.
const prepare = (value, key, inArray) => {
  let result = value;
  if (result && typeof result === 'object' && typeof result.toJSON === 'function') {
    result = result.toJSON(key);
  } else if (result instanceof Number || result instanceof String || result instanceof Boolean) {
    result = result.valueOf();
  }
  if (typeof result === 'bigint') throw new TypeError('Do not know how to serialize a BigInt');
  if (result === undefined || typeof result === 'function' || typeof result === 'symbol') {
    return inArray ? null : OMIT;
  }
  return typeof result === 'number' && !Number.isFinite(result) ? null : result;
};

export const serializedRecordsEqual = (left, right) => {
  const comparePrepared = (a, b) => {
    if (a === b) return true;
    if (a === OMIT || b === OMIT || a === null || b === null ||
        typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (let index = 0; index < a.length; index += 1) {
        const key = String(index);
        if (!comparePrepared(prepare(a[index], key, true), prepare(b[index], key, true))) return false;
      }
      return true;
    }
    const entries = object => Object.keys(object).map(key => [key, prepare(object[key], key, false)])
      .filter(([, value]) => value !== OMIT);
    const aEntries = entries(a);
    const bEntries = new Map(entries(b));
    if (aEntries.length !== bEntries.size) return false;
    for (const [key, value] of aEntries) {
      if (!bEntries.has(key) || !comparePrepared(value, bEntries.get(key))) return false;
    }
    return true;
  };
  return comparePrepared(prepare(left, '', false), prepare(right, '', false));
};
