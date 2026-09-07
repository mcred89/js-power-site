import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createTabataAudio } from '../data/tabataAudio';
import { getTabataElapsedMs, getTabataTiming } from '../data/tabataTimer';
import './TabataTimer.css';

const formatTime = milliseconds => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const phaseLabels = { warmup: 'Warm up', sprint: 'Sprint', rest: 'Rest', complete: 'Complete' };

const TabataTimer = ({ roundCount = 8, timer = null, completed = false, onTimerChange, onComplete, onClose }) => {
  // Reopening needs a fresh gesture to enable browser audio. Freeze the restored clock
  // until that gesture, rather than silently continuing a saved running timer.
  const initialTimerRef = useRef(undefined);
  if (initialTimerRef.current === undefined) {
    initialTimerRef.current = timer ? {
      elapsedMs: getTabataTiming(roundCount, getTabataElapsedMs(timer)).totalElapsedMs,
      runningSince: null,
    } : null;
  }
  const [localTimer, setLocalTimer] = useState(initialTimerRef.current);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [starting, setStarting] = useState(false);
  const [soundUnavailable, setSoundUnavailable] = useState(false);
  const [recovered, setRecovered] = useState(Boolean(timer?.runningSince) && !completed);
  const audioRef = useRef(null);
  const localTimerRef = useRef(localTimer);
  const incomingTimerRef = useRef(timer);
  const actionRef = useRef(0);
  const mountedRef = useRef(false);
  const completedRef = useRef(completed);
  const onTimerChangeRef = useRef(onTimerChange);
  const onCompleteRef = useRef(onComplete);
  const dialogRef = useRef(null);
  localTimerRef.current = localTimer;
  onTimerChangeRef.current = onTimerChange;
  onCompleteRef.current = onComplete;

  const timing = getTabataTiming(roundCount, completed
    ? getTabataTiming(roundCount, 0).totalDurationMs
    : getTabataElapsedMs(localTimer, now));
  const running = Boolean(localTimer?.runningSince) && !completed;
  const finished = completed || timing.phase === 'complete';

  useEffect(() => {
    mountedRef.current = true;
    if (timer?.runningSince && !completed) onTimerChangeRef.current(initialTimerRef.current);
    return () => {
      mountedRef.current = false;
      actionRef.current += 1;
      audioRef.current?.close()?.catch(() => {});
      const current = localTimerRef.current;
      if (current?.runningSince) {
        const paused = {
          elapsedMs: getTabataTiming(roundCount, getTabataElapsedMs(current)).totalElapsedMs,
          runningSince: null,
        };
        localTimerRef.current = paused;
        onTimerChangeRef.current(paused);
      }
    };
    // The saved clock is restored only when this set's timer first mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (incomingTimerRef.current === timer) return;
    incomingTimerRef.current = timer;
    setLocalTimer(timer);
    setNow(Date.now());
  }, [timer]);

  useEffect(() => {
    completedRef.current = completed;
  }, [completed]);

  useEffect(() => {
    if (!running) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [running]);

  useEffect(() => {
    if (!running || timing.phase !== 'complete' || completedRef.current) return;
    completedRef.current = true;
    const finalState = { elapsedMs: timing.totalDurationMs, runningSince: null };
    localTimerRef.current = finalState;
    setLocalTimer(finalState);
    // The final audio cue is already scheduled. Leave it playing while the
    // completed timer stays visible; explicit dismissal still cancels sound.
    onCompleteRef.current(finalState);
  }, [running, timing.phase, timing.totalDurationMs]);

  useEffect(() => {
    if (!expanded) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus?.();
    };
  }, [expanded]);

  const saveTimer = next => {
    localTimerRef.current = next;
    setLocalTimer(next);
    setNow(Date.now());
    onTimerChangeRef.current(next);
  };

  const pause = () => {
    actionRef.current += 1;
    setStarting(false);
    audioRef.current?.stop();
    const current = localTimerRef.current;
    if (!current?.runningSince) return;
    saveTimer({
      elapsedMs: getTabataTiming(roundCount, getTabataElapsedMs(current)).totalElapsedMs,
      runningSince: null,
    });
  };

  const start = async () => {
    if (starting || localTimerRef.current?.runningSince || completed) return;
    const action = ++actionRef.current;
    setStarting(true);
    setExpanded(true);
    setRecovered(false);
    let ready = false;
    try {
      if (!audioRef.current) audioRef.current = createTabataAudio();
      await audioRef.current.unlock();
      ready = true;
    } catch (error) {
      // A hands-free workout needs working cues. Require a successful retry
      // before the clock starts so an audio failure cannot silently run it.
    }
    if (!mountedRef.current || action !== actionRef.current) return;
    setSoundUnavailable(!ready);
    setStarting(false);
    if (!ready) return;
    const elapsedMs = getTabataTiming(roundCount, getTabataElapsedMs(localTimerRef.current)).totalElapsedMs;
    if (ready) {
      try {
        audioRef.current.schedule(roundCount, elapsedMs);
      } catch (error) {
        audioRef.current.stop();
        setSoundUnavailable(true);
        return;
      }
    }
    saveTimer({ elapsedMs, runningSince: new Date().toISOString() });
  };

  const reset = () => {
    actionRef.current += 1;
    setStarting(false);
    audioRef.current?.stop();
    completedRef.current = false;
    setRecovered(false);
    saveTimer(null);
    setExpanded(false);
  };

  const close = () => {
    pause();
    setExpanded(false);
    onClose?.();
  };

  const handleDialogKeyDown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      const buttons = [...dialogRef.current.querySelectorAll('button:not(:disabled)')];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };

  if (!expanded) return (
    <div className="tabata-timer-card">
      <p className="tabata-timer-card-title">{completed ? 'Tabata complete' : 'One set. Hands-free sprints.'}</p>
      <p>1 minute warm-up, then {roundCount} sprints: 20 seconds on, 10 seconds between sprints.</p>
      {recovered && <p className="tabata-timer-notice" role="status">Timer paused after reopening. Resume to enable the buzzer.</p>}
      {localTimer && !completed && <p>Paused at {formatTime(Math.floor(timing.totalElapsedMs / 1000) * 1000)} of {formatTime(timing.totalDurationMs)}.</p>}
      {!completed && <p className="tabata-timer-sound-help">Turn up your media volume. High buzzers mean sprint; low buzzers mean rest.</p>}
      {completed
        ? <button className="secondary-button" type="button" onClick={() => setExpanded(true)}>View finished timer</button>
        : <button className="primary-button" type="button" onClick={start} disabled={starting}>{localTimer ? 'Resume timer' : 'Start timer'}</button>}
    </div>
  );

  return createPortal(
    <div
      className={`tabata-timer-screen tabata-timer-${timing.phase}`}
      role="dialog"
      aria-modal="true"
      aria-label="Tabata timer"
      tabIndex={-1}
      ref={dialogRef}
      onKeyDown={handleDialogKeyDown}
    >
      <div className="tabata-timer-layout">
        <header className="tabata-timer-header">
          <span>Tabata sprints</span>
          <button type="button" onClick={close} aria-label="Close timer">×</button>
        </header>
        <div className="tabata-timer-main">
          <p className="tabata-timer-round">Sprint {timing.sprintNumber} <span>of {roundCount}</span></p>
          <h2 className="tabata-timer-phase" aria-live="polite">{phaseLabels[timing.phase]}</h2>
          <div className="tabata-timer-countdown" role="timer" aria-label={`${phaseLabels[timing.phase]} time remaining`} aria-live="off">{formatTime(timing.phaseRemainingMs)}</div>
          <p className="tabata-timer-direction">{finished ? 'All sprints finished. Set complete.'
            : starting ? 'Enabling buzzer…'
              : !running ? 'Paused'
                : timing.phase === 'warmup' ? 'Get moving. Sprint 1 starts after the warm-up.'
                  : timing.phase === 'rest' ? `Recover. Sprint ${timing.sprintNumber + 1} is next.`
                    : 'Go! Keep sprinting until the buzzer.'}</p>
        </div>
        <div className="tabata-timer-footer">
          <div className="tabata-timer-total"><span>Total time</span><strong>{formatTime(Math.floor(timing.totalElapsedMs / 1000) * 1000)} <span>/ {formatTime(timing.totalDurationMs)}</span></strong></div>
          <progress aria-label="Tabata time elapsed" value={timing.totalElapsedMs} max={timing.totalDurationMs} />
          {soundUnavailable && <p className="tabata-timer-notice" role="status">The buzzer could not start. The timer is paused. Enable sound in your browser and retry.</p>}
          <div className="tabata-timer-controls">
            {finished ? <button type="button" onClick={close}>Back to workout</button> : <>
              <button type="button" onClick={running ? pause : start} disabled={starting}>{starting ? 'Starting…' : running ? 'Pause timer' : soundUnavailable ? 'Retry sound' : 'Resume timer'}</button>
              <button className="tabata-timer-secondary" type="button" onClick={reset}>Reset timer</button>
            </>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default TabataTimer;
