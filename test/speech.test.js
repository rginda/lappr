import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('Speech Module', () => {
  let speech;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();

    window.speechSynthesis = {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: vi.fn(() => [{ name: 'Test Voice', lang: 'en-US' }]),
      pause: vi.fn(),
      resume: vi.fn(),
      onvoiceschanged: null,
      speaking: false,
      paused: false
    };

    global.SpeechSynthesisUtterance = vi.fn().mockImplementation(function (text) {
      this.text = text;
      this.volume = 1;
      this.rate = 1;
      this.pitch = 1;
      this.voice = null;
      this.onend = null;
      this.onerror = null;
      this.addEventListener = vi.fn();
      this.removeEventListener = vi.fn();
    });

    speech = await import('../public/js/ui/speech.js');
    speech.cancelSpeech();
    speech.configureSpeech({ enabled: true, volume: 1.0, voiceName: 'Test Voice' });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not speak if disabled', () => {
    speech.configureSpeech({ enabled: false });
    speech.speak('Test');
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it('should speak and queue utterances', () => {
    speech.speak('First');
    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1);

    speech.speak('Second');
    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1);

    const utterance = window.speechSynthesis.speak.mock.calls[0][0];
    utterance.onend();

    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(2);
  });

  it('should handle priority speech by cancelling current', () => {
    speech.speak('First');
    speech.speak('Priority', true);

    expect(window.speechSynthesis.cancel).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60);

    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(2);
    expect(window.speechSynthesis.speak.mock.calls[1][0].text).toBe('Priority');
  });

  it('should force clear hung utterances via watchdog', () => {
    speech.speak('Hung');
    vi.advanceTimersByTime(11000);
    expect(window.speechSynthesis.cancel).toHaveBeenCalledTimes(1);
  });

  it('should unlock audio engine on interaction', () => {
    window.dispatchEvent(new Event('click'));
    expect(window.speechSynthesis.cancel).toHaveBeenCalledTimes(1);
    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1);
    expect(window.speechSynthesis.speak.mock.calls[0][0].text).toBe('');
  });
});
