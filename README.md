# Case Viewer

A single-file, offline web viewer for full-disclosure case exports
(X Series / R Series / Propaq MD `.zol` files, zipped or raw).

**Your case files never leave your computer.** Files are opened and analysed entirely in your browser; nothing is uploaded or sent anywhere. This is enforced, not just promised: the page carries a Content-Security-Policy that blocks every network connection (`connect-src 'none'`), so even a bug couldn't send data out. Once loaded, it works with no connection. Settings and annotations stay in your browser's own storage.

**Repository contents:** viewer source, documentation and synthetic tests only. No ZOLL vendor software, SDKs, proprietary algorithm implementations, real cases or patient data are included. The Git ignore rules allow only explicitly reviewed project files.

**Validation status:** exploratory retrospective review software. The documented real-file
reference is one X Series export; broader device support and derived measurements are not
independently validated. See [METHODOLOGY.md](METHODOLOGY.md) for corrected errors,
remaining limitations, and the validation work still needed.

**Independent project.** Not affiliated with or endorsed by ZOLL Medical Corporation.
ZOLL, X Series, R Series and Propaq are trademarks of their respective owners and are
named here only to say which export files the viewer reads. This is retrospective review
software, not a medical device; do not use it for clinical decisions.

**AI disclosure.** AI was used to help develop this tool and to review its code and
algorithms. That review does not change the validation status described above.

**Open `case-viewer.html` in a browser.** Point it at the folder your exports live in and
it remembers that folder; from then on it opens on a list of your cases. You can also just
drop a `.zol` or `.zip` on it, or use *Open a file…*.

The opening screen, case header and browser title show **Rev 3**. The revision is
defined by `APP_REVISION` in the viewer; increment it when distributing an updated file.

Across the top of a loaded case: **Local only** explains how the page is kept offline;
**ⓘ** opens the case details in full (timing, device, patient, contents); the theme
switch; **Open…** returns to the case list (so does clicking the title); **GitHub**; and
**Changelog**, a dated list of what changed in each update. On a phone, GitHub and the
changelog are under Settings › Project.

Monitor waveform choices are remembered between cases and browser sessions; new
continuous channels start visible. Leads recorded only during a 12-lead start hidden in
every case (ticking one is a one-off look at that acquisition). Selecting an event puts
its start at the left edge of the strip; the strip holds still until the playhead reaches
its usual place and then scrolls normally. Selecting a snapshot pauses playback and opens that exact acquisition; Play returns
to the view you were using. A matched or estimated 12-lead start is used when available.

## Case library

**Sample cases.** The start page always offers two made-up cases, *Cardiac arrest* and
*Neuro critical care*, so you can try every view without a real file. They are built on
your computer when you open one (nothing is downloaded), and **What to look for** shows
what the viewer should find in each. **Hide** tucks them away; a link brings them back.
The start page also has the light/dark toggle, **GitHub** and **Changelog**.

The landing page lists every `.zol`, `.zip` and `.json` in the chosen folder, descending
two levels so an extracted `…​.zol/` directory is picked up too. Case date and device
serial are read straight from the filename, so listing a folder never opens an 18 MB file.

- **Sortable** on case, case date, device, size or file-modified — click a heading, click
  again to reverse.
- **Filterable** to Today, Last 7 days, Last 30 days, or a custom date range; by tag; by
  reviewed or not; and to only cases never opened (they also show a dot). The search box
  covers the name, serial, tags, and the patient ID, unit and agency once the preview has
  read them.
- **Tags and a reviewed mark** for each case, set in the side panel or in an open case's
  Case details (ⓘ). They are kept in this browser and included in settings backups.
- **CPR trend report** reads every case in the folder (or files you choose), on this
  computer, and reports arrests and ROSC with average CPR quality by month, quarter or
  year against your targets: compressions in target, depth, rate, release velocity,
  compression fraction and the pre- and post-shock pauses. Filter by tag, age group or
  reviewed cases, and export CSV. Results are cached, so re-runs read only new files.
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
| **Monitor** | Scrolling waveforms with a numerics panel (pressures as sys/dia (MAP), alarming values boxed, ⓘ on each), line-zeroing flags on the pressure rows, event markers, sticky notes and annotation bands, calipers with march-out, and playback. Pacer pulses the monitor detected are marked on the ECG traces (**Pacer** button, shown when a case has any). The **Whole-case ECG** tab on top of the playback bar (or **Overview**, or **O**) pops up the whole case's ECG folded into rows, with CPR, pauses, shocks, treatments and alarms marked; click or drag anywhere on it to scrub the playhead, and drag its top edge to resize it. From the keyboard, tab to the panel: ← → move 1 s (Shift 10 s), ↑ ↓ a row, Page Up / Page Down five rows, Home / End the ends; its top edge also takes focus, and ↑ ↓ resize it (Home resets). It stays open across tabs and follows the playhead during playback. |
| **Trends** | Whole-case charts. Parameters that share a scale are overlaid, so every heart-rate source — and every respiratory-rate source — can be compared side by side. |
| **Physiology** | Selectable waveforms, live arterial beat measurements at the cursor, and estimates over the selected analysis window. |
| **12-Lead / Snapshots** | 12-lead acquisitions on standard ECG paper in a 3×4 layout with a rhythm strip and 1 mV calibration marks. Snapshots use the same renderer, and you can print a strip from anywhere in the continuous recording. Under each 12-lead, the viewer's own ST-J level in every lead (red at the usual elevation thresholds, amber at depression) and the P, QRS and T axes. |
| **Vitals** | Every selected parameter as a table. Opens on the monitor's own NIBP auto cycle when the case records one (each row on that cycle's cuff reading, with P1–P3 alongside), otherwise at a chosen interval. Resizable columns, CSV export and a pop-out window. |
| **Annotations** | Your sticky notes and annotated time ranges, with import/export. |
| **CPR** | Resuscitation quality, coloured against the AHA targets (green in target, amber half, red out): a rate/depth quality graph that follows the playhead like the Monitor (window choice, drag or wheel to scroll), case metrics, a **summary** (pads-on, first-compression and first-shock times; compression fraction; depth and rate split too low / in target / too high; pauses by length and the longest; pre- and post-shock pauses), a **cascade** with one row per minute of CPR, and the stacked performance strips. Shocks are marked boldly on every view, and treatments logged on the monitor (Epinephrine, IV Access, Intubation, Other and the rest) as purple markers, labelled on the quality graph. Waveform rows sit above the quality graph on the same time scale: the ECG from the pads (or the monitor's ECG lead) and CO₂ by default; add or remove ECG leads, the SpO₂ pleth, pressures and the rest with **Add waveform…**. The Monitor's parameter panel sits beside the graph, with the same **Parameters…** choice. Hover anywhere on the graph for what's under the pointer (the nearest compression's rate, depth and release, any pause, shock or ROSC, the last 10 s in target, ventilations and the perfusion estimate), and the parameter panel shows that moment. A live **dashboard** under the graph shows rate, depth and release velocity at the playhead, a pause timer, and a diamond showing a **perfusion proxy**: a model reconstructed from compression depth, rate, release and pauses that climbs toward the quality being delivered (time constant 5 s) and falls quickly when compressions stop (time constant 3.6 s, about a quarter left after 5 s). A shock doesn't reset it; the hands-off time around the shock is what lowers it. It is not a measured pressure, not coronary perfusion pressure, not a chance of ROSC and not the monitor's own indicator, and it is marked as adult-derived on child, infant and newborn cases. The constants and the four studies they were scaled from (Mader 2009, Berg 2001, Yin 2024, Yannopoulos 2005; listed under Sources) are set out in the code beside the model. |
| **Analysis** | Whole-case summary: what the recording contains, vital extremes with times, notable events, the device's own determinations. Nothing here moves with the cursor. **Case features** lists the vitals and waveforms recorded, CPR, shocks advised and delivered, 12-leads, pacing, ROSC, and which parameters alarmed high or low. |
| **Settings** | Theme, interface size, monitor defaults, rate-averaging windows, ECG calibration, list defaults, resets. Back up and restore your settings as a file. The viewer remembers its setup between runs. **CPR targets** default to the 2025 AHA guidelines (ACLS, PALS, NRP), with the age group taken from the monitor's mode and the patient's age; depth in inches or cm. |
| **Formulas** | Every measure the viewer calculates or explains, searchable and with an A–Z index (abbreviations included): what it is, how to read it, the formula used, and links to a readable explanation and the original source. The same explanations open from the ⓘ next to a measure anywhere in the viewer. |

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
- **, .** previous / next event · **A** annotate · **C** calipers · **M** march-out calipers · **T** theme
- **E** event list · **+ −** zoom · **1**–**9** switch tabs (Monitor through Settings)
- Buttons a key toggles show that key in parentheses, e.g. **March (M)**; the hints are
  hidden on touch screens
- Speed 0.25×–20×; sweep window 1–60 s; ECG gain 5–40 mm/mV
- **Drag the strip** left or right to move through the recording, like pulling paper
  (dragging right goes back in time); the **mouse wheel** over the strip does the same
- **Point at the strip** (while paused) and the parameter panel shows the values at
  that moment, the way the Trends page does; **click** to pin them there. The time being
  read is tagged on the time axis and the panel is outlined; nothing in the panel moves.
  Playing, moving the playhead, **Back to playhead** (over the strip) or **Esc** returns
  the panel to the playhead. Clicking while playing pauses and pins.
- The **parameter panel** fits itself to the fewest columns (one, two or three) that show
  every chosen parameter, up to half the strip's width. Drag its left edge to set the width
  yourself; it switches columns as it passes each width, and the width is remembered.
  Double-click the edge to go back to automatic. Related parameters share a row: the heart
  rates together, the pulse rates together, the pressures together.
- **Alarming parameters are boxed** in the parameter panel: **red** when the monitor
  flagged the value as in alarm, or an alarm it raised is still past the crossed limit;
  **yellow** for an equipment alert on that sensor (probe off, check probe, lead fault,
  transducer disconnected) until a valid reading returns or it is reconnected. The file
  does not store which colour the monitor itself used, so this is the viewer's reading.
  **Flash** on the toolbar turns the flashing on or off; boxes stay either way.
- **Timeline**: click or drag to scrub. **Shift-drag** selects a range; double-click
  clears it. Event markers are shaped by severity — triangle for alarms, diamond for
  warnings, square for snapshots, dot for notes — and annotations fly a flag.
- The **event list carries a marker rule** at the cursor, so you can see where playback
  sits between events. While playing it moves down the list, and when it reaches the
  bottom the list turns the page so the marker starts again at the top.
- The **event-list button** at the left of the tab row, beside Monitor, shows or hides
  the left event list; **E** does the same. The desktop choice is remembered,
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

Drag an upright to resize a caliper, or the space between them to slide it. **March**
(or **M**) walks the caliper along the trace: the measured interval is repeated as faint
uprights across the whole row, the way a paper caliper is stepped along a rhythm strip.
Line the first pair up on two R waves; beats that stay on the marks are regular, and
beats that drift off them are not. March stays on until you turn it off.

## Strips cascade

A 10 s strip at 25 mm/s is 250 mm of paper, so strips and snapshots **wrap onto
successive rows** the way a printout does instead of running off to the right. *Per row*
defaults to whatever fits the window; you can pin it to 2.5, 5, 10 or 15 seconds. Each
row is stamped with its elapsed time, and 12-leads keep the standard 3×4 layout.

## Theme

The **T** key and the ☀/🌙 button switch between light and dark, and that choice is
remembered — the viewer reopens the way you left it. Settings → *Theme* also offers
**Follow system**, which tracks your OS preference live and is the default until you
pick a side. In light mode every trace and parameter colour is darkened until it reads at about 5:1
against white, so yellows and cyans (NIBP, SpO₂) stay legible.

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

**Physiology → Optional case inputs** starts open beside the parameter tables, so it is easy to find; if you close it, it stays closed.
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

On the Monitor, click **＋ Annotate** (or press **A**), then click the waveform where the
note belongs: a sticky note is pinned to that trace at that moment, and you give it a
category, colour and text. Drag a note to move it; click it to edit or delete it. While
placing, **Enter** drops the note at the playhead and **Esc** cancels.

To annotate a stretch of time instead, **Shift-drag** a range on the timeline and press
**A**; on the other views **A** annotates ±5 s around the cursor. Ranges show as bands on
the timeline, the waveform view and the trend charts; notes show as flags on the timeline.

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
Lines keep the monitor's names, `P1`–`P3`, everywhere in the viewer, with their type
beside the name (for example **P2 PA**). The type comes from, in order:

1. **Your choice**: the drop-down beside the name in the line's box in the parameter panel
   (on the Monitor and CPR pages), or the picker on Physiology. It is kept for that case;
   the drop-down's first entry (Automatic) undoes it.
2. **The monitor's label**, when the line was given a site on the monitor (ART, PA, CVP,
   ICP and the rest).
3. **A guess from the waveform** when the monitor left the line as `P1`–`P3` (as it does
   until someone sets a site): a clearly arterial or clearly venous trace is typed as such
   and always marked as a guess ("Art (guess)", or "Art?" where space is short). Anything
   unclear, such as a pulmonary artery trace, stays "type not set" until you choose.

The type sets how a line reads on the parameter panel (an arterial or pulmonary artery
line as systolic/diastolic (mean), a venous or intracranial line as its mean) and which
results it feeds. What you get depends on the type:

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

- **Patient boundaries apply before analysis.** A `.zol` can carry records from previous
  days and patients. The viewer uses the in-case *New Patient* marker, or case time zero
  when none is present. It trims waveform samples, filters trends (including repeated
  earlier cuff readings), pacing and ventilation marks, and clips CPR periods. Earlier
  snapshots and snapshots whose samples may cross the boundary are withheld. The Analysis
  tab reports exclusions. Same-day self-tests remain in the **device log** only. Exports
  with multiple distinct in-case *New Patient* markers are rejected: open a separate export
  for each patient. These rules have synthetic regression coverage; the device timing
  limitations in [METHODOLOGY.md](METHODOLOGY.md) still apply.
- **SpO₂ gaps are unobserved time.** Events and burden use the same valid sampling
  intervals. Invalid readings or gaps exceeding 1.5 times the median recorded cadence
  (never more than two minutes) break continuity. Values are not extended beyond the
  final observation. The event list reports supported duration, unobserved time, and
  whether recovery was observed. Durations remain estimates between discrete readings.
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
- **Scaling.** Every channel uses the `DataChannels` scalars from the file. For the ECG
  family the scalar is nanovolts per count (2500 nV = 400 counts per mV), which the
  12-lead record confirms with its own amplitude field. An assumed value is used only
  when a file states no scale. It is adjustable in Settings, and changing it rescales the
  loaded case exactly; 12-lead acquisitions carry their own scale and are not affected. Perfusion index is stored in tenths of a percent; temperatures are
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
overlay opened with the event-list button at the left of the tab row, secondary controls tuck behind **⋯**, and the monitor page scrolls
— waveforms on top, numerics flowing underneath.

The shell is sized in `dvh` so the transport bar cannot be pushed under the browser
chrome, and that height is divided by the interface zoom so scaling stays exact. Only
a few things deliberately capture touch: the timeline, which is a scrubber; an armed
caliper or note placement; and a sideways drag on the Monitor strip, which moves through
the recording (an up-down swipe still scrolls the page). Everything else scrolls and pans normally, and a strip wider than the screen
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
windowing, case-isolation, HRV, capnography, caliper, sticky-note, alarm-box, changelog
and synthetic integration regressions.
Synthetic success verifies these scenarios, not accuracy on real clinical recordings.

Browser checks: `node tests/browser.cjs`. Nothing needs installing: it drives an installed
Edge or Chrome headless over the DevTools protocol with Node's built-in WebSocket (Node 22
or later); set `BROWSER_EXECUTABLE` to choose the browser. It uses a throwaway profile on a
port the system picks, and closes the browser and deletes the profile when done. The checks
use generated, anonymous data and real mouse and keyboard input: opening the child sample
from the start page (child CPR targets and the adult-derived warning), saved waveform
choices across cases and reloads, exact snapshot selection, pause on a 12-lead and resume to
the previous view, event positioning on Monitor and Physiology, the whole-case ECG panel
(drag to scrub, keyboard stepping, keyboard resize), a narrow screen, and recovery after a
rejected import. Set `BROWSER_SCREENSHOT=path.png` to save the desktop and narrow results.

## Synthetic test cases

These are the same three cases the start page offers as samples: the generator is
`synthCase()` inside `case-viewer.html`, and the command-line tool runs that code.

`node tools/make-test-case.cjs` writes `test-cases/synthetic-cardiac.zol`, a made-up
30-minute case (no real patient or device) that exercises every view and algorithm:
sinus rhythm with sinus arrhythmia, AF with a pulse deficit, a lead switch, bradycardia
with a pause, external pacing, VF with CPR, a shock and ROSC, ventilated pulse-pressure
variation, a desaturation, a bronchospasm-shaped capnogram, apnoea, probe disconnects,
NIBP readings, alarms, a zeroing and fast-flush test, 12-leads and snapshots, and treatments
logged during the arrest (IV access, epinephrine, amiodarone, intubation, other). Its lines are
P1 arterial and P3 CVP, both unlabelled on the monitor (so typed as guesses), and P2, which the
monitor labels PA, with two temperatures. `--neuro` writes `synthetic-neuro.zol`
instead: arterial and CVP lines (unlabelled) and an ICP line the monitor labels ICP (CPP, and
PRx that is negative before the arrest and positive after ROSC) and an ECG recorded at
diagnostic bandwidth so PR and QT are measured.
`--child` writes `synthetic-child.zol`: the cardiac story in a 7-year-old, with the monitor in
Pediatric mode, child heart rates, pressures and alarm limits, a 100 J shock, breathing at
20/min and compressions to the child depth, so the CPR page uses the Child (PALS) targets and
shows the perfusion proxy's adult-derived warning. Its only lines are P1 arterial and P2 CVP,
both unlabelled: no pulmonary artery catheter and no P3.

`--new-patient-at <seconds>` (with any of the above, plus `--out`) logs the New Patient marker
at that time instead of at the start, so everything before it belongs to an earlier patient
and must be excluded: waveforms, trend rows, alarms, events and snapshots. The regression
tests use this to check the patient boundary on a whole case.

Each case comes with `<name>.expected.md`, a timeline of what happens and what the viewer
should find. The output is seeded, so it is the same on every run.

## Sources

Published sources behind the methods, formulas and thresholds the viewer uses. The same list, with what each is used for, is in the viewer under **Settings › Sources**, each result in the Physiology tab links its own, and the CPR tab links its targets. Links are DOIs, checked against the title and authors; the two that are not DOIs are the issuing body's own page. Where the original has no DOI (Bazett 1920), the link is to its reprint.

- Bhavani-Shankar K et al. Terminology and the current limitations of time capnography: a brief review. J Clin Monit 1995;11(3):175-82. [10.1007/BF01617719](https://doi.org/10.1007/BF01617719) (used for capnogram phases, angles and EtCO₂)
- Nik Hisamuddin NA et al. Correlations between capnographic waveforms and peak flow meter measurement in emergency department management of asthma. Int J Emerg Med 2009;2(2):83-9. [10.1007/s12245-009-0088-9](https://doi.org/10.1007/s12245-009-0088-9) (used for phase III slope)
- Kodali BS, Urman RD. Capnography during cardiopulmonary resuscitation: current evidence and future directions. J Emerg Trauma Shock 2014;7(4):332-40. [10.4103/0974-2700.142778](https://doi.org/10.4103/0974-2700.142778) (used for EtCO₂ during CPR)
- Cannesson M et al. Pleth variability index to monitor the respiratory variations in the pulse oximeter plethysmographic waveform amplitude and predict fluid responsiveness in the operating theatre. Br J Anaesth 2008;101(2):200-6. [10.1093/bja/aen133](https://doi.org/10.1093/bja/aen133) (used for pleth amplitude and its variation)
- Cannesson M et al. Respiratory variations in pulse oximetry plethysmographic waveform amplitude to predict fluid responsiveness in the operating room. Anesthesiology 2007;106(6):1105-11. [10.1097/01.anes.0000267593.72744.20](https://doi.org/10.1097/01.anes.0000267593.72744.20) (used for ΔPOP)
- Nilsson LM. Respiration signals from photoplethysmography. Anesth Analg 2013;117(4):859-65. [10.1213/ANE.0b013e31828098b2](https://doi.org/10.1213/ANE.0b013e31828098b2) (used for pleth pulse and breathing rate)
- US FDA. Pulse oximeters: accuracy and limitations (device information page). [fda.gov/medical-devices/products-and-medical-procedures/pulse-oximeters](https://www.fda.gov/medical-devices/products-and-medical-procedures/pulse-oximeters) (used for SpO₂ accuracy limits)
- Kligfield P et al. Recommendations for the standardization and interpretation of the electrocardiogram: part I. Circulation 2007;115(10):1306-24. [10.1161/CIRCULATIONAHA.106.180200](https://doi.org/10.1161/CIRCULATIONAHA.106.180200) (used for ECG intervals, QRS width, axis)
- Rautaharju PM et al. AHA/ACCF/HRS recommendations for the standardization and interpretation of the electrocardiogram: part IV: the ST segment, T and U waves, and the QT interval. Circulation 2009;119(10):e241-50. [10.1161/CIRCULATIONAHA.108.191096](https://doi.org/10.1161/CIRCULATIONAHA.108.191096) (used for QT and QTc)
- Bazett HC. An analysis of the time-relations of electrocardiograms. Heart 1920;7:353-70 (reprinted Ann Noninvasive Electrocardiol 1997;2(2):177-94). [10.1111/j.1542-474X.1997.tb00325.x](https://doi.org/10.1111/j.1542-474X.1997.tb00325.x) (used for QTc (Bazett))
- Fridericia LS. Die Systolendauer im Elektrokardiogramm bei normalen Menschen und bei Herzkranken. Acta Med Scand 1920;53(1):469-86. [10.1111/j.0954-6820.1920.tb18266.x](https://doi.org/10.1111/j.0954-6820.1920.tb18266.x) (used for QTc (Fridericia))
- Pan J, Tompkins WJ. A real-time QRS detection algorithm. IEEE Trans Biomed Eng 1985;32(3):230-6. [10.1109/TBME.1985.325532](https://doi.org/10.1109/TBME.1985.325532) (used for QRS detection approach (slope-energy envelope))
- Task Force of the ESC and NASPE. Heart rate variability: standards of measurement, physiological interpretation and clinical use. Circulation 1996;93(5):1043-65. [10.1161/01.CIR.93.5.1043](https://doi.org/10.1161/01.CIR.93.5.1043) (used for SDNN, RMSSD, pNN50, LF/HF)
- PhysioNet. lomb: estimate power spectrum using the Lomb periodogram method (WFDB Applications Guide). [physionet.org/physiotools/wag/lomb-1.htm](https://physionet.org/physiotools/wag/lomb-1.htm) (used for LF/HF from uneven beat intervals)
- Mukkamala R et al. Toward ubiquitous blood pressure monitoring via pulse transit time: theory and practice. IEEE Trans Biomed Eng 2015;62(8):1879-901. [10.1109/TBME.2015.2441951](https://doi.org/10.1109/TBME.2015.2441951) (used for pulse arrival time)
- Gardner RM. Direct blood pressure measurement: dynamic response requirements. Anesthesiology 1981;54(3):227-36. [10.1097/00000542-198103000-00010](https://doi.org/10.1097/00000542-198103000-00010) (used for flush test, damping and natural frequency)
- Michard F et al. Relation between respiratory changes in arterial pulse pressure and fluid responsiveness in septic patients with acute circulatory failure. Am J Respir Crit Care Med 2000;162(1):134-8. [10.1164/ajrccm.162.1.9903035](https://doi.org/10.1164/ajrccm.162.1.9903035) (used for PPV)
- Perel A et al. Systolic blood pressure variation is a sensitive indicator of hypovolemia in ventilated dogs subjected to graded hemorrhage. Anesthesiology 1987;67(4):498-502. [10.1097/00000542-198710000-00009](https://doi.org/10.1097/00000542-198710000-00009) (used for SPV and DPV)
- Sun JX et al. The cardiac output from blood pressure algorithms trial. Crit Care Med 2009;37(1):72-80. [10.1097/CCM.0b013e3181930174](https://doi.org/10.1097/CCM.0b013e3181930174) (used for stroke volume from the pressure waveform)
- Liljestrand G, Zander E. Vergleichende Bestimmungen des Minutenvolumens des Herzens beim Menschen mittels der Stickoxydulmethode und durch Blutdruckmessung. Z Gesamte Exp Med 1928;59:105-22. [10.1007/BF02608853](https://doi.org/10.1007/BF02608853) (used for SV = k·PP/(SBP+DBP))
- Kelly RP et al. Effective arterial elastance as index of arterial vascular load in humans. Circulation 1992;86(2):513-21. [10.1161/01.cir.86.2.513](https://doi.org/10.1161/01.cir.86.2.513) (used for Ea)
- Chen CH et al. Noninvasive single-beat determination of left ventricular end-systolic elastance in humans. J Am Coll Cardiol 2001;38(7):2028-34. [10.1016/s0735-1097(01)01651-5](https://doi.org/10.1016/s0735-1097(01)01651-5) (used for Ea ≈ 0.9·SBP/SV)
- Monge García MI et al. Dynamic arterial elastance as a predictor of arterial pressure response to fluid administration: a validation study. Crit Care 2014;18(6):626. [10.1186/s13054-014-0626-6](https://doi.org/10.1186/s13054-014-0626-6) (used for Eadyn (withheld here))
- Monnet X et al. ESICM guidelines on circulatory shock and hemodynamic monitoring 2025. Intensive Care Med 2025;51(11):1971-2012. [10.1007/s00134-025-08137-z](https://doi.org/10.1007/s00134-025-08137-z) (used for dynamic indices and their limits)
- Fincke R et al. Cardiac power is the strongest hemodynamic correlate of mortality in cardiogenic shock: a report from the SHOCK trial registry. J Am Coll Cardiol 2004;44(2):340-8. [10.1016/j.jacc.2004.03.060](https://doi.org/10.1016/j.jacc.2004.03.060) (used for cardiac power output (MAP×CO/451))
- Du Bois D, Du Bois EF. A formula to estimate the approximate surface area if height and weight be known. Arch Intern Med 1916;17(6_2):863-71. [10.1001/archinte.1916.00080130010002](https://doi.org/10.1001/archinte.1916.00080130010002) (used for BSA (DuBois))
- Mosteller RD. Simplified calculation of body-surface area. N Engl J Med 1987;317(17):1098. [10.1056/NEJM198710223171717](https://doi.org/10.1056/NEJM198710223171717) (used for BSA (Mosteller))
- Allgöwer M, Burri C. Schockindex. Dtsch Med Wochenschr 1967;92(43):1947-50. [10.1055/s-0028-1106070](https://doi.org/10.1055/s-0028-1106070) (used for shock index)
- Gobel FL et al. The rate-pressure product as an index of myocardial oxygen consumption during exercise in patients with angina pectoris. Circulation 1978;57(3):549-56. [10.1161/01.cir.57.3.549](https://doi.org/10.1161/01.cir.57.3.549) (used for rate-pressure product)
- Czosnyka M et al. Continuous assessment of the cerebral vasomotor reactivity in head injury. Neurosurgery 1997;41(1):11-7. [10.1097/00006123-199707000-00005](https://doi.org/10.1097/00006123-199707000-00005) (used for PRx)
- Carney N et al. Guidelines for the management of severe traumatic brain injury, fourth edition. Neurosurgery 2017;80(1):6-15. [10.1227/NEU.0000000000001432](https://doi.org/10.1227/NEU.0000000000001432) (used for CPP)
- Rice TW et al. Comparison of the SpO2/FIO2 ratio and the PaO2/FIO2 ratio in patients with acute lung injury or ARDS. Chest 2007;132(2):410-7. [10.1378/chest.07-0617](https://doi.org/10.1378/chest.07-0617) (used for S/F ratio)
- Panchal AR et al. Part 3: Adult basic and advanced life support: 2020 American Heart Association guidelines for CPR and ECC. Circulation 2020;142(16 suppl 2):S366-S468. [10.1161/CIR.0000000000000916](https://doi.org/10.1161/CIR.0000000000000916) (used for CPR rate and depth targets)
- Kovacs A et al. Chest compression release velocity: association with survival and favorable neurologic outcome after out-of-hospital cardiac arrest. Resuscitation 2015;92:107-14. [10.1016/j.resuscitation.2015.04.026](https://doi.org/10.1016/j.resuscitation.2015.04.026) (used for release velocity target)
- Mader TJ et al. The effect of the preshock pause on coronary perfusion pressure decay and rescue shock outcome in porcine ventricular fibrillation. Prehosp Emerg Care 2009;13(4):487-94. [10.1080/10903120903144916](https://doi.org/10.1080/10903120903144916) (used for the perfusion proxy's fall in a pause (CPP 23.4 to 7.6 mmHg over a median 4.1 s; time constant 3.6 s))
- Berg RA et al. Adverse hemodynamic effects of interrupting chest compressions for rescue breathing during cardiopulmonary resuscitation for ventricular fibrillation cardiac arrest. Circulation 2001;104(20):2465-70. [10.1161/hc4501.098926](https://doi.org/10.1161/hc4501.098926) (used for the perfusion proxy's build-up (CPP rebuilding over a compression cycle; upper bound of the 5 s time constant))
- Yin RT et al. Recovery of arterial blood pressure after chest compression pauses in patients with out-of-hospital cardiac arrest. Resuscitation 2024;201:110311. [10.1016/j.resuscitation.2024.110311](https://doi.org/10.1016/j.resuscitation.2024.110311) (used for the perfusion proxy's build-up (arterial pressure back above 90% within 2 compressions; lower bound of the 5 s time constant))
- Yannopoulos D et al. Effects of incomplete chest wall decompression during cardiopulmonary resuscitation on coronary and cerebral perfusion pressures in a porcine model of cardiac arrest. Resuscitation 2005;64(3):363-72. [10.1016/j.resuscitation.2004.10.009](https://doi.org/10.1016/j.resuscitation.2004.10.009) (used for the perfusion proxy's release factor (CPP 23.3 to 15.1 mmHg with 75% recoil))

## License

[MIT](LICENSE), copyright © 2026 Case Viewer contributors. The complete notice is
also embedded in `case-viewer.html` so it travels with the standalone viewer.
The license text follows the [Open Source Initiative MIT license](https://opensource.org/license/mit).
