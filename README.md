# tuning-playground

Browser experiments in just-intonation tuning and source-filter voice synthesis,
built around the barbershop style. Each app is a single self-contained HTML file —
no build step, no dependencies. Open in a browser, or visit the hosted versions.

## Apps

- **`quartet.html`** — A four-voice barbershop quartet. Pick a key center, chord
  root, and chord from the (just-intonated) barbershop vocabulary; reorder/octave
  the voicing; shape each voice on a shared vowel chart; and set the six **Estill
  figures** per voice, so a chord can specify not just which notes are sung but
  how each of them has to be sung. String chords into a sequence and every
  chord remembers its own complete timbre.
  ([live](https://henryhale.com/tuning/quartet.html))
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
- Both synths now run the same voice: the source is one period of the LF flow
  *derivative*, solved numerically and FFT'd into a `PeriodicWave`. Generating the
  derivative folds lip radiation into the source, so there is no separate radiation
  stage and no brightness control — spectral tilt belongs to thyroid tilt and
  high-frequency boost to twang. See `estill-spec.md` for the model.
- The model lives in two `//#region` blocks (`lf-source`, `estill-map`) that are
  developed in `voice-synth.html` and copied verbatim into `quartet.html`.
  `test/estill-parity.test.mjs` asserts the copies stay byte-identical, so the
  quartet cannot quietly drift onto an older voice than the single-voice bench.
- Nothing normalizes loudness across vowels or figures: how loud a configuration
  comes out is one of the things the tools are for measuring. Twang buying output
  for free is the finding, not an artifact.
- Tunings are 7-limit just intonation, octave-reduced relative to a chosen key
  center.
