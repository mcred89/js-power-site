import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { createPairingReader, createQrPeer } from '../data/qrPeer';
import { createSharedTransferContents } from '../data/transferUi';

const Scanner = ({ onCode }) => {
  const video = useRef();
  const callback = useRef(onCode);
  callback.current = onCode;
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stopped = false;
    let stream;
    let timer;
    const scan = () => {
      if (stopped) return;
      const element = video.current;
      if (element?.readyState >= 2) {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 960 / element.videoWidth);
        canvas.width = element.videoWidth * scale;
        canvas.height = element.videoHeight * scale;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(element, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'dontInvert' });
        if (result) callback.current(result.data);
      }
      timer = setTimeout(scan, 180);
    };
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera scanning requires HTTPS and a supported browser.');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        if (stopped) { stream.getTracks().forEach(track => track.stop()); return; }
        video.current.srcObject = stream;
        await video.current.play();
        scan();
      } catch (problem) {
        if (!stopped) setError(problem.name === 'NotAllowedError' ? 'Allow camera access in browser settings, then retry.' : 'Camera unavailable. Close other camera apps and retry, or use a full backup.');
      }
    };
    start();
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); };
  }, [attempt]);
  return <>{error ? <><p role="alert">{error}</p><button className="secondary-button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry camera</button></> : <video className="pairing-camera" ref={video} muted playsInline aria-label="Pairing code scanner" />}</>;
};

const PairingCode = ({ pages }) => {
  const [page, setPage] = useState(0);
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (pages.length < 2) return undefined;
    const timer = setInterval(() => setPage(value => (value + 1) % pages.length), 1400);
    return () => clearInterval(timer);
  }, [pages]);
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(pages[page], { width: 600, margin: 4, errorCorrectionLevel: 'M' })
      .then(value => { if (active) setImage(value); })
      .catch(() => { if (active) setError('Could not display pairing code. Close and try again.'); });
    return () => { active = false; };
  }, [pages, page]);
  return <>{error && <p role="alert">{error}</p>}{image && <img className="pairing-code" src={image} alt={`Device pairing code ${page + 1} of ${pages.length}`} />}{pages.length > 1 && <p className="pairing-caption">Code {page + 1} of {pages.length} · changes automatically. Hold the camera steady until all codes are scanned.</p>}</>;
};

export default function QrTransfer({ transfer, onClose, onReceive }) {
  const sending = Boolean(transfer);
  const peer = useRef();
  const reader = useRef();
  const processing = useRef(false);
  const receive = useRef(onReceive);
  receive.current = onReceive;
  const [stage, setStage] = useState(sending ? 'preparing' : 'scan');
  const [pages, setPages] = useState([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const fail = problem => {
      if (active) { setError(problem.message); setStage('error'); peer.current?.close(); }
    };
    try {
      peer.current = createQrPeer({ sending, onError: fail, onStatus: value => {
        if (!active) return;
        setStatus(value);
        if (value === 'connected') setStage('connected');
        if (value.startsWith('Receiving')) setStage('sending');
        if (value === 'sent' || value === 'received') setStage('done');
      }, onReceive: contents => { if (active) return receive.current(contents); } });
      reader.current = createPairingReader(sending ? 'answer' : 'offer', sending ? peer.current.session : undefined);
      if (sending) peer.current.offer().then(codes => {
        if (active) { setPages(codes); setStage('show'); }
      }).catch(fail);
    } catch (problem) { fail(problem); }
    return () => { active = false; peer.current?.close(); };
  }, [sending]);
  const scan = async value => {
    if (processing.current) return;
    try {
      const result = reader.current(value);
      setError('');
      setStatus(`Scanned ${result.received} of ${result.count} codes`);
      if (!result.description) return;
      processing.current = true;
      setStage('preparing');
      if (sending) {
        setStatus('Connecting…');
        await peer.current.accept(result.description);
      } else {
        const codes = await peer.current.answer(result.description, result.session);
        setPages(codes);
        setStage('show');
      }
    } catch (problem) {
      setError(problem.message);
      if (processing.current) { peer.current.close(); setStage('error'); }
    }
  };
  const send = async () => {
    setStage('sending');
    try { await peer.current.send(createSharedTransferContents(transfer)); }
    catch (problem) { setError(problem.message); setStage('error'); peer.current.close(); }
  };
  return <div className="modal-backdrop"><section className="confirmation-modal qr-transfer" role="dialog" aria-modal="true" aria-labelledby="qr-transfer-title">
    <p className="eyebrow">Device transfer</p><h2 id="qr-transfer-title">{sending ? 'Send with QR' : 'Receive with QR'}</h2>
    <p>Keep both apps open on the same Wi-Fi.</p>
    {stage === 'preparing' && <p role="status">{status || 'Preparing pairing codes…'}</p>}
    {stage === 'show' && <><p>{sending ? 'On the other device, open Settings → Receive with QR and scan these codes.' : 'Now use the sending device to scan these reply codes.'}</p><PairingCode pages={pages} />{sending && <button className="primary-button full-button" onClick={() => { setStage('scan'); setStatus(''); }}>Scan reply code</button>}</>}
    {stage === 'scan' && <><p>{sending ? 'Scan the reply displayed by the receiving device.' : 'Scan the code displayed by the sending device, inside this app.'}</p><Scanner onCode={scan} /><p role="status">{status}</p></>}
    {stage === 'connected' && <><p role="status">Devices connected.</p>{sending ? <><p>Send {transfer.label || 'your data'} to the device whose reply you just scanned?</p><button className="primary-button" onClick={send}>Send data</button></> : <p>Waiting for the sender to confirm. You will review the data before importing.</p>}</>}
    {stage === 'sending' && <p role="status">{status}</p>}
    {stage === 'done' && <p role="status">{sending ? 'Transfer received. Review and import it on the other device.' : 'Transfer received. Preparing import preview…'}</p>}
    {error && <p role="alert">{error}</p>}
    {stage === 'error' && <p>Close this transfer and start again on both devices. Guest Wi-Fi may block connections; full backup and restore is also available.</p>}
    <div className="button-row modal-actions"><button className="secondary-button" onClick={onClose}>{stage === 'done' ? 'Done' : 'Cancel'}</button></div>
  </section></div>;
}
