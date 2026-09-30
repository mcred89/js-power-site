import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { confirmNavigation } from '../data/navigationGuard';
import { useUnsavedChanges } from './useUnsavedChanges';

const Editor = ({ active = true, saving = false }) => {
  useUnsavedChanges(active, saving);
  return <input defaultValue="580 lb" />;
};

describe('unsaved Strongman navigation protection', () => {
  let container;
  let root;
  let confirm;
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    window.history.replaceState({ mcilroyTracker: { depth: 4 } }, '');
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.restoreAllMocks();
    global.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('cancels navigation, permits explicit discard, and releases protection after save', () => {
    act(() => root.render(<Editor />));
    expect(confirmNavigation()).toBe(false);
    expect(container.querySelector('input').value).toBe('580 lb');
    confirm.mockReturnValue(true);
    expect(confirmNavigation()).toBe(true);
    act(() => root.render(<Editor active={false} />));
    confirm.mockClear();
    expect(confirmNavigation()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('restores a cancelled browser history jump before the screen router receives it', () => {
    const go = jest.spyOn(window.history, 'go').mockImplementation(() => {});
    const router = jest.fn();
    const restoreRoute = event => { if (confirmNavigation(event)) router(event); };
    // The eager router is registered before a lazy editor mounts.
    window.addEventListener('popstate', restoreRoute);
    act(() => root.render(<Editor />));
    window.dispatchEvent(new PopStateEvent('popstate', { state: { mcilroyTracker: { depth: 1 } } }));
    expect(go).toHaveBeenCalledWith(3);
    expect(router).not.toHaveBeenCalled();
    window.dispatchEvent(new PopStateEvent('popstate', { state: { mcilroyTracker: { depth: 4 } } }));
    expect(router).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(true);
    window.dispatchEvent(new PopStateEvent('popstate', { state: { mcilroyTracker: { depth: 3 } } }));
    expect(router).toHaveBeenCalledTimes(1);
    window.removeEventListener('popstate', restoreRoute);
  });

  it('asks once for simultaneous editors and blocks departure during a save', () => {
    act(() => root.render(<><Editor /><Editor /></>));
    expect(confirmNavigation()).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    act(() => root.render(<Editor saving />));
    confirm.mockClear();
    expect(confirmNavigation()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    const unload = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(unload)).toBe(false);
  });
});
