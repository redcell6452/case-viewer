# Case Viewer

A single-file, offline web viewer for full-disclosure case exports
(X Series / R Series / Propaq MD `.zol` files, zipped or raw).

**Repository contents:** viewer source, documentation and synthetic tests only. No ZOLL vendor software, SDKs, proprietary algorithm implementations, real cases or patient data are included. The Git ignore rules allow only explicitly reviewed project files.

**Validation status:** exploratory retrospective review software. The documented real-file
reference is one X Series export; broader device support and derived measurements are not
independently validated. See [METHODOLOGY.md](METHODOLOGY.md) for corrected errors,
remaining limitations, and the validation work still needed.

**Independent project.** Not affiliated with or endorsed by ZOLL Medical Corporation.
ZOLL, X Series, R Series and Propaq are trademarks of their respective owners and are
named here only to say which export files the viewer reads. This is retrospective review
software, not a medical device; do not use it for clinical decisions.

**Open `case-viewer.html` in a browser.** Point it at the folder your exports live in and
it remembers that folder; from then on it opens on a list of your cases. You can also just
drop a `.zol` or `.zip` on it, or use *Open a file…*.

The opening screen, case header and browser title show **Rev 2**. The revision is
defined by `APP_REVISION` in the viewer; increment it when distributing an updated file.

## Case library

The landing page lists every `.zol`, `.zip` and `.json` in the chosen folder, descending
two levels so an extracted `…​.zol/` directory is picked up too. Case date and device
serial are read straight from the filename, so listing a folder never opens an 18 MB file.

- **Sortable** on case, case date, device, size or file-modified — click a heading, click
  again to reverse.
- **Filterable** to Today, Last 7 days, Last 30 days, or a custom date range, plus a
  free-text filter on name and serial.
- **Recently opened** down the right, click to reopen, clearable. One row per case, keyed on the case id out of the file rather than on how you got to it — open the same case twice, or as a `.zol` one time and the `.zip` around it the next, and it stays a single row that moves to the top.

Click a row and the **case details** panel on the right fills in: start and stop as wall
clock, case length, monitor serial and software version, the agency, the patient
identifier and demographics, trend/shock/12-lead/pacing/treatment counts, the case's
unique id, and the file's size and path. Click **Open this case** — or double-click the
row — to actually load it.

That panel does not parse the case. It reads the first 512 KB and the last 1 MB, then
walks backwards in 4 MB steps until it finds the `CaseSummary` block, which on an hour of
monitoring sits a little over 3 MB from the end. Reading an 18 MB case takes about 20 ms,
or 60 ms for a zipped one, which has to be inflated first. Results are cached per file, so
clicking back and forth costs nothing.

The folder is remembered using the File System Access API, so the handle lives in
IndexedDB rather than local storage. Browsers deliberately drop read permission across a
reload, so the first visit of a session shows the folder name with a **Reopen folder**
button — one click and the list is back. Firefox and Safari do not implement that API; there
the page offers **Choose files…** instead, which lists a folder for the session but cannot
remember it.

Nothing is uploaded. The file is parsed entirely in the page; settings and
annotations live in that browser's local storage.

---

## Views

| Tab | What it shows |
|---|---|
| **Monitor** | Scrolling waveforms with a numerics panel, event markers, annotation bands, calipers and playback. |
| **Trends** | Whole-case charts. Parameters that share a scale are overlaid, so every heart-rate source — and every respiratory-rate source — can be compared side by side. |
| **12-Lead / Snapshots** | 12-lead acquisitions on standard ECG paper in a 3×4 layout with a rhythm strip and 1 mV calibration marks. Snapshots use the same renderer, and you can print a strip from anywhere in the continuous recording. |
| **Vitals** | Every selected parameter as a table at a chosen interval, with resizable columns, CSV export and a pop-out window. |
| **Annotations** | Your notes on time ranges, with import/export. |
| **CPR** | Resuscitation quality: the combined rate/depth quality graph, case metrics, and the stacked performance strips. |
| **Physiology** | Selectable waveforms, live arterial beat measurements at the cursor, and estimates over the selected analysis window. |
| **Analysis** | Whole-case summary: what the recording contains, vital extremes with times, notable events, the device's own determinations. Nothing here moves with the cursor. |
| **Settings** | Theme, interface size, monitor defaults, rate-averaging windows, ECG calibration, list defaults, resets. |

On Physiology, waveform filters, analysis window and sweep controls stay with the
floating traces. Extra traces scroll within that area so results remain accessible.
On short or narrow screens, this area scrolls with the page. Waveform visibility only
controls the display: cross-signal results use recorded signals, including hidden ECG
and pleth traces, and refresh as the cursor moves. Live arterial values follow each
completed beat; analysis-window summaries refresh at most once a second during playback.
Pausing or seeking refreshes those summaries immediately.

Physiology and Analysis have a collapsible **Sections** navigator that starts closed
when the review area is narrow. Click a section name to jump to it; its checkbox controls
visibility separately. Wide result tables scroll sideways within their own area.

## Parameters

The monitor stores **one** heart rate and **one** respiratory rate, each tagged with
whichever source it happened to be using. Per-source rates are therefore derived here
from the waveforms themselves:

| Parameter | Where it comes from |
|---|---|
| HR | device trend record, tagged with its source (usually ECG) |
| HR (ECG, detected) | R waves detected from the ECG waveform |
| PR (art line) | pulses detected from the invasive pressure waveform |
| PR (pleth) | pulses detected from the SpO₂ plethysmogram |
| RR | device trend record, tagged with its source |
| RR (capnogram) | breaths detected from the CO₂ waveform |
| RR (impedance) | breaths detected from a thoracic impedance waveform, when one is recorded |
| RR (vent marks) | the ventilation marks the device parsed into the CaseReview XML |
| SpO₂, PI, PVI, SpCO, SpMet, SpHb, SpOC | device trend record |
| NIBP, P1–P3 (sys/dia/MAP) | device trend record |
| EtCO₂, FiCO₂, temperatures | device trend record |

Only parameters that actually carry data in the loaded case appear. **Parameters…**
(on the numerics panel, Trends and Vitals) chooses which are shown; the choice is
shared across all three views. Averaging windows for the derived rates are in Settings.

## Playback and navigation

- **Space** play/pause · **← →** step 1 s (**Shift** 10 s) · **Home/End** ends
- **, .** previous / next event · **A** annotate · **C** calipers · **T** theme
- **E** event list · **+ −** zoom · **1**–**7** switch tabs
- Speed 0.25×–20×; sweep window 1–60 s; ECG gain 5–40 mm/mV
- **Mouse wheel over the strip** zooms about the pointer
- **Timeline**: click or drag to scrub. **Shift-drag** selects a range; double-click
  clears it. Event markers are shaped by severity — triangle for alarms, diamond for
  warnings, square for snapshots, dot for notes — and annotations fly a flag.
- The **event list carries a marker rule** at the cursor, so you can see where playback
  sits between events. It follows along while playing.
- **Hide events / Show events** in the top bar toggles the left event list; **E** does
  the same. The panel also has a **Hide** button. The desktop choice is remembered,
  and the waveforms expand into the available space. On narrow screens, the list
  starts closed and opens as an overlay.
- **Drag the grip above the transport bar** to make the bottom panel taller. The extra
  height goes to the coverage lanes, the sparklines and the marker row, which is what
  you want when hunting for an event in a long case. Double-click the grip to reset.
  The height is remembered.

## Calipers

On the **Monitor**, press **C** (or the ⟺ button) then drag across a trace. On the
**12-Lead / Snapshots** page a mouse can caliper the ECG paper straight away.

On a touch screen the calipers start **disarmed**, so a finger on a strip scrolls the
page; tap **⟺ Calipers** to arm them, and the strip stops scrolling until you tap it
again. Either way the readout gives the interval in milliseconds, the equivalent rate
per minute, and the amplitude difference in that row's own units. Double-click, or
**Clear**, to remove it.

## Strips cascade

A 10 s strip at 25 mm/s is 250 mm of paper, so strips and snapshots **wrap onto
successive rows** the way a printout does instead of running off to the right. *Per row*
defaults to whatever fits the window; you can pin it to 2.5, 5, 10 or 15 seconds. Each
row is stamped with its elapsed time, and 12-leads keep the standard 3×4 layout.

## Theme

The **T** key and the ☀/🌙 button switch between light and dark, and that choice is
remembered — the viewer reopens the way you left it. Settings → *Theme* also offers
**Follow system**, which tracks your OS preference live and is the default until you
pick a side.

## CPR

Modelled on RescueNet Case Review's *CPR Zoom* and *CPR Performance* pages:

- a **quality graph** with compression rate scattered above and depth hanging below a
  shared axis, both against their AHA target bands, over the CPR, pause, ROSC and
  AutoPulse periods, with ventilation marks and shocks;
- **case metrics** — chest compression fraction, average rate, depth and release
  velocity, and the percentage of compressions in target;
- **performance strips** — event summary, depth, rate, compressions in target, and a
  release-velocity trend banded FAST / MEDIUM / SLOW.

Targets are the adult defaults: depth 2.0–2.4 in, rate 100–120 cpm, release velocity
400+ mm/s. Click either view to move the cursor to that moment.

Periods, ventilation marks and shocks are read from the device's own parsed output in the
CaseReview XML. Compressions come from per-compression records if the export carries
them, otherwise they are detected here from a compression-depth waveform. Rate, depth and
release velocity are measurements, not a scored interpretation.

**Untested against a real arrest.** The CPR renderer and metric maths have synthetic checks. Per-compression field discovery is inferred and needs validation against an independently annotated arrest export.

## Hemodynamics

Its own tab. At the top, the arterial waveform with **checkboxes for the other invasive
lines, the EtCO₂ waveform, the pleth and the ECG** — the waveform panel stays pinned while
the tables scroll under it. Tick marks are the detected beats; blue dots are the detected
dicrotic notch, which is what ejection time and notch pressure are measured from.

The waveform has its **own view anchor**, so clicking a trace places the cursor and reads
out that instant *without sliding the view* — you can inspect beat after beat and the
picture stays still. Hovering pops up the values of every displayed channel at the pointer,
and over the arterial trace it adds that beat's systolic, diastolic, MAP, pulse pressure,
dP/dt and ejection time.

During playback, reaching the right edge advances one full sweep (for example, 0–8 s
becomes 8–16 s). Fast playback can skip multiple complete sweeps. The final page is
clamped to the end of the recording.

A **compact scrubber** sits under the waveform: drag it to travel through the case, and it
shows two spans — a blue box for what you are looking at, and a dashed green bar for the
window the numbers are measured over. Double-click it to snap back to the cursor.

**Waveform-derived → At cursor** shows the latest completed arterial beat. It updates
as new beats finish, even when the analysis window is set to the whole case. It does
not show a future beat, and clears when no recent complete beat is available or the
waveform is missing at the cursor; clipped beats are withheld.

The smaller **Window median** underneath summarises the selected **analysis window**
(30 s to 15 min ending at the cursor, or the whole case). These summaries can stay steady
across many beats. Respiratory variation and other window-based estimates retain their
required analysis windows. The **Device value** column uses trend records from that same
window. Ventilation and CVP cards refresh with it.

Everything is grouped by **provenance**, and the panel says which is which:

| Class | What it means |
|---|---|
| From the case file | The monitor recorded it — shown in its own column beside the computed value |
| Waveform-derived | The waveform is from the file; the number is measured off it here |
| Mathematically derived | Arithmetic on the above |
| Respiratory-variation | Measured across complete respiratory cycles, withheld when invalid |
| Model-estimated | A named physiologic model, not a measurement |
| Uses case inputs | Shown only when the necessary input is available |

Implemented: SBP, DBP, MAP (sample mean over each beat), PP, PP/MAP, pulse rate, pulse interval,
upstroke time, ejection time, dicrotic notch pressure, diastolic decay constant τ,
dP/dt max, systolic and diastolic AUC, PPV, SPV, DPV, SVV, and — only with a calibration
constant supplied for that case — SV, SVI, CO, CI, SVR, SVRI, Ea, CPO, CPI. Eadyn is hidden because
the SVV proxy is not independently validated. Plus BSA, and for
a ventriculostomy, mean ICP, CPP and PRx.

**Variation values are descriptive.** Physiology withholds PPV, SPV, DPV and the SVV proxy
when timing or signal checks fail. Passing these checks does not establish controlled
ventilation, adequate tidal volume, or fluid responsiveness. Clinical interpretation and
reference cutoffs are omitted for these outputs. Trends label their separate, unfiltered
cycle estimates as raw waveform/model variation and average only preceding completed
cycles. Signal quality is scored per window with flags for
clipping, noise, irregular rhythm, low pulse amplitude, absent notch, flush artefact and
over/under-damping.

**No monitor calibration is needed to use the viewer.** Absolute SV/CO and their dependent
rows are hidden unless an independently established case calibration is already supplied.
No generic calibration value is substituted. PPV and the explicitly labeled SVV proxy
remain available without absolute calibration, subject to their signal checks and limitations.

**Physiology → Optional case inputs** is collapsed by default, beside the parameter tables.
It replaces the haemodynamic input fields previously in Settings. Known height and weight
from the case are used automatically; optional overrides support BSA and indexed estimates.
A known FiO₂ entered as a percentage enables S/F ratio. An assumed CVP remains explicitly
labeled as assumed. The optional calibration field is for an independently established
value for this case, not routine calibration of a monitor.

Rows appear only when their required inputs exist, while real signal-quality failures
remain visible with reasons. Applying or clearing inputs updates the tables, parameter
choices and export selection. These inputs are saved per case; legacy global patient
overrides are ignored. ECG display scaling remains in Settings.

**Self-tests.** Settings → *Run self-tests* checks the extraction and the invalidation
rules against 25 synthetic waveforms — normal, hypo/hypertensive, narrow and wide pulse
pressure, tachy- and bradycardia, respiratory swing, fluid-responsive pattern, arrhythmia,
noise, clipping, absent dicrotic notch and low amplitude. It verifies both that values are
correct and that they are *refused* when assumptions are violated.

## Two tabs, two questions

The split matters, because a number measured over a one-minute window and a number
measured over the whole case answer different questions and should not sit side by side.

**Physiology — what are the signals doing now.** Waveforms with channel checkboxes and a
scrubber, then live arterial measurements at the cursor alongside clearly labeled
window summaries (30 s to 15 min, or the whole case). Live values follow completed beats;
whole-case summaries stay fixed.

**Analysis — what happened across the case.** Nothing on it depends on the cursor. Case
facts, an *At a glance* factual summary, monitoring coverage per channel, vital extremes
with the time each minimum and maximum occurred, notable events (alarms, desaturations,
apnoeic gaps, pauses, sensor problems, ectopy counts), NIBP-versus-line agreement, the
device's own rhythm determinations, and data-quality flags.

Both use the same sidebar: sections grouped, individually toggleable, remembered, greyed
out when there is nothing to show, click a name to jump. On Physiology it pins just below
the waveform block so it stays reachable while the parameter tables scroll under it; on a
narrow screen it collapses to the top of the page instead.

Both take a moment to build — Physiology about half a second, Analysis about eight tenths
on an hour of recording, because the whole-case pass runs beat detection over every
channel. They show a spinner saying what they are doing rather than a blank pane, and the
whole-case result is held until something it depends on changes, so toggling a section
afterwards is immediate.

## Analysis and Physiology sections

A sidebar index down the left, sections grouped **Overview / By system / Device**. Each is
individually toggleable and the choice persists; sections with nothing to show are greyed
out rather than rendering empty. Click a name to jump to it.

Every row carries its **provenance** as a coloured chip — measured, waveform-derived,
mathematically derived, respiratory-variation, multimodal, model-estimated, pattern
classification, or needing an external input — alongside the signals it came from, the
formula, a reference range where one is defensible, and the source for any threshold.

### Signals analysed

**Capnography.** Full phase segmentation (0/I/II/III, end-tidal, downstroke) after
Bhavani-Shankar. ETCO₂, FiCO₂, RR, phase II and III slopes, plateau rise normalised to
ETCO₂, **alpha and beta angles**, plateau duration, time-to-end-tidal, I:E, breath-to-breath
variability, and the longest contiguous recorded interval below 8 mmHg. Missing data
breaks this interval; low CO₂ alone does not establish apnea. Morphology is a **heuristic
classification, never a diagnosis** —
`normal_square_wave`, `obstructive_shark_fin_pattern`, `elevated_inspiratory_baseline`,
`absent_plateau`, `curare_cleft_like_pattern`, `cardiogenic_oscillations`,
`irregular_respiratory_timing`. Pattern accuracy has not been independently validated.

Angles need an aspect ratio to mean anything — a slope in mmHg/s is not geometric. The
convention used is 10 mmHg to 1 s, stated in the code, which reproduces the ~100–110°
alpha and ~90° beta described for a normal capnogram.

**Pleth.** Pulse rate, interval, amplitude, rise time, FWHM, area, notch detection, ΔPOP
respiratory variation, and a pleth-derived respiratory rate with its own confidence. The
amplitude metric is called **relative pleth amplitude index, not perfusion index** — the
export carries no DC component, so a manufacturer-equivalent PI is not reproducible. The
device's own PI is reported separately as a trend parameter.

**SpO₂.** Median, minimum, desaturation events with nadir and duration, time below each of
94/92/90/88/85/80%, hypoxaemic burden as ∫(threshold − SpO₂)dt, fastest desaturation rate,
and S/F ratio when you supply an FiO₂. Confidence is tied to pleth signal quality.

**ECG, lead-aware.** Rate, R-R, QRS duration, rhythm classification, ectopy candidates,
pauses, an AF *pattern score*, and HRV (SDNN, RMSSD, pNN50, and Lomb–Scargle LF/HF when
the window is at least five minutes and has no large timing gaps). HRV preserves the
original timestamps, uses only adjacent accepted intervals for successive differences,
and integrates spectral power over each band. Its interval filter does not verify sinus
beats, so these remain exploratory estimates. PR, QT and QTc are computed **only from a diagnostic-bandwidth
acquisition** — this file's monitoring channel is filtered 0.67–20 Hz, so they are withheld
with that as the stated reason. QRS axis needs limb leads and is withheld without a 12-lead.

**Cross-signal.** ECG→arterial and ECG→pleth **pulse arrival time** — named arrival, not
transit, because it contains the pre-ejection period. Pulse deficit (QRS complexes with no
corresponding pulse). Respiratory-rate consensus across capnogram, ventilation marks,
impedance, pleth and arterial modulation, reporting the preferred source, the spread and a
confidence. Respiratory sinus arrhythmia. And **artefact adjudication** — cross-checking the
rate sources to say which signal is probably wrong rather than believing all of them.

## Charts

- Click any chart, or its heading, to open it **isolated and much larger**. Clicking
  inside the enlarged chart moves the cursor to that time.
- Hovering a chart shows a **readout** of every visible series at that instant; with no
  pointer over it, the readout follows the playback cursor.
- **Peak values** labels the prominent peaks and troughs.
- **Mean lines** and **Trend lines** overlay each parameter's mean and least-squares
  fit; the legend reports the mean and the slope per hour with a direction arrow.
- **Clicking a legend key hides or shows that series** without removing it from the
  selection. **Reset view** brings everything back.

## Annotating

Select a range on the timeline, press **A**, then give it a category, colour and note.
Without a selection, **A** annotates ±5 s around the cursor. Bands appear on the
timeline, the waveform view and the trend charts.

Notes are keyed to the case id and stored in the browser, so they survive reloads but
are per-browser. **Export JSON** keeps them beside the case file; **Import JSON** brings
them back or shares them.

## Exports

Events → CSV · Trends and vitals → CSV · Annotations → JSON or CSV ·
Current strip → PNG · ECG-paper strips and 12-leads → PNG.

---

## Rhythm analysis, and what this viewer will not do

The **Analysis** tab has a *Device rhythm analysis* section. That section replays what
the monitor itself decided during the case — its life-threatening-arrhythmia state, its
AED shock/no-shock determinations, its alarm events. Those are the outputs of the
manufacturer's cleared algorithms, recorded at the time.

This viewer does **not** attempt its own diagnostic rhythm interpretation, and it cannot
give you an FDA-cleared one. Three reasons:

1. Manufacturers' cleared interpretation algorithms are proprietary and licensed under contract as
   native components. They are not redistributable inside an HTML file.
2. Clearance attaches to an algorithm running on specific hardware with specific
   signal-acquisition characteristics, not to the algorithm in the abstract. Lifting one
   into a different environment would void the basis of its clearance, so the result
   could not honestly be called cleared.
3. Software that analyses physiological signals to produce a diagnostic conclusion is
   generally a regulated medical device in its own right. A retrospective review and
   annotation tool is not.

Everything this viewer computes is therefore **measurement, not interpretation** —
intervals, amplitudes, slopes, ratios, counts. It is labelled as derived wherever it
appears. Use it to review a case; use the device's own record for what the device
decided.

## Invasive pressure lines

Systolic/diastolic, pulse-pressure variation and damping only mean something on an
arterial trace — a central venous line or a ventriculostomy has to be read as a mean.
The monitor labels channels `P1`–`P3` until someone sets a site, so the Analysis tab
**infers the site from the waveform and lets you override it**. What you get depends on
the site:

- **Arterial / aortic / umbilical arterial / pulmonary artery** — beat-by-beat systolic,
  diastolic and pulse pressure; dP/dt max; systolic pressure variation and pulse
  pressure variation measured across the respiratory cycle; a fast-flush (square-wave)
  test with natural frequency and damping coefficient when a flush is present in the
  recording; and a check of measured MAP against (S+2D)/3.
- **Central venous / right or left atrial / umbilical venous** — mean pressure and pulse
  amplitude.
- **Intracranial (ventriculostomy)** — mean ICP and pulse amplitude, plus derived
  cerebral perfusion pressure when an arterial line is also recorded.

A note on the fast-flush test: resolving the ringing needs several samples per
oscillation. At the 125 Hz these files store, anything above roughly 25 Hz is beyond
what the recording can describe, and the viewer says so rather than printing a number
the data cannot support.

## Capnogram

Per breath: EtCO₂, inspired CO₂ baseline, phase III (alveolar plateau) slope in
mmHg/s and as a percentage rise across the plateau, alpha angle, I:E ratio, and a count
of plateau clefts. Respiratory-interval scatter is reported too, since a machine-regular
rate and a patient-triggered one look very different.

---

## Notes on the data

- **Pre-case event logs are filtered.** A `.zol` can carry the monitor's rolling log from
  previous days and previous patients. Event-log entries before the *New Patient*
  marker are filtered, with one exception kept deliberately: **self-tests from the same
  calendar day**, which document that the device was serviceable when it was picked up.
  The Analysis tab reports how many event records were dropped. This does not currently
  trim waveform, trend and snapshot payloads; see the remaining case-boundary limitation
  in [METHODOLOGY.md](METHODOLOGY.md).
- **Background rhythm analysis is filed separately.** The monitor runs a continuous
  analysis every few seconds all case long. Those go behind the *Device log* chip so the
  real events stay visible.
- **NIBP.** Trend records repeat the last cuff reading on every row and leave `IsNew`
  latched true, so distinct measurements are identified by their own `Nibp/Time` stamp.
  Charts plot one dot per actual reading; the numerics tile holds the last reading with
  the time it was taken and never greys out.
- **Timebase.** `DevDateTime` (1 s resolution) is the anchor; `MsecTime` adds sub-second
  precision but belongs to a per-subsystem counter, so it is only trusted when the two
  agree. `ElapsedTime` is left at 0 on some record types and is the last resort.
- **Scaling.** Pressure, CO₂ and SpO₂ channels use the `DataChannels` scalars from the
  file. The ECG family uses a different convention, so **100 counts = 1 mV** is assumed —
  that puts this amplifier's ±2500-count range at ±25 mV and gives clinically sensible
  lead II amplitudes. It is adjustable in Settings, and changing it rescales the loaded
  case exactly. Perfusion index is stored in tenths of a percent; temperatures are
  assumed to be in tenths of a degree.
- **Drawing.** Zoomed out, each pixel column shows the min/max of the samples under it so
  peaks survive. Zoomed in past one sample per pixel, the samples themselves are plotted —
  binning there would render a continuous trace as a dashed line.

## File format

Fully documented in **[FORMAT.md](FORMAT.md)** — container layout, every record type with
its `RecId`, the three disagreeing clocks, channel scaling, the trend quirks, the rolling
device log, and a parsing checklist.

```
[uint32 LE jsonLen][JSON, UTF-8][uint32 LE xmlLen][CaseReview XML, UTF-16LE + BOM]
```

The JSON half holds `ZOLL.FullDisclosure[].FullDisclosureRecord[]` — one single-key
object per record (`ContinWaveRec`, `TrendRpt`, `AnnotationEvt`, `AlarmEvt`,
`SnapshotRpt`, `AedContinAnalysis`, `CaseSummary`, …). The XML half is the RescueNet
Case Review index and carries the parsed ventilation marks, CPR/ROSC periods and case id.

Raw `.zol`, zipped `.zol`, and a bare JSON export all load.

## On a phone

Below 900px the layout collapses to a single column: the event list becomes a full-screen
overlay opened with **Show events**, secondary controls tuck behind **⋯**, and the monitor page scrolls
— waveforms on top, numerics flowing underneath.

The shell is sized in `dvh` so the transport bar cannot be pushed under the browser
chrome, and that height is divided by the interface zoom so scaling stays exact. Only
two things deliberately capture touch: the timeline, which is a scrubber, and an armed
caliper. Everything else scrolls and pans normally, and a strip wider than the screen
can be panned sideways.

## Requirements

Any current Chrome, Edge, Firefox or Safari, on desktop or phone. ZIP inflation uses the
built-in `DecompressionStream`; if a browser lacks it, unzip first and drop the `.zol`.

Input files and expanded cases are limited to 256 MiB. ZIP imports validate directory
bounds, declared sizes and CRC-32, and support stored or deflated entries. ZIP64,
multi-disk and encrypted archives are rejected. Raw JSON may begin with a BOM or whitespace.
Annotation imports validate ranges and case IDs, sanitize attribute fields, and reject
malformed input before adding any notes.

## Regression checks

With Node.js 24.2 or later, run `node --test tests/regression.cjs`. No packages need to be
installed. The suite includes the 25 built-in arterial checks plus parser, annotation,
windowing, case-isolation, HRV, capnography and synthetic integration regressions.
Synthetic success verifies these scenarios, not accuracy on real clinical recordings.

## License

[MIT](LICENSE), copyright © 2026 Case Viewer contributors. The complete notice is
also embedded in `case-viewer.html` so it travels with the standalone viewer.
The license text follows the [Open Source Initiative MIT license](https://opensource.org/license/mit).
