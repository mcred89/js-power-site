const sortObjectKeys = (_key, value) => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort().reduce((sorted, key) => ({ ...sorted, [key]: value[key] }), {})
    : value
);

// Persisted import comparisons follow JSON semantics: object undefined values disappear,
// array holes/undefined become null, and object insertion order is irrelevant. Keep this
// shared with the atomic commit guard so preview and confirmation can never disagree.
export const serializedRecordsEqual = (left, right) => (
  JSON.stringify(left, sortObjectKeys) === JSON.stringify(right, sortObjectKeys)
);
