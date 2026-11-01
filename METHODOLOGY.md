# Methodological review

The viewer is an exploratory retrospective review tool. The changes below repair
reproducible implementation errors and reduce unsupported interpretations. They do not
validate the underlying detectors or turn derived values into diagnostic measurements.

## Corrected in this revision

| Area | Previous behavior | Current behavior |
| --- | --- | --- |
| Trend parsing | Numeric zero was treated as missing. | Valid zero values survive, including wrapped values. |
| File imports | Whitespace-prefixed JSON failed; XML truncation was accepted; ZIP expansion was unbounded. | BOM/whitespace handling, explicit truncation errors, ZIP bounds/size/CRC checks and a 256 MiB input/expanded-size ceiling. |
| Annotations | Imported IDs and colors could enter HTML attributes; invalid ranges and unrelated cases could be merged. | Schema/range/case validation, safe field normalization, attribute escaping and atomic imports. |
| Case isolation | A JSON case could inherit the prior XML case ID; patient assumptions were global. | Case ID resets on each parse. Patient overrides and SV calibration are stored by case. Old global patient overrides are intentionally not migrated because their case is unknown. |
| Windowing | Respiratory regularity used the whole case; noise came from the first waveform segment; flush tests could refer to another interval. | These checks use the requested window. Respiratory-source selection happens within it; incomplete cycles and beats crossing the window boundary are omitted. |
| Noise sampling | The derivative's sample lag increased with recording length. | Noise uses adjacent samples at a fixed lag; subsampling changes only which locations are inspected. |
| Venous pressure | CVP was estimated with arterial beat criteria over the whole case. | CVP uses the directly sampled venous mean within the selected window. |
| Respiratory variation | Regular timing was equated with controlled ventilation and fluid-response cutoffs were shown. | Passing timing/quality checks supports descriptive variation only. Clinical conditions remain explicitly unverified; Physiology removes clinical cutoffs. Trends label their unfiltered estimates as raw waveform/model variation. |
| SVV / Eadyn | SVV used the midpoint of its extrema despite stating a mean denominator. Eadyn divided two coupled estimates and supplied response cutoffs. | The SVV proxy uses the mean of cycle samples. Eadyn is withheld pending an independently validated SVV source. |
| HRV | Rejected intervals disappeared from the time axis; successive differences crossed rejected beats; unequal-width frequency bands were averaged rather than integrated. | Original timestamps are retained, only adjacent accepted pairs contribute to RMSSD/pNN50, and spectral power is integrated with the frequency step. LF/HF requires at least five minutes without large gaps. Interval screening is explicitly not verified sinus-beat classification. |
| Capnography | I:E was E/I; alpha/beta omitted the documented display scaling; adjoining breath boundaries made the gap estimate generally zero. | I/E is calculated in the stated order, angle scaling is explicit, and the viewer reports contiguous recorded CO₂ below 8 mmHg. Missing data breaks the interval. This is not called an apnea diagnosis. |
| Cross-signal analysis | Sample period was claimed to bound clock error; results could depend on whether another view had populated a cache. | Alignment uncertainty is explicit. Arterial features are computed from the selected arterial site without relying on a previous view. Unmatched electrical/pulse detections do not establish absent perfusion. |
| Trend timing | Centered smoothing included future cycles. | Cycle values are timestamped at completion and averaged over the preceding minute. |
| Self-tests | Exceptions could leave synthetic data in the active case; an existing calibration affected tests. | Tests isolate their calibration and restore case state in a `finally` block. |

Regular timing cannot establish the absence of spontaneous effort, tidal volume, chest
conditions or right-heart function. Those are additional requirements for interpreting
dynamic indices. See the [ESICM shock and hemodynamic monitoring guideline](https://doi.org/10.1007/s00134-025-08137-z).

Eadyn's mathematical coupling is a documented concern: a validation study deliberately
used independent pressure and flow signals to address it. Withholding this viewer's
unvalidated ratio is a conservative implementation decision, not a claim that every
arterial-signal Eadyn implementation is invalid. [Monge García et al., 2014](https://pubmed.ncbi.nlm.nih.gov/25407570/).

HRV requires careful NN-interval selection, continuity handling and spectral estimation.
Using Lomb–Scargle alone does not solve beat-labeling errors. [PhysioNet HRV toolkit](https://archive.physionet.org/tutorials/hrv-toolkit/),
[Lomb periodogram documentation](https://physionet.org/physiotools/wag/lomb-1.htm).

## Important limitations that remain

1. **Case boundaries are not consistently enforced on all data types.** The New Patient
   pruning pass filters event logs, not waveform, trend or snapshot payloads. Whole-case
   calculations that traverse all stored samples can therefore include pre-case signal
   data if present. The README now describes the actual behavior. A verified export
   containing multiple patient segments is needed to establish boundary semantics and
   test trimming across every record type.

2. **Detectors and pattern scores are unvalidated heuristics.** Arterial foot searches
   use a fixed 420 ms lookback; notch detection accepts the first rising sample after a
   peak; ECG and capnogram thresholds are hand-selected. Noise, tachycardia, filtering and
   changing morphology can shift landmarks or create false events. Synthetic success is
   insufficient to establish sensitivity, specificity or timing accuracy. Quality scores
   and the AF pattern score are not calibrated probabilities.

3. **Missing-data handling still differs between metrics.** SpO₂ events can span gaps
   that the burden integral omits; valid samples separated by up to two minutes are
   treated as if the preceding value persisted. Some beat integrals skip missing samples
   without a coverage requirement. These estimates need explicit observation-duration
   accounting, censoring rules and gap tests before interpreting durations or burdens.

4. **Time alignment is unresolved.** The format documentation describes disagreeing
   subsystem counters and one-second wall timestamps. Sample resolution is not alignment
   accuracy, and sensor transport delays are unmeasured. PAT and unmatched-pulse counts
   remain exploratory even though their limitations are now displayed.

5. **Model outputs need external validation.** The Liljestrand–Zander proxy assumes a
   pressure-to-volume relationship that may change with vascular tone and site. Entering
   one calibration constant does not validate subsequent SV/CO changes. The diastolic
   decay fit assumes a zero asymptotic pressure and has no fit-quality threshold; it
   should not be equated with independently measured resistance × compliance.

6. **Units, bandwidth and applicability are incompletely established.** ECG counts/mV
   remain assumed, the format reference covers one X Series export, and real-arrest CPR
   extraction is untested. Adult reference bands are not adapted to pediatric records.
   Fixed “physiologic” cutoffs may discard genuine extremes. PR/QT, axis and morphology
   estimates need validation against annotations acquired at adequate bandwidth and
   sampling rate, not merely a filter metadata check.

7. **Validation needs an independent reference.** Use anonymized exports from multiple
   supported models and firmware versions, with independent event/beat/breath annotations
   and a held-out test set. Assess timing error, agreement, missed/false detections,
   calibration drift and missing-data behavior separately. Do not tune thresholds on the
   same cases used to report accuracy. PhysioNet provides [waveform-analysis evaluation
   resources](https://physionet.org/physiotools/wpg/wpg.htm).

## Missing-input display policy

Normal review does not require calibrating a monitor. Absolute SV/CO and dependent
estimates are omitted from the interface without a positive, finite calibration supplied
for the case. Indexed estimates also require height and weight; resistance estimates
require a venous line or an explicit CVP assumption. BSA and S/F rows are hidden when
their required inputs are absent. The unavailable Eadyn implementation is hidden entirely.
Signal-quality failures are still displayed, rather than silently dropping unreliable
measurements. The uncalibrated SVV proxy is labeled as such.

Optional inputs now live in a collapsed section on Physiology, beside the results.
Recorded anthropometry is used automatically; no patient dimensions, oxygen fraction,
venous pressure or calibration constant are filled with an invented default. Entered
values are validated before application and saved per case. Clearing them removes the
dependent results and stale selections from exports.

A published equation is not by itself a transferable calibration. Evaluations of
pressure-derived cardiac output compare against independent reference measurements and
specific calibration strategies. The choice to hide unsupported absolute estimates
follows that distinction. [The cardiac output from blood pressure algorithms trial](https://pubmed.ncbi.nlm.nih.gov/19112280/).

## Verification performed

`node --test tests/regression.cjs` passes 51 tests, including all 25 original arterial
self-checks. Tests cover malformed inputs, annotation injection fields, case isolation,
window selection, venous means, HRV gaps and equal-power spectral signals, capnography,
and a synthetic raw-case path through parsing, analysis and table rendering. Additional
tests cover hiding missing-input rows, revealing results when their prerequisites exist,
using recorded anthropometry, FiO₂ percentage conversion, optional form markup, input
validation, form apply/clear actions, per-case formula selection and removing stale
parameter/export selections when calibration is cleared.

Display regressions verify identical cross-signal results with every waveform hidden,
cursor-driven refresh with and without an arterial line, and section navigation that
reveals a section without inadvertently disabling it. Previously, playback refreshed
only arterial cells, leaving signal-derived results at the initial cursor until a full
render (such as toggling a waveform). The refresh now updates those result sections
from the recorded signals independently of waveform visibility.

The Waveform-derived display now separates the latest completed beat at the cursor from
the analysis-window median, which can legitimately remain unchanged across many beats.
Live values wait until the following peak used by extraction has passed the cursor,
expire when no recent beat is available, and withhold clipped beats or missing samples
at the cursor. Whole-case mode retains its fixed summaries while live values still move.
Device comparisons now use the same selected window as the computed summaries;
ventilation and CVP cards are rebuilt during refresh instead of remaining frozen.

Playback regressions run the real render, seek and animation functions with synthetic
changing signals and simulated browser drawing/DOM primitives. They cover beat updates
between summary refreshes, whole-case mode, future/gap/clipping guards, every sweep
width, fast playback, case-end bounds, and changing device/venous/ventilation values.
Event-panel checks cover showing and hiding the list, saved desktop visibility,
focus restoration, Physiology redraws and reopening after switching to a narrow screen.

The documented verification used synthetic inputs. No real exports are included in this repository. Visual browser testing was not completed:
the browser tool's URL policy blocked opening the local HTML file. No clinical validation,
multi-browser compatibility or full interactive workflow validation is claimed.
