import { describe, it, expect, vi } from 'vitest';
import { bus } from '../public/js/core/event_bus.js';

describe('EventBus', () => {
  it('should allow subscribing and emitting events', () => {
    const spy = vi.fn();
    bus.on('testEvent', spy);
    
    bus.emit('testEvent', { data: 123 });
    
    expect(spy).toHaveBeenCalledWith({ data: 123 });
  });

  it('should ignore emits for events with no subscribers', () => {
    // Should not throw
    bus.emit('unknownEvent', { data: 123 });
  });

  it('should allow unsubscribing from events', () => {
    const spy = vi.fn();
    bus.on('unsubEvent', spy);
    
    bus.off('unsubEvent', spy);
    bus.emit('unsubEvent', { data: 123 });
    
    expect(spy).not.toHaveBeenCalled();
  });

  it('should gracefully handle unsubscribing from unknown events', () => {
    const spy = vi.fn();
    // Should not throw
    bus.off('anotherUnknownEvent', spy);
  });
});
