import { describe, it, expect, beforeEach } from 'vitest';
import { sessionStore } from '../public/js/core/session_store.js';

describe('SessionStore', () => {
  beforeEach(() => {
    sessionStore.reset();
  });

  it('should reset to default state', () => {
    const state = sessionStore.getState();
    expect(state.status).toBe('ready');
    expect(state.lapsLogged).toBe(0);
    expect(state.id).toBeDefined();
  });

  it('should recover state', () => {
    const fakeState = { status: 'paused', elapsedTime: 5000 };
    sessionStore.recover(fakeState);
    expect(sessionStore.getState().status).toBe('paused');
    expect(sessionStore.getState().elapsedTime).toBe(5000);
  });

  it('should return racers correctly', () => {
    sessionStore.setState({ racers: { '123': { carName: 'Racer 1' } } });
    expect(sessionStore.getRacers()).toHaveProperty('123');
    expect(sessionStore.getRacer('123').carName).toBe('Racer 1');
    expect(sessionStore.getRacer('abc')).toBeUndefined();
  });
});
