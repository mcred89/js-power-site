import { createPairingReader, createQrPeer, encodePairing } from './qrPeer';

const originalCrypto = global.crypto;
const originalEncoder = global.TextEncoder;
const originalDecoder = global.TextDecoder;
beforeAll(() => {
  const { TextEncoder, TextDecoder } = require('util');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
  Object.defineProperty(global, 'crypto', { configurable: true, value: require('crypto').webcrypto });
});
afterAll(() => {
  global.TextEncoder = originalEncoder;
  global.TextDecoder = originalDecoder;
  Object.defineProperty(global, 'crypto', { configurable: true, value: originalCrypto });
});

const session = 'a'.repeat(32);
const description = { type: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 12:34\r\n' };

describe('QR pairing', () => {
  it('round trips connection details without including workout data', () => {
    const pages = encodePairing(description, session);
    const read = createPairingReader('offer');
    expect(read(pages[0])).toEqual({ received: 1, count: 1, description, session });
  });

  it('collects multiple pages out of order and ignores duplicate scans', () => {
    const sdp = `v=0\r\n${Array.from({ length: 500 }, (_, i) => `${i}:${Math.sin(i)}`).join('\r\n')}`;
    const pages = encodePairing({ type: 'offer', sdp }, session);
    expect(pages.length).toBeGreaterThan(1);
    const read = createPairingReader('offer');
    expect(read(pages[pages.length - 1]).received).toBe(1);
    expect(read(pages[pages.length - 1]).received).toBe(1);
    let result;
    pages.slice(0, -1).reverse().forEach(page => { result = read(page); });
    expect(result.description.sdp).toBe(sdp);
  });

  it('rejects wrong-direction, wrong-session, malformed, and oversized codes', () => {
    const page = encodePairing(description, session)[0];
    expect(() => createPairingReader('answer')(page)).toThrow('matching code');
    expect(() => createPairingReader('offer', 'b'.repeat(32))(page)).toThrow('matching code');
    expect(() => createPairingReader('offer')('https://example.com')).toThrow();
    expect(() => createPairingReader('offer')('a'.repeat(901))).toThrow();
    expect(() => createPairingReader('offer')(page.replace(':0:1:', ':0:99:'))).toThrow();
  });

  it('rejects decompression bombs and invalid session descriptions', () => {
    const tooLarge = encodePairing({ type: 'offer', sdp: `v=0${'a'.repeat(100000)}` }, session);
    expect(() => createPairingReader('offer')(tooLarge[0])).toThrow('too large');
    const invalid = encodePairing({ type: 'offer', sdp: 'not SDP' }, session);
    expect(() => createPairingReader('offer')(invalid[0])).toThrow('Invalid pairing');
  });
});

describe('device data transport', () => {
  let connection;
  let channel;
  let options;
  const original = globalThis.RTCPeerConnection;
  beforeEach(() => {
    jest.useFakeTimers();
    channel = { label: 'mcilroy-transfer', readyState: 'open', bufferedAmount: 0, send: jest.fn(), close: jest.fn() };
    connection = { createDataChannel: () => channel, close: jest.fn() };
    globalThis.RTCPeerConnection = jest.fn(() => connection);
    options = { sending: false, onStatus: jest.fn(), onReceive: jest.fn(), onError: jest.fn() };
  });
  afterEach(() => { globalThis.RTCPeerConnection = original; jest.useRealTimers(); });
  const receiveChannel = () => connection.ondatachannel({ channel });
  const message = data => channel.onmessage({ data });

  it('receives all chunks before acknowledging, without writing local records', async () => {
    const transfer = createQrPeer(options);
    expect(globalThis.RTCPeerConnection).toHaveBeenCalledWith({ iceServers: [] });
    receiveChannel();
    await message(JSON.stringify({ type: 'start', size: 6 }));
    await message('abc');
    expect(options.onReceive).not.toHaveBeenCalled();
    await message('def');
    await message(JSON.stringify({ type: 'end' }));
    expect(options.onReceive).toHaveBeenCalledWith('abcdef');
    expect(channel.send).toHaveBeenCalledWith(JSON.stringify({ type: 'received' }));
    transfer.close();
  });

  it('rejects oversized transfers and closes the connection', async () => {
    createQrPeer(options);
    receiveChannel();
    await message(JSON.stringify({ type: 'start', size: 33 * 1024 * 1024 }));
    expect(options.onError).toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalled();
    expect(options.onReceive).not.toHaveBeenCalled();
  });

  it('bounds outgoing messages and waits for the receiving device acknowledgement', async () => {
    const transfer = createQrPeer({ ...options, sending: true });
    await transfer.send('x'.repeat(50000));
    expect(channel.send.mock.calls.every(([data]) => data.length <= 16000)).toBe(true);
    expect(options.onStatus).not.toHaveBeenCalledWith('sent');
    await message(JSON.stringify({ type: 'received' }));
    expect(options.onStatus).toHaveBeenCalledWith('sent');
    transfer.close();
  });

  it('expires abandoned pairing', () => {
    createQrPeer(options);
    jest.advanceTimersByTime(5 * 60 * 1000);
    expect(options.onError.mock.calls[0][0].message).toContain('expired');
    expect(connection.close).toHaveBeenCalled();
  });

  it('discards partial data after a disconnect', async () => {
    createQrPeer(options);
    receiveChannel();
    await message(JSON.stringify({ type: 'start', size: 6 }));
    await message('abc');
    channel.onclose();
    expect(options.onReceive).not.toHaveBeenCalled();
    expect(options.onError.mock.calls[0][0].message).toContain('before transfer finished');
  });

  it('cancels pending network gathering without leaving timers running', async () => {
    connection.createOffer = jest.fn().mockResolvedValue(description);
    connection.setLocalDescription = jest.fn().mockResolvedValue(undefined);
    connection.addEventListener = jest.fn();
    connection.removeEventListener = jest.fn();
    connection.iceGatheringState = 'gathering';
    const transfer = createQrPeer({ ...options, sending: true });
    const offer = transfer.offer();
    await Promise.resolve();
    await Promise.resolve();
    transfer.close();
    await expect(offer).rejects.toThrow('cancelled');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('times out a connection after the reply has been accepted', async () => {
    connection.setRemoteDescription = jest.fn().mockResolvedValue(undefined);
    channel.readyState = 'connecting';
    const transfer = createQrPeer({ ...options, sending: true });
    await transfer.accept({ type: 'answer', sdp: 'v=0' });
    jest.advanceTimersByTime(30000);
    expect(options.onError.mock.calls[0][0].message).toContain('Could not connect');
    expect(connection.close).toHaveBeenCalled();
  });
});
