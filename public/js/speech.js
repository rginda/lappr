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
  }

  // To prevent the audio announcements from lagging behind real-time race events,
  // we limit the size of the speech queue. If there are too many items, clear the older ones.
  if (speechQueue.length > 3) {
    speechQueue.shift(); // Remove oldest
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.volume = volume;
  utterance.rate = options.rate !== undefined ? options.rate : defaultRate;
  utterance.pitch = options.pitch !== undefined ? options.pitch : defaultPitch;

  const targetVoiceName = options.voiceName !== undefined ? options.voiceName : defaultVoiceName;
  const voices = synth.getVoices();
  
  let selectedVoice = null;
  
  if (targetVoiceName) {
    selectedVoice = voices.find(voice => voice.name === targetVoiceName);
  }
  
  if (!selectedVoice) {
    // Try to find a natural-sounding English voice
    selectedVoice = voices.find(voice => 
      voice.lang.startsWith('en') && (voice.name.includes('Google') || voice.name.includes('Natural'))
    ) || voices.find(voice => voice.lang.startsWith('en'));
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
}
