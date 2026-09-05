import { deflate, Inflate } from 'pako';

const PREFIX = 'MMQR1';
const MAX_SIZE = 32 * 1024 * 1024;
const CHUNK_SIZE = 16000;

export const encodePairing = (description, session) => {
  const bytes = deflate(JSON.stringify({ session, type: description.type, sdp: description.sdp }));
  const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  const count = Math.ceil(encoded.length / 700);
  if (count > 24) throw new Error('Too many network addresses. Disconnect extra networks and try again.');
  return Array.from({ length: count }, (_, index) => `${PREFIX}:${session}:${description.type}:${index}:${count}:${encoded.slice(index * 700, (index + 1) * 700)}`);
};

// Collect QR pages in any order, but never mix sessions or offer/answer pages.
export const createPairingReader = (expectedType, expectedSession) => {
  let identity;
  const pages = new Map();
  return value => {
    if (typeof value !== 'string' || value.length > 900) throw new Error('This is not a device pairing code.');
    const [prefix, session, type, indexText, countText, data, extra] = value.split(':');
    const index = Number(indexText);
    const count = Number(countText);
    if (prefix !== PREFIX || !/^[a-f0-9]{32}$/.test(session) || type !== expectedType ||
        (expectedSession && session !== expectedSession) || extra !== undefined ||
        !Number.isInteger(count) || count < 1 || count > 24 || !Number.isInteger(index) || index < 0 || index >= count ||
        !/^[A-Za-z0-9+/=]{1,700}$/.test(data)) throw new Error('Scan the matching code from the other device.');
    const nextIdentity = `${session}:${type}:${count}`;
    if (identity && identity !== nextIdentity) throw new Error('These codes belong to different transfers. Start again.');
    identity = nextIdentity;
    pages.set(index, data);
    if (pages.size !== count) return { received: pages.size, count };
    const packed = Array.from({ length: count }, (_, page) => pages.get(page)).join('');
    // Bound decompression before parsing untrusted camera input.
    const decoder = new Inflate({ chunkSize: 16384 });
    const textDecoder = new TextDecoder();
    let decoded = '';
    decoder.onData = chunk => {
      decoded += textDecoder.decode(chunk, { stream: true });
      if (decoded.length > 64000) throw new Error('Pairing code is too large.');
    };
    decoder.push(Uint8Array.from(atob(packed), char => char.charCodeAt(0)), true);
    decoded += textDecoder.decode();
    if (decoder.err) throw new Error('Pairing code is damaged. Start again.');
    const result = JSON.parse(decoded);
    if (result.session !== session || result.type !== type || typeof result.sdp !== 'string' || !result.sdp.startsWith('v=0')) {
      throw new Error('Invalid pairing details.');
    }
    return { received: count, count, description: { type, sdp: result.sdp }, session };
  };
};

export const createQrPeer = ({ sending, onStatus, onReceive, onError }) => {
  if (typeof RTCPeerConnection === 'undefined') throw new Error('This browser does not support device transfers. Use a full backup instead.');
  // Deliberately no signaling, STUN, or TURN services: pairing and connectivity stay local.
  const peer = new RTCPeerConnection({ iceServers: [] });
  const session = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  let channel;
  let closed = false;
  let finished = false;
  let receiving = false;
  let sent = false;
  let expected = 0;
  let size = 0;
  let chunks = [];
  let connectionTimer;
  let cancelGather;
  const lifetime = setTimeout(() => fail('Pairing expired. Start again on both devices.'), 5 * 60 * 1000);
  const close = () => {
    closed = true;
    clearTimeout(lifetime);
    clearTimeout(connectionTimer);
    cancelGather?.();
    channel?.close();
    peer.close();
    chunks = [];
  };
  const fail = message => {
    if (closed || finished) return;
    close();
    onError(new Error(message));
  };
  const connectChannel = value => {
    if (channel || value.label !== 'mcilroy-transfer') { value.close(); return; }
    channel = value;
    channel.onopen = () => {
      clearTimeout(connectionTimer);
      onStatus('connected');
    };
    channel.onclose = () => fail('Connection closed before transfer finished. Keep both apps open and try again.');
    channel.onerror = () => fail('Transfer failed. Try again on the same Wi-Fi.');
    channel.onmessage = async event => {
      try {
        if (closed || finished) return;
        if (typeof event.data !== 'string' || event.data.length > CHUNK_SIZE + 100) throw new Error('Invalid transfer message.');
        if (receiving && size < expected) {
          size += event.data.length;
          if (size > expected) throw new Error('Transfer exceeded its declared size.');
          chunks.push(event.data);
          onStatus(`Receiving ${Math.round(size / expected * 100)}%`);
          return;
        }
        const message = JSON.parse(event.data);
        if (sending && sent && message.type === 'received') {
          finished = true;
          clearTimeout(lifetime);
          onStatus('sent');
        } else if (!sending && !receiving && message.type === 'start' && Number.isInteger(message.size) && message.size > 0 && message.size <= MAX_SIZE) {
          expected = message.size;
          receiving = true;
          onStatus('Receiving…');
        } else if (!sending && receiving && size === expected && message.type === 'end') {
          const contents = chunks.join('');
          chunks = [];
          // Acknowledge complete transport receipt; the user still reviews the import.
          channel.send(JSON.stringify({ type: 'received' }));
          finished = true;
          clearTimeout(lifetime);
          onStatus('received');
          await onReceive(contents);
        } else throw new Error('Invalid or incomplete transfer.');
      } catch (error) { fail(error.message); }
    };
  };
  if (sending) connectChannel(peer.createDataChannel('mcilroy-transfer'));
  else peer.ondatachannel = event => connectChannel(event.channel);
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'failed') fail('Could not connect. Use the same Wi-Fi without guest isolation, or restore a full backup.');
  };
  const gather = async description => {
    if (closed) throw new Error('Transfer cancelled.');
    await peer.setLocalDescription(description);
    if (closed) throw new Error('Transfer cancelled.');
    await new Promise((resolve, reject) => {
      if (peer.iceGatheringState === 'complete') { resolve(); return; }
      const timer = setTimeout(() => {
        peer.removeEventListener('icegatheringstatechange', changed);
        cancelGather = undefined;
        reject(new Error('Network discovery timed out. Start again.'));
      }, 15000);
      const changed = () => {
        if (peer.iceGatheringState === 'complete' || closed) {
          clearTimeout(timer);
          peer.removeEventListener('icegatheringstatechange', changed);
          cancelGather = undefined;
          if (closed) reject(new Error('Transfer cancelled.')); else resolve();
        }
      };
      peer.addEventListener('icegatheringstatechange', changed);
      cancelGather = () => {
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', changed);
        cancelGather = undefined;
        reject(new Error('Transfer cancelled.'));
      };
    });
    if (closed) throw new Error('Transfer cancelled.');
    return peer.localDescription;
  };
  return {
    session,
    close,
    offer: async () => encodePairing(await gather(await peer.createOffer()), session),
    answer: async (description, remoteSession) => {
      await peer.setRemoteDescription(description);
      return encodePairing(await gather(await peer.createAnswer()), remoteSession);
    },
    accept: async description => {
      await peer.setRemoteDescription(description);
      if (channel?.readyState !== 'open') connectionTimer = setTimeout(() => fail('Could not connect. Try the same Wi-Fi without guest isolation, or use a full backup.'), 30000);
    },
    send: async contents => {
      if (!sending || channel?.readyState !== 'open' || closed || sent) throw new Error('The other device is not connected or this transfer has already been sent.');
      if (!contents.length || contents.length > MAX_SIZE) throw new Error('This transfer is too large. Use a full backup file.');
      channel.send(JSON.stringify({ type: 'start', size: contents.length }));
      for (let offset = 0; offset < contents.length; offset += CHUNK_SIZE) {
        while (channel.bufferedAmount > 256 * 1024) {
          await new Promise(resolve => setTimeout(resolve, 25));
          if (closed || channel.readyState !== 'open') throw new Error('Transfer disconnected.');
        }
        channel.send(contents.slice(offset, offset + CHUNK_SIZE));
        onStatus(`Sending ${Math.min(100, Math.round((offset + CHUNK_SIZE) / contents.length * 100))}%`);
      }
      channel.send(JSON.stringify({ type: 'end' }));
      sent = true;
      onStatus('Waiting for receipt…');
    },
  };
};
