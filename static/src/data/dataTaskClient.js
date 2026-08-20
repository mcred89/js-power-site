import { runDataTask } from './dataTaskHandlers';
import { createDataWorker } from './dataWorkerFactory';

const abortError = () => Object.assign(new Error('Data task was cancelled.'), { name: 'AbortError' });

export const createDataTaskClient = (createWorker = createDataWorker) => {
  let worker = null;
  let nextId = 1;
  let stopped = false;
  const pending = new Map();

  const fallback = request => Promise.resolve()
    .then(() => runDataTask(request.type, request.payload))
    .then(result => { if (!request.cancelled) request.resolve(result); }, error => {
      if (!request.cancelled) request.reject(error);
    }).finally(() => pending.delete(request.id));

  const abandonWorker = replay => {
    const failedWorker = worker;
    worker = null;
    if (failedWorker) failedWorker.terminate();
    const requests = [...pending.values()];
    requests.forEach(request => {
      if (request.cancelled) return;
      if (replay) { request.replaying = true; fallback(request); }
      else {
        pending.delete(request.id);
        request.cancelled = true;
        request.reject(abortError());
      }
    });
  };

  try {
    worker = createWorker();
    worker.onmessage = event => {
      const request = pending.get(event.data && event.data.id);
      if (!request || request.cancelled) return;
      if (Object.prototype.hasOwnProperty.call(event.data, 'chunk')) {
        request.chunks.push(event.data.chunk);
        return;
      }
      pending.delete(event.data.id);
      if (event.data.error) {
        const error = new Error(event.data.error.message);
        error.name = event.data.error.name;
        request.reject(error);
      } else request.resolve(event.data.complete ? request.chunks : event.data.result);
    };
    // A load/runtime failure can be retried synchronously; malformed worker messages cannot
    // safely be associated with a request, so use the same deterministic fallback replay.
    worker.onerror = () => abandonWorker(true);
    worker.onmessageerror = () => abandonWorker(true);
  } catch (error) {
    worker = null;
  }

  return {
    run(type, payload) {
      if (stopped) return Promise.reject(abortError());
      if (!worker) return Promise.resolve().then(() => runDataTask(type, payload));
      const id = nextId++;
      let request;
      const promise = new Promise((resolve, reject) => {
        request = { id, resolve, reject, type, payload, chunks: [], cancelled: false };
        pending.set(id, request);
        try {
          worker.postMessage({ id, type, payload });
        } catch (error) {
          pending.delete(id);
          request.cancelled = true;
          reject(error);
        }
      });
      promise.cancel = () => {
        if (!pending.delete(id)) return;
        request.cancelled = true;
        request.reject(abortError());
      };
      return promise;
    },
    terminate() {
      stopped = true;
      abandonWorker(false);
    },
  };
};

let sharedClient;
export const runDataTaskInBackground = (type, payload) => {
  if (!sharedClient) sharedClient = createDataTaskClient();
  return sharedClient.run(type, payload);
};

export const cancelBackgroundDataTasks = () => {
  if (sharedClient) sharedClient.terminate();
  sharedClient = null;
};
