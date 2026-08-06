# tuning-playground

Browser experiments in just-intonation tuning and source-filter voice synthesis,
built around the barbershop style. Each app is a single self-contained HTML file —
no build step, no dependencies. Open in a browser, or visit the hosted versions.

## Apps

- **`quartet.html`** — A four-voice barbershop quartet. Pick a key center, chord
  root, and chord from the (just-intonated) barbershop vocabulary; reorder/octave
  the voicing; and shape each of the four source-filter voices on a shared vowel
  chart. ([live](https://henryhale.com/tuning/quartet.html))
- **`voice-synth.html`** — A single voice built on a reduced Liljencrants–Fant
  glottal source and five formant resonances, parameterized by **Estill figures**
  (body–cover, thyroid/cricoid tilt, larynx height, twang, velum, lip protrusion)
  rather than by waveform shape. Draggable IPA vowel chart, and source / tract /
  output spectra plotted on a shared dB scale so the third is visibly the sum of
  the first two. ([live](https://henryhale.com/tuning/voice-synth.html))
- **`barbershop-tuning.html`** — A polyphonic just-intonation keyboard for
  spelling barbershop chords, with Helmholtz–Ellis / ratio labels. ([live](https://henryhale.com/tuning/barbershop-tuning.html))

## Notes

- All synthesis uses the Web Audio API. Formants are modeled as a parallel bank
  of bandpass biquads.
- `quartet.html`'s glottal source is a `PeriodicWave` of harmonics with an
  adjustable spectral falloff. `voice-synth.html` has moved on: its source is one
  period of the LF flow *derivative*, solved numerically and FFT'd into that same
  `PeriodicWave`. Generating the derivative folds lip radiation into the source,
  so there is no separate radiation stage and no brightness control — spectral
  tilt belongs to thyroid tilt and high-frequency boost to twang. See
  `estill-spec.md` for the model.
- Tunings are 7-limit just intonation, octave-reduced relative to a chosen key
  center.
