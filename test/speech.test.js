import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpeechController, normalizeSpeechText } from '../public/speech.js';

class FakeUtterance {
  constructor(text) {
    this.text = text;
  }
}

function fakeStorage(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
    value: () => value
  };
}

test('speech text is normalized for slash-separated word forms', () => {
  assert.equal(normalizeSpeechText('send / sends...'), 'send, sends');
});

test('speech controller applies accent, speed and a matching local voice', () => {
  const spoken = [];
  const synth = {
    cancel() {},
    getVoices: () => [
      { lang: 'en-GB', localService: true, name: 'UK' },
      { lang: 'en-US', localService: true, name: 'US' }
    ],
    speak: (utterance) => spoken.push(utterance)
  };
  const storage = fakeStorage();
  const controller = createSpeechController({ synth, Utterance: FakeUtterance, storage });
  controller.setPreferences({ accent: 'en-GB', rate: 0.75, autoplay: true });
  controller.speak('Ready to learn');

  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].lang, 'en-GB');
  assert.equal(spoken[0].rate, 0.75);
  assert.equal(spoken[0].voice.name, 'UK');
  assert.equal(controller.getPreferences().autoplay, true);
  assert.match(storage.value(), /"en-GB"/);
});

test('invalid stored preferences fall back to safe defaults', () => {
  const controller = createSpeechController({
    synth: { cancel() {}, getVoices: () => [], speak() {} },
    Utterance: FakeUtterance,
    storage: fakeStorage('{broken')
  });
  assert.deepEqual(controller.getPreferences(), {
    accent: 'en-US',
    rate: 0.85,
    autoplay: false
  });
});
