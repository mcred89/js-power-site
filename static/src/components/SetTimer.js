import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createSetTimerAudio } from '../data/setTimerAudio';
import { getSetTimerElapsedMs, getSetTimerTiming } from '../data/setTimer';
import { cleanupStaleSetTimerNotifications, createSetTimerNotifications, getSetTimerNotificationPermission } from '../data/setTimerNotifications';
import './SetTimer.css';

const formatTime = milliseconds => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const pauseState = timer => timer ? {
  ...timer,
  elapsedMs: getSetTimerElapsedMs(timer),
  runningSince: null,
} : null;

const sameTimer = (left, right) => left === right || (left && right
  && ['intervalMs', 'elapsedMs', 'runningSince', 'exerciseId'].every(key => left[key] === right[key]));

const SetTimer = ({
  timer = null,
  initialIntervalMs = 60000,
  exerciseId,
  exerciseName,
  eligible = true,
  children,
  onTimerChange,
  onClose,
}) => {
  const [localTimer, setLocalTimer] = useState(timer);
  const [minutes, setMinutes] = useState(String((timer?.intervalMs || initialIntervalMs) / 60000));
  const [editing, setEditing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [notice, setNotice] = useState(timer?.runningSince ? 'The timer kept running. Enable sound to hear the next buzzer.' : '');
  const [soundUnavailable, setSoundUnavailable] = useState(Boolean(timer?.runningSince));
  const [notificationPermission, setNotificationPermission] = useState(getSetTimerNotificationPermission);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationPending, setNotificationPending] = useState(false);
  const [notificationNotice, setNotificationNotice] = useState('');
  const timerRef = useRef(localTimer);
  const audioRef = useRef(null);
  const notificationsRef = useRef(null);
  const actionRef = useRef(0);
  const saveRevisionRef = useRef(0);
  const requestedRef = useRef(timer);
  const stoppingRef = useRef(false);
  const mountedRef = useRef(false);
  const dialogRef = useRef(null);
  const incomingRef = useRef(timer);
  const exerciseRef = useRef(exerciseId);
  const onChangeRef = useRef(onTimerChange);
  const onCloseRef = useRef(onClose);
  const closedRef = useRef(false);
  onChangeRef.current = onTimerChange;
  onCloseRef.current = onClose;

  const closeView = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCloseRef.current();
  }, []);

  const updateLocal = useCallback(next => {
    timerRef.current = next;
    if (mountedRef.current) {
      setLocalTimer(next);
      setNow(Date.now());
    }
  }, []);

  const save = useCallback(async next => {
    const revision = ++saveRevisionRef.current;
    const previous = pauseState(timerRef.current);
    requestedRef.current = next;
    // Keep Stop reviewable until its durable write succeeds.
    updateLocal(next || pauseState(previous));
    try {
      await onChangeRef.current(next);
      if (revision !== saveRevisionRef.current) return false;
      if (!next) updateLocal(null);
      return true;
    } catch (error) {
      // A failed running-state write must not leave sound or the visible clock
      // running. Props can be optimistic clones, so track actions by revision.
      if (revision === saveRevisionRef.current) {
        actionRef.current += 1;
        audioRef.current?.stop();
        const paused = pauseState(next || (previous && { ...previous, exerciseId: exerciseRef.current }));
        updateLocal(paused);
        if (mountedRef.current) {
          setStarting(false);
          setNotice('The timer could not be saved. It is paused. Try again.');
        }
        if (next?.runningSince || (!next && paused)) {
          requestedRef.current = paused;
          try { await onChangeRef.current(paused); } catch (ignored) { /* Keep the local clock paused. */ }
        }
      }
      return false;
    }
  }, [updateLocal]);

  const pause = useCallback((message = '') => {
    if (stoppingRef.current) return Promise.resolve(false);
    actionRef.current += 1;
    audioRef.current?.stop();
    if (mountedRef.current) {
      setStarting(false);
      setNotice(message);
    }
    if (timerRef.current) return save(pauseState(timerRef.current));
    return Promise.resolve(true);
  }, [save]);

  useEffect(() => {
    mountedRef.current = true;
    cleanupStaleSetTimerNotifications();
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const refresh = () => {
      setNow(Date.now());
      if (document.visibilityState === 'visible') audioRef.current?.sync?.();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      mountedRef.current = false;
      actionRef.current += 1;
      saveRevisionRef.current += 1;
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pageshow', refresh);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus?.();
      audioRef.current?.close()?.catch(() => {});
      notificationsRef.current?.dispose();
      // The saved wall-clock origin survives navigation and browser suspension.
      // Only an explicit pause or stop changes it.
    };
    // Restore once. Later prop changes are reconciled separately below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (incomingRef.current === timer) return;
    const previous = incomingRef.current;
    incomingRef.current = timer;
    // The parent publishes before IndexedDB settles. A cloned echo is not an
    // external action, and an echoed null must not close a pending Stop.
    if (sameTimer(timer, requestedRef.current)) return;
    saveRevisionRef.current += 1;
    if (!timer?.runningSince) {
      actionRef.current += 1;
      setStarting(false);
      audioRef.current?.stop();
      updateLocal(timer);
      if (previous && !timer) closeView();
    } else if (timerRef.current?.runningSince) {
      updateLocal(timer);
    }
  }, [timer, updateLocal, closeView]);

  useEffect(() => {
    // A timer belongs to the exercise where it was opened. Clear local state
    // and its notification when the workout moves to another exercise.
    if (!eligible || exerciseRef.current !== exerciseId) {
      actionRef.current += 1;
      saveRevisionRef.current += 1;
      audioRef.current?.stop();
      updateLocal(null);
      closeView();
    }
  }, [eligible, exerciseId, updateLocal, closeView]);

  const running = Boolean(localTimer?.runningSince);
  useEffect(() => {
    if (!running) return undefined;
    const tick = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(tick);
  }, [running]);

  useEffect(() => {
    const updateNotification = () => notificationsRef.current?.update(timerRef.current, exerciseName);
    updateNotification();
    if (!running || !notificationsEnabled) return undefined;
    const tick = window.setInterval(updateNotification, 1000);
    document.addEventListener('visibilitychange', updateNotification);
    window.addEventListener('pageshow', updateNotification);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', updateNotification);
      window.removeEventListener('pageshow', updateNotification);
    };
  }, [localTimer, running, exerciseName, notificationsEnabled]);

  const toggleNotifications = async () => {
    if (notificationPending) return;
    setNotificationPending(true);
    setNotificationNotice('');
    try {
      if (!notificationsRef.current) notificationsRef.current = createSetTimerNotifications({
        onError: () => {
          if (!mountedRef.current) return;
          setNotificationsEnabled(false);
          setNotificationNotice('The timer notification could not update. You can try enabling it again.');
        },
      });
      if (notificationsEnabled) {
        setNotificationsEnabled(false);
        await notificationsRef.current.close();
      } else {
        const enabled = await notificationsRef.current.enable();
        if (!mountedRef.current) return;
        const permission = getSetTimerNotificationPermission();
        setNotificationPermission(permission);
        setNotificationsEnabled(enabled);
        if (enabled) notificationsRef.current.update(timerRef.current, exerciseName);
        else setNotificationNotice(permission === 'denied'
          ? 'Notifications are blocked. Allow them in your browser or app settings to try again.'
          : 'Notifications are unavailable. Open the installed app or reload and try again.');
      }
    } finally {
      if (mountedRef.current) setNotificationPending(false);
    }
  };

  const seconds = Number(minutes) * 60;
  const validInterval = minutes.trim() !== '' && Number.isFinite(seconds)
    && seconds >= 6 && seconds <= 3600 && Math.abs(seconds - Math.round(seconds)) < 0.000001;
  const selectedIntervalMs = Math.round(seconds) * 1000;
  const timing = getSetTimerTiming(localTimer, now);
  const setup = !localTimer || editing;

  const start = async () => {
    if (!eligible || starting || closing || (timerRef.current?.runningSince && !soundUnavailable) || (!timerRef.current && !validInterval)) return;
    const action = ++actionRef.current;
    const prepared = timerRef.current || { intervalMs: selectedIntervalMs, elapsedMs: 0, runningSince: null, exerciseId };
    updateLocal(prepared);
    setStarting(true);
    setNotice('');
    setSoundUnavailable(false);
    try {
      if (!audioRef.current) audioRef.current = createSetTimerAudio();
      await audioRef.current.unlock();
      if (!mountedRef.current || action !== actionRef.current) return;
      const next = prepared.runningSince ? prepared : { ...prepared, exerciseId, runningSince: new Date().toISOString() };
      audioRef.current.schedule(next, () => {
        if (!mountedRef.current || action !== actionRef.current) return;
        setSoundUnavailable(true);
        setNotice('Sound was interrupted. The timer is still running. Enable sound to hear the next buzzer.');
      });
      if (!prepared.runningSince) await save(next);
    } catch (error) {
      if (!mountedRef.current || action !== actionRef.current) return;
      audioRef.current?.stop();
      setSoundUnavailable(true);
      if (prepared.runningSince) {
        setNotice('Sound is unavailable. The timer is still running. Try enabling sound again.');
      } else {
        setNotice('The buzzer could not start. The timer is paused. Enable sound and retry.');
        await save({ ...prepared, runningSince: null });
      }
    } finally {
      if (mountedRef.current && action === actionRef.current) setStarting(false);
    }
  };

  const stop = async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    actionRef.current += 1;
    setStarting(false);
    setClosing(true);
    audioRef.current?.stop();
    if (await save(null)) closeView();
    stoppingRef.current = false;
    if (mountedRef.current) setClosing(false);
  };

  const changeInterval = async event => {
    event.preventDefault();
    if (!validInterval) return;
    if (!editing) { start(); return; }
    actionRef.current += 1;
    audioRef.current?.stop();
    setNotice('Interval changed. Resume for a new 10-second ready countdown.');
    setSoundUnavailable(false);
    setEditing(false);
    await save({ intervalMs: selectedIntervalMs, elapsedMs: 0, runningSince: null, exerciseId });
  };

  const handleKeyDown = event => {
    if (event.key === 'Escape') { event.preventDefault(); stop(); }
    if (event.key !== 'Tab') return;
    const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')]
      .filter(element => !element.closest('details:not([open])') || element.tagName === 'SUMMARY');
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
      event.preventDefault(); first?.focus();
    }
  };

  return createPortal(
    <div className={`set-timer-screen${running ? ' is-running' : ''}`} role="dialog" aria-modal="true" aria-label="Set timer" tabIndex={-1} ref={dialogRef} onKeyDown={handleKeyDown}>
      <div className="set-timer-layout">
        <header className="set-timer-header"><span>Set timer</span><button type="button" onClick={stop} disabled={closing} aria-label="Stop timer and return to workout">×</button></header>
        <h1 className="set-timer-exercise">{exerciseName}</h1>
        {setup ? <form className="set-timer-setup" onSubmit={changeInterval}>
          <h2>{editing ? 'Change interval' : 'Choose your interval'}</h2>
          <p>10 seconds to get ready, then a buzzer at the start of every interval. Complete each set yourself.</p>
          <div className="set-timer-presets">{[1, 1.5, 2, 3].map(value => <button key={value} type="button" aria-pressed={Number(minutes) === value} onClick={() => setMinutes(String(value))}>{value} min</button>)}</div>
          <label htmlFor="set-timer-minutes">Interval (minutes)</label>
          <input id="set-timer-minutes" type="number" inputMode="decimal" min="0.1" max="60" step="any" value={minutes} onChange={event => setMinutes(event.target.value)} aria-describedby="set-timer-interval-help" />
          <small id="set-timer-interval-help">0.1–60 minutes, in whole seconds. For example, 1.5 is 1 minute 30 seconds.</small>
          <button className="set-timer-primary" type="submit" disabled={!validInterval || starting || closing}>{editing ? 'Save interval' : 'Start timer'}</button>
          {editing && <button type="button" onClick={() => setEditing(false)}>Cancel change</button>}
        </form> : <>
          <div className="set-timer-clock">
            <p>{timing.phase === 'ready' ? 'Get ready' : 'Next buzzer'}</p>
            <div className="set-timer-countdown" role="timer" aria-label={`${timing.phase === 'ready' ? 'Get ready' : 'Interval'} time remaining`} aria-live="off">{formatTime(timing.remainingMs)}</div>
            <span>{starting ? 'Enabling buzzer…' : running ? `Every ${formatTime(localTimer.intervalMs)}` : 'Paused'}</span>
          </div>
          <div className="set-timer-controls">
            <button className="set-timer-primary" type="button" disabled={starting || closing} onClick={running ? () => pause() : start}>{starting ? 'Starting…' : running ? 'Pause timer' : soundUnavailable ? 'Retry sound' : 'Resume timer'}</button>
            <button type="button" onClick={stop} disabled={closing}>Stop timer</button>
            {running && soundUnavailable && <button className="set-timer-change" type="button" disabled={starting || closing} onClick={start}>Enable sound</button>}
            {!running && !starting && <button className="set-timer-change" type="button" disabled={closing} onClick={() => { setMinutes(String(localTimer.intervalMs / 60000)); setEditing(true); }}>Change interval</button>}
          </div>
          <div className="set-timer-workout-controls">{children}</div>
        </>}
        <div className="set-timer-background">
          <p>The clock keeps running when you switch apps. Background buzzers and notification updates depend on your browser.</p>
          {notificationPermission !== 'unsupported' ? <>
            <button type="button" onClick={toggleNotifications} disabled={notificationPending || closing}>{notificationPending ? 'Updating notification…' : notificationsEnabled ? 'Hide timer notification' : 'Show timer notification'}</button>
            <small>The notification shows time left at its last update and the next buzzer time. Updates can pause in the background.</small>
          </> : <small>This browser does not support timer notifications.</small>}
          {notificationNotice && <p role="status">{notificationNotice}</p>}
        </div>
        {notice && <p className="set-timer-notice" role="status">{notice}</p>}
      </div>
    </div>,
    document.body,
  );
};

export default SetTimer;
