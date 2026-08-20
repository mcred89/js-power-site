jest.mock('./dataWorkerFactory', () => ({ createDataWorker: jest.fn() }));

import { createDataTaskClient } from './dataTaskClient';
import { DATA_TASKS, runDataTask } from './dataTaskHandlers';

class FakeWorker {
  postMessage(message) {
    Promise.resolve(runDataTask(message.type, message.payload)).then(result => {
      this.onmessage({ data: { id: message.id, result } });
    });
  }
  terminate() {}
}

describe('data task client', () => {
  it('has worker and fallback parity', async () => {
    const payload = { format: 'test', nested: { value: 1 } };
    const worker = createDataTaskClient(() => new FakeWorker());
    const fallback = createDataTaskClient(() => { throw new Error('workers unavailable'); });
    await expect(worker.run(DATA_TASKS.SERIALIZE_TRANSFER, payload))
      .resolves.toBe(await fallback.run(DATA_TASKS.SERIALIZE_TRANSFER, payload));
  });

  it('rejects abandoned requests', async () => {
    const client = createDataTaskClient(() => ({ postMessage() {}, terminate() {} }));
    const pending = client.run(DATA_TASKS.SERIALIZE_TRANSFER, {});
    client.terminate();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('cleans up clone failures and ignores late results after cancellation', async () => {
    const worker = { postMessage: jest.fn(() => { throw new DOMException('clone', 'DataCloneError'); }), terminate: jest.fn() };
    const client = createDataTaskClient(() => worker);
    await expect(client.run(DATA_TASKS.SERIALIZE_TRANSFER, { bad: () => {} }))
      .rejects.toMatchObject({ name: 'DataCloneError' });

    worker.postMessage.mockImplementation(() => {});
    const task = client.run(DATA_TASKS.SERIALIZE_TRANSFER, {});
    task.cancel();
    worker.onmessage({ data: { id: 2, result: 'late' } });
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('replays pending work after a message decoding failure', async () => {
    const worker = { postMessage() {}, terminate: jest.fn() };
    const client = createDataTaskClient(() => worker);
    const task = client.run(DATA_TASKS.SERIALIZE_TRANSFER, { value: 1 });
    worker.onmessageerror();
    await expect(task).resolves.toBe('{"value":1}');
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('rejects replay work when terminated before fallback executes', async () => {
    const worker = { postMessage() {}, terminate: jest.fn() };
    const client = createDataTaskClient(() => worker);
    const task = client.run(DATA_TASKS.SERIALIZE_TRANSFER, { value: 1 });
    worker.onerror();
    client.terminate();
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  });
});
