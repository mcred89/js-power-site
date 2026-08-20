// Kept in its own module because CRA's Jest transform does not parse import.meta. Production
// Webpack recognizes this exact expression and emits the worker with its complete dependency graph.
export const createDataWorker = () => new Worker(new URL('./dataWorker.js', import.meta.url));
