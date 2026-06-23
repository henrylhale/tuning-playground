# tuning-playground

Browser experiments in just-intonation tuning and source-filter voice synthesis,
built around the barbershop style. Each app is a single self-contained HTML file —
no build step, no dependencies. Open in a browser, or visit the hosted versions.

## Apps

- **`quartet.html`** — A four-voice barbershop quartet. Pick a key center, chord
  root, and chord from the (just-intonated) barbershop vocabulary; reorder/octave
  the voicing; and shape each of the four source-filter voices on a shared vowel
  chart. ([live](https://henryhale.com/tuning/quartet.html))
- **`voice-synth.html`** — A single source-filter voice: a 1/n^e glottal buzz
  shaped by five formant resonances, with a draggable IPA vowel chart, vibrato,
  breath (filtered noise), and a low-pass filter. ([live](https://henryhale.com/tuning/voice-synth.html))
- **`barbershop-tuning.html`** — A polyphonic just-intonation keyboard for
  spelling barbershop chords, with Helmholtz–Ellis / ratio labels. ([live](https://henryhale.com/tuning/barbershop-tuning.html))

## Notes

- All synthesis uses the Web Audio API. Formants are modeled as a parallel bank
  of bandpass biquads; the glottal source is a `PeriodicWave` of harmonics with an
  adjustable spectral falloff.
- Tunings are 7-limit just intonation, octave-reduced relative to a chosen key
  center.
