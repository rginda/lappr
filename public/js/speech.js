/**
 * Apex Timing - Speech Synthesis Module
 * Utilizes the browser's Web Speech API for voice announcements.
 */

let isEnabled = true;
let volume = 0.8;
let defaultVoiceName = '';
let defaultPitch = 1.0;
let defaultRate = 1.1;

let synth = window.speechSynthesis;
let currentUtterance = null;
let speechQueue = [];
let cachedVoices = [];
let cachedFallbackVoice = null;

/**
 * Configure the speech module settings.
 * @param {Object} config - Config settings.
 */
export function configureSpeech(config) {
  if (config.enabled !== undefined) isEnabled = config.enabled;
  if (config.volume !== undefined) volume = Math.max(0, Math.min(1, config.volume));
  if (config.voiceName !== undefined) defaultVoiceName = config.voiceName;
  if (config.pitch !== undefined) defaultPitch = config.pitch;
  if (config.rate !== undefined) defaultRate = config.rate;

  if (!isEnabled) {
    cancelSpeech();
  }
}

/**
 * Speak a string of text.
 * Handles queueing and prevents overlap lag by cancelling long-running speech.
 * @param {string} text - Text to speak.
 * @param {boolean} priority - If true, cancels ongoing speech to announce immediately.
 */
export function speak(text, priority = false, options = {}) {
  if (!isEnabled || !synth) return;

  // For high-priority event announcements (e.g. race start, race finish), clear queue
  if (priority) {
    cancelSpeech();
    // Chrome bug: calling speak() immediately after cancel() can fail silently.
    setTimeout(() => {
      speak(text, false, options);
    }, 50);
    return;
  }

  // To prevent the audio announcements from lagging behind real-time race events,
  // we limit the size of the speech queue. If there are too many items, clear the older ones.
  if (speechQueue.length > 3) {
    speechQueue.shift(); // Remove oldest
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.volume = volume;
  utterance.rate = options.rate !== undefined && !isNaN(options.rate) ? options.rate : defaultRate;
  utterance.pitch =
    options.pitch !== undefined && !isNaN(options.pitch) ? options.pitch : defaultPitch;

  const targetVoiceName = options.voiceName !== undefined ? options.voiceName : defaultVoiceName;

  let voices = synth.getVoices();
  if (voices.length > 0) {
    cachedVoices = voices;
  } else {
    voices = cachedVoices;
  }

  let selectedVoice = null;

  if (targetVoiceName) {
    selectedVoice = voices.find((voice) => voice.name === targetVoiceName);
  }

  if (!selectedVoice) {
    // If we already picked a fallback and it's still available, stick with it
    if (cachedFallbackVoice && voices.some((v) => v.name === cachedFallbackVoice.name)) {
      selectedVoice = cachedFallbackVoice;
    } else {
      // Try to find a natural-sounding English voice
      selectedVoice =
        voices.find(
          (voice) =>
            voice.lang.startsWith('en') &&
            (voice.name.includes('Google') || voice.name.includes('Natural'))
        ) || voices.find((voice) => voice.lang.startsWith('en'));

      if (selectedVoice) {
        cachedFallbackVoice = selectedVoice;
      }
    }
  }

  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }

  utterance.onend = () => {
    currentUtterance = null;
    processQueue();
  };

  utterance.onerror = () => {
    currentUtterance = null;
    processQueue();
  };

  speechQueue.push(utterance);

  if (!currentUtterance) {
    processQueue();
  }
}

/**
 * Cancel all active speech and clear the queue.
 */
export function cancelSpeech() {
  if (synth) {
    synth.cancel();
  }
  speechQueue = [];
  currentUtterance = null;
}

/**
 * Process the next speech item in the queue.
 */
function processQueue() {
  if (!synth || currentUtterance || speechQueue.length === 0) return;

  currentUtterance = speechQueue.shift();

  // Watchdog timeout: If onend/onerror doesn't fire within 10s, force clear it
  // This handles Chrome bugs where speech synthesis silently hangs
  const watchdog = setTimeout(() => {
    if (currentUtterance) {
      console.warn('[Speech] Utterance watchdog triggered - forcing queue progression');
      synth.cancel();
      currentUtterance = null;
      processQueue();
    }
  }, 10000);

  // Wrap existing onend/onerror to clear the watchdog
  const origOnEnd = currentUtterance.onend;
  currentUtterance.onend = (e) => {
    clearTimeout(watchdog);
    if (origOnEnd) origOnEnd(e);
  };

  const origOnError = currentUtterance.onerror;
  currentUtterance.onerror = (e) => {
    clearTimeout(watchdog);
    if (origOnError) origOnError(e);
  };

  // Chrome GC bug workaround: keep utterance in a global array until it finishes
  if (!window._utterances) window._utterances = [];
  window._utterances.push(currentUtterance);

  // Also clean up the global array on end
  const cleanupGc = () => {
    const idx = window._utterances.indexOf(currentUtterance);
    if (idx !== -1) window._utterances.splice(idx, 1);
  };
  currentUtterance.addEventListener('end', cleanupGc);
  currentUtterance.addEventListener('error', cleanupGc);

  synth.speak(currentUtterance);
}

// Pre-fetch voices (necessary for some browsers like Chrome)
if (synth) {
  if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = () => {
      // Warm up voices load
      synth.getVoices();
    };
  }

  // Chrome specific bug: long-running or repeated speech can randomly pause itself
  // Periodically "jiggling" the pause/resume state keeps the engine alive without
  // interrupting the actual audio playback noticeably.
  setInterval(() => {
    if (synth.speaking && !synth.paused) {
      synth.pause();
      synth.resume();
    }
  }, 5000);
}

// Browser Autoplay Policy & Ghost State Workaround
// If speech is called before the user interacts with the page (e.g. auto-reconnect session reload),
// Chrome silently drops the audio but permanently freezes the speech queue in a "speaking" state.
// We must aggressively clear this state upon the first user interaction anywhere on the document.
let userHasInteracted = false;
const unlockAudioEngine = () => {
  if (userHasInteracted || !synth) return;
  userHasInteracted = true;

  // Clear any invisible hung utterances that were blocked by autoplay policy
  synth.cancel();
  if (synth.paused) synth.resume();

  // Play a silent utterance to fully initialize the audio engine context
  const unlockSpeech = new SpeechSynthesisUtterance('');
  unlockSpeech.volume = 0;
  synth.speak(unlockSpeech);

  // Clean up listeners
  window.removeEventListener('click', unlockAudioEngine);
  window.removeEventListener('keydown', unlockAudioEngine);
  window.removeEventListener('touchstart', unlockAudioEngine);
};

window.addEventListener('click', unlockAudioEngine, { capture: true });
window.addEventListener('keydown', unlockAudioEngine, { capture: true });
window.addEventListener('touchstart', unlockAudioEngine, { capture: true });
