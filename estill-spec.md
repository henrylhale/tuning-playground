# Reduced LF / Estill Voice Model — Implementation Spec

Target audience: an agent with context on the existing synthesizer repo, tasked with
replacing the current source-filter model with this one.

This spec describes a **reduced** version of the Liljencrants–Fant glottal source model,
parameterized so that its controls correspond to figures from the Estill Voice Model
rather than to raw waveform shape parameters. It deliberately omits parts of both models;
omissions are listed explicitly in section 7.

---

## 1. Estill basics, for someone who has not encountered it

Estill Voice Training (EVT) is a pedagogy developed by Jo Estill from the 1970s onward,
built on a single organizing claim: **voice quality is not a mysterious talent, it is the
product of specific anatomical structures in specific positions, and each structure can be
controlled independently once trained.**

The system has two layers.

**Thirteen Figures for Voice.** Each figure is one structure and its available options —
for example, the vocal folds can be thick, thin, stiff or slack; the larynx can be high,
mid or low; the velum (soft palate) can be raised, mid or lowered. The figures are
explicitly modeled on compulsory figures in figure skating: isolated drills, practiced
alone, later recombined.

**Six Voice Qualities.** Each quality is a *recipe* — a specified setting for every figure.
Belt, for instance, is thick folds plus high larynx plus cricoid tilt plus a narrowed
aryepiglottic sphincter. Nothing about a quality is primitive; it emerges from the figure
settings.

Two consequences matter for a synthesizer:

1. **Orthogonality is the design goal.** The pedagogy asserts the figures are separately
   controllable. In real untrained larynges they co-vary heavily. We adopt the trained-singer
   idealization and treat them as independent axes. This is the central modeling assumption
   of this spec.
2. **Qualities should emerge, not be presets.** If Belt has to be hardcoded rather than
   falling out of its figure settings, the parameterization is wrong. The quality presets in
   section 9 are *test fixtures*, not implementation shortcuts.

Two terms used throughout:

- **AES** — aryepiglottic sphincter, the narrowing at the top of the larynx tube. Its
  narrowed state is called **twang**. It is the mechanism behind the singer's formant.
- **Anchoring** — Estill's replacement for the traditional notion of "support": recruitment
  of torso and head/neck musculature to stabilize everything else under load. We assume it
  optimal and do not model it (section 7).

---

## 2. Signal chain and the radiation fix

Four signals, in order:

```
A(t)  glottal area        geometry only; defines OQ; never synthesized
  |
U(t)  glottal flow        −12 dB/oct    <-- the old model's 1/f² law lives here
  | d/dt
dU/dt flow derivative     −6 dB/oct     <-- what LF models; what we generate
  | vocal tract filter
p(t)  radiated pressure   −6 dB/oct + formants
```

Far-field radiated pressure is proportional to the time derivative of volume flow leaving
the lips. Differentiation and the tract filter are both LTI and therefore commute, so the
derivative is moved upstream of the filter and LF generates it directly. **This means no
separate radiation stage is required** — it is baked into the LF waveform.

**This is a bug fix, not just a refactor.** The current model uses a 1/f² harmonic law,
which is the correct spectrum for glottal *flow*, and then filters and outputs it without
applying the radiation derivative. The existing output is therefore ~6 dB/octave too dark
across the whole spectrum. This is almost certainly why a compensating `brightness`
multiplier was needed. See section 8.

Asymptotic slopes have a knee at the return-phase corner `f_a = 1/(2π·t_a)`:

| Signal | Below corner | Above corner |
|---|---|---|
| U(t) | −12 dB/oct | −18 dB/oct |
| dU/dt | −6 dB/oct | −12 dB/oct |
| p(t) | −6 + formants | −12 + formants |

---

## 3. Source parameters

The LF model describes one period of dU/dt as two pieces:

- Open phase, `0 ≤ t ≤ te`: `E(t) = E0 · e^(αt) · sin(ω_g·t)`, where `ω_g = π/tp`
- Return phase, `te ≤ t ≤ tc`: `E(t) = −(Ee/(ε·ta)) · [e^(−ε(t−te)) − e^(−ε(tc−te))]`

`α` is solved so net flow over the cycle is zero; `ε` is solved from the return-phase area
constraint. Both require a short numerical solve (Newton, 3–5 iterations, converges
reliably) at parameter-change time, not per sample.

Three timing landmarks:

- `tp` — peak glottal flow; the derivative's zero crossing
- `te` — maximum negative derivative; **the excitation instant**, depth `Ee`
- `tc` — complete closure

### 3.1 Exposed source parameters

| Name | Range | Meaning |
|---|---|---|
| `f0` | 60–1200 Hz | Fundamental. Not an Estill figure. |
| `Ee` | linear gain | Excitation strength; sets loudness. Not an Estill figure. |
| `OQ` | 0.35–0.95 | **Open quotient**: fraction of the period the glottis is open. |
| `Rk` | 0.15–0.60 | Pulse skew. Low = more asymmetric = more abrupt shutoff. |
| `Ra` | 0.001–0.12 | Return-phase duration as a fraction of the period. Sets spectral tilt. |

### 3.2 Derived internals

```
Rg = (1 + Rk) / (2 · OQ)      # glottal formant ratio; typically 0.9–1.6
tp = 1 / (2 · Rg · f0)
te = tp · (1 + Rk)
ta = Ra / f0
tc = 1 / f0                    # assume closure completes at period end
```

`Rg·f0` is the **glottal formant** frequency — a genuine low-frequency resonant bump in the
source, generally between `f0` and about `3·f0` (roughly 100–500 Hz for a male voice).
Note: it is *not* in the 300–800 Hz range for low-pitched voices; it scales with pitch. Do
not expose it as an absolute frequency; let it fall out of `Rk` and `OQ`.

### 3.3 Do not parameterize by Rd

Fant's single shape parameter `Rd` (≈0.3 pressed to ≈2.7 breathy) collapses `Rg`, `Rk` and
`Ra` into one dimension via regressions fitted to a speech corpus. It encodes an empirical
claim that pressed voices *also* have abrupt closure and low open quotient.

**That covariance is exactly what this model needs to break.** Body-cover is primarily an
`OQ` change; thyroid tilt is primarily an `Ra` change; the pedagogy's whole point is that a
trained singer moves them independently. Expose `{OQ, Rk, Ra}` directly.

`Rd` may optionally be computed as a **diagnostic readout** — it tells you how far a given
configuration sits from natural-speech statistics, which is useful for catching
implausible parameter combinations in a UI:

```
Rd_diagnostic = (Ra·100 + 1) / 4.8
```

---

## 4. Estill figures affecting the source

Four figures. Each is exposed as a normalized control in `[0,1]` and mapped onto the source
parameters below.

### 4.1 `body_cover` — vocal fold body-cover (0 = thick, 1 = thin)

Primary target `OQ`, secondary `Rk`.

```
OQ_base = lerp(0.45, 0.68, body_cover)
Rk      = lerp(0.25, 0.45, body_cover)
```

Thick folds: short open phase, abrupt shutoff, H1−H2 near 0 dB, strong upper harmonics.
Thin folds: longer open phase, H1−H2 around +8 dB, gentler spectrum.

Deliberately does **not** touch `Ra` — that axis is reserved for thyroid tilt.

### 4.2 `thyroid_tilt` — thyroid cartilage (0 = vertical, 1 = tilted)

Sole target `Ra`. Thyroid tilt is the anterior rotation that lengthens and thins the folds;
its acoustic signature is smoother closure and therefore steeper high-frequency rolloff.

```
Ra = lerp(0.004, 0.075, thyroid_tilt)
```

At `f0` = 120 Hz this moves the tilt corner from roughly 5 kHz (bright, buzzy) to roughly
180 Hz (dark, soft). Perceptually this is "cry" or "sob."

In a real larynx, thyroid tilt also raises `OQ`. We suppress that coupling per the
orthogonality assumption. Note it in code comments so it isn't later "fixed."

### 4.3 `cricoid_tilt` — cricoid cartilage (0 = vertical, 1 = tilted)

**Not a direct parameter — a constraint relaxation.** This is the one figure with no clean
signal-processing home, and modeling it as a knob with its own sound would be wrong.

Untrained voices thin out as they ascend: `OQ` drifts upward with `f0`. Cricoid tilt is the
permission to hold `OQ` low at high pitch.

```
F0_REF = 220.0                     # Hz, reference pitch
K_DRIFT = 0.15                     # OQ rise per octave, untrained

drift = K_DRIFT · log2(f0 / F0_REF) · (1 − cricoid_tilt)
OQ = clamp(OQ_base + max(0, drift), 0.35, 0.95)
```

With `cricoid_tilt = 1`, `OQ` stays wherever `body_cover` put it regardless of pitch. Belt
then *emerges* from the combination (high `f0`, thick folds, high larynx, narrow AES) rather
than being dialed in. **This is the model's main correctness test**: if Belt has to be
hardcoded, something upstream is wrong.

### 4.4 `onset_type` — true vocal fold onset/offset

Envelope timing on `Ee`. Without an aspiration channel only two of the three options are
available (see section 7).

| Option | `onset_ms` | `onset_overshoot` |
|---|---|---|
| Glottal | 3 | 1.25 |
| Simultaneous | 25 | 1.0 |
| Aspirate | *unavailable* | — |

Glottal onset additionally starts with `OQ` depressed by ~0.1 for the first 30 ms, relaxing
to target. That transient pressedness is the audible part of a hard attack.

Offset mirrors onset with the same time constants.

---

## 5. Estill figures affecting the filter

### 5.1 `larynx_height` (0 = low, 0.5 = mid, 1 = high)

A global tract-length scale. Shorter tract, higher formants.

```
s = 1.0 + 0.12 · (2·larynx_height − 1)      # 0.88 … 1.12
```

Apply `s` at **full weight** to F1 and F2, and at **half weight** to the F3/F4/F5 cluster,
since the epilarynx tube's length changes less than total tract length.

Note: real larynx lowering also widens the hypopharynx, which contributes to formant
clustering independently. A pure length scale under-delivers the darkening of a low larynx.
Accept this, or add a small positive coupling from `(1 − larynx_height)` into `twang` if the
low-larynx qualities sound thin.

### 5.2 `twang` — aryepiglottic sphincter (0 = wide, 1 = narrow)

The most valuable figure in the set, and the one the current model structurally cannot
produce because F4 and F5 are frozen.

**Mechanism.** When the epilarynx tube's cross-section drops below roughly one sixth of the
pharynx above it, the tube acoustically decouples and resonates on its own around 2.5–3.5
kHz. F3, F4 and F5 converge on it. Three moderate peaks in the same band sum to one large
one. Because the epilarynx is upstream of the tongue, the resulting peak does not move with
vowel — which is what makes it a stable timbral signature.

**Implementation — linked triple, one knob.** Do *not* bolt a parallel resonator onto fixed
F4/F5; that misses F3's movement, which is audible.

```
F_CLUSTER  = 2900.0                # Hz, cluster target (voice-type dependent)
PULL_FLOOR = 2200.0                # below this, a resonance is articulatory, not clusterable

# Proximity weight. Resonances held low by articulation do not join the cluster.
def pull(F_target):
    if F_target >= PULL_FLOOR: return 1.0
    return max(0.0, 1.0 − (PULL_FLOOR − F_target) / 500.0)

w3 = pull(F3_target)               # 1.0 for a plain vowel, 0.0 for American /r/

F3 = lerp(F3_target,  F_CLUSTER − 200, twang · w3)
F4 = lerp(F4_neutral, F_CLUSTER + 50,  twang)
F5 = lerp(F5_neutral, F_CLUSTER + 350, twang)

B3 = lerp(B3_neutral, B3_neutral · 0.6, twang · w3)   # cluster narrows as it forms
B4 = lerp(B4_neutral, B4_neutral · 0.6, twang)
B5 = lerp(B5_neutral, B5_neutral · 0.6, twang)
```

**F3 is an articulatory target, not a twang output.** Formant numbering is ordinal —
resonances are numbered by frequency order, not by identity. Rhotic lowering (American /r/,
F3 ≈ 1600–2000 Hz) comes from a front/sublingual cavity resonance; the singer's formant comes
from the epilarynx. Both mechanisms operate simultaneously. In a twanged rhotic the low
resonance stays put as F3 and the cluster forms from the resonances above it.

`F3_target` therefore belongs with `F1` and `F2` in the vowel specification. The `pull()`
weight lets it join the cluster when it is already up near 2500 Hz (plain vowels) and exempts
it when articulation is holding it down (rhotics, and to a lesser degree strong lip rounding,
which also lowers F3).

**Consequence worth keeping.** A fully twanged rhotic ends up with a two-member cluster (F4,
F5) rather than three, and therefore rings measurably less. This is correct behavior, not a
limitation: rhotic vowels genuinely ring poorly, which is exactly why barbershop and choral
practice de-rhoticize sustained vowels and defer the /r/ to the release. If ring on rhotics
matters, add an F6 (~5500 Hz male) so the cluster can recruit a third member from above —
but the two-member version is the more faithful default.

Typical male neutral values: F3 ≈ 2500, F4 ≈ 3500, F5 ≈ 4500 Hz. These are voice-type
constants, not per-note parameters — treat them as part of a "singer" configuration object.
Numbers are ballpark and vary widely between individuals; tune by ear.

**Source gain bonus.** Narrowing the epilarynx increases the inertive reactance the tract
presents to the glottis, so fold oscillation amplitude rises for the same subglottal
pressure. In a one-way source→filter chain this cannot be derived, so hardcode it:

```
Ee_effective = Ee · (1.0 + 0.7 · twang)          # ≈ +4.6 dB at full twang
```

This is a lookup table standing in for physics. It is legitimate *only* under the
trained-singer assumption, and it is the whole point of twang — loud output for cheap
glottal effort. Omitting it produces the spectrum without the behavior.

F1, F2, and any articulatorily-held F3 must be **untouched** by `twang`. That separation is
why the singer's formant survives vowel changes.

### 5.3 `velum` (0 = raised, 1 = lowered) — see section 8

### 5.4 `lip_protrusion` (0 = spread, 1 = protruded)

Lip rounding lengthens the tract, lowering *all* formants — an effect the (F1,F2) vowel
pair does not capture on its own.

```
s_lip = 1.0 − 0.05 · lip_protrusion
```

Multiply into the same length scale as `larynx_height`. Weight it lower on F1 (lips affect
the front cavity most, and F1 is dominated by the back).

### 5.5 Tongue, jaw and lip aperture — collapsed

Three Estill figures (tongue body, jaw, lip aperture) jointly determine F1, F2 and — for
rhotics and rounded vowels — F3. The mapping from three articulators to three formants is
many-to-one and non-invertible.

**We collapse them into a direct `(F1, F2, F3_target)` vowel target.** This is a reparameterization,
not an omission — the figures' acoustic consequences are fully represented; their individual
identities are not recoverable. Acceptable for synthesis. It would *not* be acceptable if the
goal were pedagogical feedback ("your jaw is doing the tongue's job"), which is worth noting
if the repo ever grows in that direction.

---

## 6. Filter parameters with no Estill correspondence

These must exist but do not map to any figure. Keep them in a separate namespace so the
figure/non-figure boundary stays legible.

| Parameter | Notes |
|---|---|
| `f0` | Pitch. Estill treats pitch as orthogonal to quality; there is no pitch figure. |
| `Ee` | Loudness. Likewise not a figure. |
| `F1`, `F2`, `F3_target` | Vowel identity. Reparameterization of tongue/jaw/lip-aperture (5.5). `F3_target` carries rhoticity. |
| `B1`–`B5` | Formant bandwidths. Only `B1` is modulated (by nasality); rest are constants. |
| `F4_neutral`, `F5_neutral` | Voice-type constants defining the "singer." |
| `vibrato_rate`, `vibrato_depth` | Not a figure. Modulates `f0`, optionally `Ee`. |

So the answer to "is it just F1 and F2?" is: **F1 and F2 plus pitch, loudness, bandwidths
and the per-singer neutral formant constants.** Pitch and loudness are the notable ones —
they feel like they should be figures and are not.

---

## 7. Figures explicitly excluded

Of thirteen figures: **eight fully modeled, two partially, three dropped.**

### Fully dropped

**False vocal folds.** Assumed permanently retracted (the trained state). Its interesting
outputs — subharmonics, biphonation, regime bifurcation — are chaotic and require a second
coupled mass-spring oscillator above the source, not a jitter parameter. Cost: no growl, no
rock scream, no distortion qualities.

**Torso anchoring** and **head/neck anchoring.** These are not signal parameters at all;
they are constraints on other parameters' trajectories. Unanchored singing shows
characteristic couplings — `f0` rising with subglottal pressure, larynx height drifting with
pitch, tract collapse under load. Anchoring is the reduction of those couplings toward zero.

**We assume optimal anchoring**, i.e. all off-diagonal coupling terms are zero and all
parameters are independently controllable. This assumption is what licenses the entire
orthogonal design. If untrained or fatigued voices are ever wanted, reintroduce them as a
coupling matrix applied to the parameter vector — do not reintroduce them as audio effects.

### Partially modeled

**Body-cover** — thick and thin are modeled; **stiff and slack are not.** Stiff (falsetto)
requires incomplete closure, DC flow offset and aspiration noise. Slack requires a nonlinear
oscillator capable of period doubling. Both are out of scope.

**Onset/offset** — glottal and simultaneous are modeled; **aspirate is not**, as it requires
a noise channel.

### Consequence for the six qualities

Of the six Estill qualities, **only Falsetto is unavailable**; the other five have complete
glottal closure and are fully reachable. Stiff-fold quality can be *approximated* as very
high `OQ` plus steep tilt, which reads as thin and weak rather than breathy.

If aspiration is wanted later it is the smallest possible addition: one noise generator
routed through the same formant filters with its own gain envelope, plus a DC offset on the
flow. Leave the hook in.

---

## 8. Nasality and brightness

### 8.1 Nasality — replaces bandwidth widening

Definitions, since the current model does not use these concepts:

- A **pole** is a frequency at which the transfer function blows up — a resonance. Every
  formant is a pole. Poles come in complex-conjugate pairs, each described by a center
  frequency and a bandwidth; bandwidth encodes loss and sets peak width and height.
- A **zero** (antiformant) is a frequency at which the transfer function goes to zero — a
  notch. Zeros arise from **side branches**: a tube hanging off the main path. At the
  frequency where the branch presents zero impedance at the junction, all flow diverts into
  it and none reaches the output.

Opening the velopharyngeal port creates exactly this branched topology, producing both extra
poles (the nasal cavity's own resonances) and zeros (from the branching).

**Coincident pole-zero technique.** A pole at frequency *f* and a zero at the same *f*
multiply to exactly 1 and cancel. So keep a nasal pole and a nasal zero permanently in the
cascade, coincident for oral sounds, and introduce nasality by **separating** them:

```
FNP = 270.0                                    # nasal pole, fixed
FNZ = lerp(270.0, 450.0, velum)                # nasal zero, separates with velum lowering
BNP = 100.0
BNZ = 100.0

B1  = lerp(B1_neutral, B1_neutral · 2.4, velum)   # 50 → ~120 Hz
gain_correction = lerp(1.0, 0.85, velum)
```

This is continuous — never switch filter sections in and out, which would click. Continuity
is required by the pedagogy, not just by DSP hygiene: the velum figure has three positions
and **mid is a real trained option** used by several qualities, twang in particular.

**Is the old bandwidth widening still needed?** Yes — keep it, but demote it. Nasal coupling
genuinely adds damping (large mucosal surface area, convoluted passages), and measured F1
bandwidths roughly double under nasalization. So it is real physics, not an approximation.
But it is a *consequence*, not the perceptual cue — listeners key on the pole-zero pair near
F1. The old implementation produced the dulling without the notch, which is why nasality
never quite convinced. Bind both to the single `velum` parameter as above.

Values are starting points; tune by ear.

### 8.2 Brightness — delete the parameter

`brightness` in the old model was a single amplitude-falloff multiplier. **It should be
removed entirely**, because it was conflating three physically distinct things:

| Old `brightness` contribution | New home | Is it a parameter? |
|---|---|---|
| Compensation for missing radiation derivative | Baked into LF (section 2) | **No** — a constant |
| Source spectral tilt | `Ra`, driven by `thyroid_tilt` | Yes, an Estill figure |
| High-frequency resonant boost | `twang` / AES cluster | Yes, an Estill figure |

The first is the reason the knob existed at all; it was a workaround for the 6 dB/octave
error. Once LF is generating the derivative, that compensation is wrong and must not be
carried forward.

**Migration hazard:** any preset carrying a `brightness` value cannot be mechanically
converted. A dark preset might have been dark via source tilt or via absent twang, and those
sound completely different. Presets need manual re-authoring. Do not write an automatic
`brightness → Ra` mapping; it will be wrong for roughly half the library.

---

## 9. Migrating from the current model

### 9.1 What changes

| Component | Current | New |
|---|---|---|
| Source spectrum | Harmonic stack, 1/f² | LF flow derivative |
| Radiation | Absent (bug) | Implicit in LF |
| F1, F2 | Variable | Variable — unchanged |
| F3 | Variable | Variable — stays a vowel target; joins the `twang` cluster only when not articulatorily held low |
| F4, F5 | **Fixed** | Driven by `twang` |
| Nasality | B1 widening | Pole-zero separation + B1 widening |
| Brightness | Falloff multiplier | **Removed** — split three ways |

### 9.2 Architecture decision: additive or time-domain

The existing model is additive (overtones of the fundamental). Two migration routes:

**(a) Stay additive.** Compute harmonic amplitudes from the LF source spectrum. Recompute
the amplitude table only when source parameters change, not per sample. Choose this if the
existing formants are implemented as spectral-envelope multiplications in an FFT or
oscillator-bank framework.

**(b) Go time-domain.** Generate the LF derivative sample by sample and feed it through
cascaded two-pole IIR resonators. Simpler, exact, and what Klatt-family synthesizers do.
Choose this if the existing formants are already IIR filters.

**Decision rule: inspect how formants are currently implemented.** IIR → route (b). Spectral
envelope → route (a). Route (b) is preferable where there is a choice; the LF numerical solve
is far easier than deriving closed-form harmonic amplitudes.

### 9.3 Suggested order of work

1. **Fix the falloff first**, before anything else. Either switch harmonic amplitudes to 1/f
   or add an explicit +6 dB/oct radiation stage. This changes how every other parameter
   sounds, so doing it late invalidates all intermediate tuning.
2. Implement LF generation with `{OQ, Rk, Ra}` exposed; verify against the reference
   waveform landmarks.
3. Add `body_cover` and `thyroid_tilt` mappings. Verify H1−H2 and tilt corner move
   independently.
4. Unfreeze F3/F4/F5 and add `twang`, including the `Ee` bonus.
5. Add `larynx_height` and `lip_protrusion` length scaling.
6. Replace nasality with the pole-zero pair.
7. Add `cricoid_tilt` as constraint relaxation. Test that Belt emerges.
8. Add onset envelopes.
9. Re-author presets by hand.

### 9.4 Quality presets — test fixtures

These verify emergence. Each should sound recognizably like its Estill quality *without any
quality-specific code path*.

| Quality | `body_cover` | `thyroid_tilt` | `cricoid_tilt` | `larynx_height` | `twang` | `velum` |
|---|---|---|---|---|---|---|
| Speech | 0.0 | 0.0 | 0.0 | 0.50 | 0.20 | 0.0 |
| Sob / Cry | 1.0 | 1.0 | 0.0 | 0.15 | 0.10 | 0.0 |
| Twang | 0.3 | 0.0 | 0.0 | 0.70 | 1.00 | 0.3 |
| Opera | 0.8 | 1.0 | 1.0 | 0.15 | 0.80 | 0.0 |
| Belt | 0.0 | 0.0 | 1.0 | 0.85 | 0.90 | 0.2 |
| Falsetto | *unavailable — requires aspiration* | | | | | |

Belt is the critical fixture: run it at `f0` = 440 Hz and confirm `OQ` stays near 0.45. If it
has drifted upward, `cricoid_tilt` is not wired as a constraint relaxation.

---

## 10. Visualization scheme

Time-domain plots are for debugging; the figures live in the frequency domain. The core
display is three stacked spectra, and its instructional value comes from the fact that **dB
is logarithmic, so panel 3 is the arithmetic sum of panels 1 and 2.** Build it so this is
visually obvious.

**Panel 1 — source spectrum.** Magnitude of dU/dt, log frequency, dB magnitude. Should show:
the glottal formant bump at `Rg·f0`; the H1−H2 balance; the tilt knee at `1/(2π·ta)` where
slope breaks from −6 to −12 dB/oct. This panel is where `body_cover`, `thyroid_tilt` and
`cricoid_tilt` are legible.

**Panel 2 — vocal tract transfer function.** The formant filter response alone, no source.
Should show F1–F5 with bandwidths, the nasal pole-zero pair, and the AES cluster. This panel
is where `twang`, `velum`, `larynx_height` and the vowel target are legible.

**Panel 3 — output spectrum.** Panel 1 + panel 2 in dB, with the harmonic comb of `f0`
overlaid so harmonic-formant alignment is visible.

Two supporting time-domain panels:

**Flow derivative, one period**, with `tp`, `te`, `ta` and `Ee` marked. Shows directly what a
shape-parameter change does to the waveform.

**Radiated pressure, several periods.** Shows formant ringing after each excitation instant —
the pressure waveform is visibly a decaying oscillation retriggered at every glottal closure.
Makes the impulse-response character of the tract obvious, and makes clear that *closure, not
opening, is the excitation.*

Plot glottal flow `U(t)` once, pedagogically, to show why the derivative is the more useful
object; then never again. Plot glottal area `A(t)` once to define OQ; then never again.

**Measurement caveat.** H1−H2 is a source property but will be measured on the output, where
F1 sits nearby and contaminates it. If this synthesizer is ever compared against recorded
voices, use the corrected measure (H1*−H2*), which subtracts the estimated formant
contribution. Without the correction, comparisons will be off by several dB.

---

## 11. Open modeling assumptions, flagged

Recorded so they are not silently "fixed" later:

1. **Independent voluntary cricoid tilt is contested** in the voice science literature. This
   model encodes a pedagogical construct, not a measured degree of freedom.
2. **Thyroid tilt is decoupled from OQ**, contrary to real larynges where they co-vary.
   Deliberate, per the orthogonality assumption.
3. **The twang `Ee` bonus is hardcoded**, not derived. A coupled source-filter model
   (Kelly–Lochbaum waveguide plus self-oscillating fold model, with glottal flow computed
   from instantaneous pressure differential) would produce it natively. That is the honest
   long-term architecture if this model's limits become binding.
4. **Larynx height is modeled as pure length scaling**, ignoring hypopharynx widening.
5. **Anchoring is assumed optimal**, which is what makes every other assumption above
   tenable.
