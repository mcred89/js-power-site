import { DATA_TASKS, runDataTask, streamDataTask } from './dataTaskHandlers';

const workerScope = self; // eslint-disable-line no-restricted-globals

workerScope.onmessage = async event => {
  const { id, type, payload } = event.data;
  try {
    if (type === DATA_TASKS.PLAN_CSV || type === DATA_TASKS.HISTORY_CSV) {
      // Emit while iterating: large histories must never exist as a rows array or a complete
      // CSV string in worker memory.
      streamDataTask(type, payload, chunk => workerScope.postMessage({ id, chunk }));
      workerScope.postMessage({ id, complete: true });
    } else {
      const result = await runDataTask(type, payload);
      workerScope.postMessage({ id, result });
    }
  } catch (error) {
    workerScope.postMessage({ id, error: { name: error.name, message: error.message } });
  }
};
