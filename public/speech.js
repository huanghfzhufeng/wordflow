const STORAGE_KEY = 'wordflow.audio.v1';

export const DEFAULT_SPEECH_PREFERENCES = Object.freeze({
  accent: 'en-US',
  rate: 0.85,
  autoplay: false
});

export function normalizeSpeechText(text = '') {
  return String(text)
    .replace(/\s*\/\s*/g, ', ')
    .replace(/\.\.\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function validatePreferences(input = {}) {
  const accent = input.accent === 'en-GB' ? 'en-GB' : 'en-US';
  const numericRate = Number(input.rate);
  const rate = Number.isFinite(numericRate)
    ? Math.min(1.15, Math.max(0.65, numericRate))
    : DEFAULT_SPEECH_PREFERENCES.rate;
  return { accent, rate, autoplay: Boolean(input.autoplay) };
}

function loadPreferences(storage) {
  try {
    return validatePreferences(JSON.parse(storage?.getItem(STORAGE_KEY) || '{}'));
  } catch {
    return { ...DEFAULT_SPEECH_PREFERENCES };
  }
}

export function createSpeechController(environment = {}) {
  const synth = environment.synth ?? globalThis.speechSynthesis;
  const Utterance = environment.Utterance ?? globalThis.SpeechSynthesisUtterance;
  const storage = environment.storage ?? globalThis.localStorage;
  let preferences = loadPreferences(storage);

  function save() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Speech still works when storage is unavailable.
    }
  }

  function setPreferences(next) {
    preferences = validatePreferences({ ...preferences, ...next });
    save();
    return getPreferences();
  }

  function getPreferences() {
    return { ...preferences };
  }

  function chooseVoice() {
    const voices = synth?.getVoices?.() || [];
    const exact = voices.find((voice) => voice.lang === preferences.accent && voice.localService);
    return exact || voices.find((voice) => voice.lang === preferences.accent)
      || voices.find((voice) => voice.lang?.startsWith(preferences.accent.slice(0, 2)))
      || null;
  }

  function speak(text, hooks = {}) {
    const normalized = normalizeSpeechText(text);
    if (!synth || !Utterance || !normalized) {
      hooks.onUnsupported?.();
      return null;
    }
    synth.cancel();
    const utterance = new Utterance(normalized);
    utterance.lang = preferences.accent;
    utterance.rate = preferences.rate;
    utterance.pitch = 1;
    utterance.volume = 1;
    const voice = chooseVoice();
    if (voice) utterance.voice = voice;
    utterance.onstart = () => hooks.onStart?.();
    utterance.onend = () => hooks.onEnd?.();
    utterance.onerror = (event) => hooks.onError?.(event);
    synth.speak(utterance);
    return utterance;
  }

  return {
    supported: Boolean(synth && Utterance),
    getPreferences,
    setPreferences,
    speak,
    cancel: () => synth?.cancel?.()
  };
}
