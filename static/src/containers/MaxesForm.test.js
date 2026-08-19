import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { MaxesForm } from './MaxesForm';

it('shows the generated routine when used as the website calculator', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const formRef = createRef();
  act(() => root.render(<MaxesForm ref={formRef} />));
  act(() => formRef.current.setState({
    maxSquat: '315',
    maxPress: '185',
    maxDead: '405',
    mainLiftChoice: 'Low',
  }));

  act(() => div.querySelector('form').dispatchEvent(new Event('submit', {
    bubbles: true,
    cancelable: true,
  })));

  expect(div.textContent).toContain('5 weeks. 15 sessions.');
  expect(div.textContent).toContain('Squat: 205 lb');
  act(() => root.unmount());
});

it('continues to send generated inputs to the PWA callback', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const formRef = createRef();
  const onCreate = jest.fn();
  act(() => root.render(<MaxesForm ref={formRef} onCreate={onCreate} />));
  act(() => formRef.current.setState({
    maxSquat: '315',
    maxPress: '185',
    maxDead: '405',
    mainLiftChoice: 'Low',
  }));

  act(() => div.querySelector('form').dispatchEvent(new Event('submit', {
    bubbles: true,
    cancelable: true,
  })));

  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
    maxSquat: '315',
    mainLiftChoice: 'Low',
  }));
  expect(div.textContent).toContain('Build your routine');
  act(() => root.unmount());
});

it('prefills editable generator settings from a template', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const formRef = createRef();
  act(() => root.render(<MaxesForm ref={formRef} onCreate={() => {}} initialInputs={{
    maxSquat: '',
    maxPress: '',
    maxDead: '',
    mainLiftChoice: 'High',
    duration: '3 weeks',
    includeStrongmanDay: true,
  }} />));

  expect(formRef.current.state).toMatchObject({
    maxSquat: '',
    mainLiftChoice: 'High',
    duration: '3 weeks',
    includeStrongmanDay: true,
  });
  expect(div.querySelector('[name="maxSquat"]').value).toBe('');
  expect(div.querySelector('[name="mainLiftChoice"]:checked').value).toBe('High');
  expect(div.querySelector('[name="duration"]:checked').value).toBe('3 weeks');
  expect(div.querySelector('[name="includeStrongmanDay"]').checked).toBe(true);
  act(() => root.unmount());
});
