# Export format notes

These are interoperability notes for the viewer's parser. They contain no real case
records, identifiers, device serial numbers, patient data or vendor implementation code.
Record names below are format identifiers; they are not a vendor SDK or algorithm.
Examples describe structure only. The original case-specific investigation notes are
intentionally excluded from this repository.

Support beyond the documented X Series schema remains unverified. See
[METHODOLOGY.md](METHODOLOGY.md) for limitations and validation requirements.

## Container

A binary `.zol` container holds two length-prefixed documents:

```text
[uint32 LE jsonLen][JSON, UTF-8][uint32 LE xmlLen][CaseReview XML, UTF-16LE]
```

The parser also accepts bare JSON and ZIP-wrapped exports. Never infer a container's
type from the first length byte alone. Validate lengths before decoding. ZIP imports
check entry bounds, declared size and CRC-32, and enforce a 256 MiB input/expanded limit.
Encrypted, multi-disk and ZIP64 archives are unsupported.

## Record organization

The JSON path is `ZOLL.FullDisclosure[].FullDisclosureRecord[]`. Each record normally
has a single key identifying its type. XML-derived JSON uses `@` for attributes and
`#text` for element text. Repeated fields may be arrays or single objects; normalize
them before traversal.

The viewer uses these record families:

| Records | Purpose |
| --- | --- |
| `DeviceConfiguration`, `CaseSummary`, `PatientInfo` | Metadata and case inputs |
| `DataChannels`, `TraceConfigs`, `DisplayInfo` | Channel scales, names and display settings |
| `ContinWaveRec` | Continuous waveform frames |
| `TrendRpt` | Device-recorded vital signs |
| `SnapshotRpt` and other waveform-bearing records | Saved waveform acquisitions |
| `AnnotationEvt`, `AlarmEvt`, `AlarmLimits` | Events and alarms |
| `Aed`, `AedContinAnalysis` | Recorded device determinations and CPR-related containers |

No record payloads from actual exports are distributed here. Regression fixtures are
constructed in memory from synthetic values in `tests/regression.cjs`.

## Time

`StdHdr.DevDateTime` is a device-local wall timestamp with one-second resolution.
`MsecTime` may belong to a subsystem counter; `ElapsedTime` may be absent or zero.
The parser anchors on wall time, uses the millisecond counter only when the two agree
within its tolerance, and falls back to elapsed time. Device clock settings and sensor
transport delays do not establish precise cross-signal synchronization.

Rolling logs can include records outside the patient segment. The current viewer
filters pre-case event logs but does not consistently trim waveform, trend or snapshot
payloads. Whole-case calculations therefore still require caution about boundaries.

## Waveforms and scaling

`Waveform[].WaveRec` supplies channel identity, samples and sample period.
`SampleTime` is in microseconds per sample. Group frames by channel, sort by time,
and split segments when the next frame is discontinuous.

Channel scaling is joined through `WaveType` and `DataChannels.ChanType`.
`ScalarType 2` uses division by the recorded scalar. For `ScalarType 1` (ECG) the scalar
is nanovolts per count (2500 nV = 400 counts per mV), which matches the 12-lead record's
own amplitude field; Settings can override it.
Not every scalar type or unit conversion is established. Invalid/sentinel samples
must be rejected rather than treated as physiological measurements.

## Trends

Trend leaves carry validity and unit metadata. Check `DataState` before accepting
`Val`, preserve valid numeric zero, and support values wrapped in `#text`.
Do not assume fixed spacing between reports. Deduplicate NIBP readings by their own
measurement timestamp, not by a repeated `IsNew` flag.

HR and RR may each be a single device-selected value with a source label. The viewer's
additional per-source rates are derived from waveforms and are labeled accordingly.

## CaseReview XML

The XML document carries the case identifier, device/patient metadata, parsed ventilation
marks and CPR/pause/ROSC/device-assist period lists when present. These are structural
fields the parser reads; no actual XML export is included.

On X Series exports the period containers hold `<Segment>` elements with
`<StartSecond>` (seconds from the case start) and `<Duration>` (seconds) rather than
start/end pairs; pause segments add `Reason`, `Cause` and an `Annotation`. Both layouts
are accepted.

`CprCompression` is one record per detected compression: `CompDisp`, `RelVelocity`,
`CompRate` (compressions/min, 0 = none) and `TimeStamp`, a millisecond counter that
keeps pace with the wall clock. The viewer reads `CompDisp` as thousandths of an inch
and `RelVelocity` as hundredths of an inch per second. Those scales are inferred from
plausible values on one real export, not from documentation. The `Lo`/`Hi` depth and
rate flags are the device's own CPR feedback (too shallow, too deep, too slow, too fast);
they are smoothed across compressions by the device, and the viewer shows them as the
device's feedback rather than using them in its own targets. `CprAccelWaveRec` carries the
raw CPR acceleration waveform and is not read.

Real-arrest per-compression extraction is otherwise unverified. CPR field discovery and waveform
detection are heuristic fallbacks and require independent real-file validation.

## Events and operator actions

`AnnotationEvt` names many operator actions as well as device states: *Alarms
Silenced*, *NIBP Reading Started*, *IBP Probe1 Zeroed*, *New Patient*, *Patient Mode
Adult*, probe connect/disconnect and lead faults. Snapshots are separate `SnapshotRpt`
records, and changes to the displayed waveforms appear in `DisplayInfo`/`TraceConfigs`.
On X Series exports the treatment buttons (EPI, IV, ...) are not `AnnotationEvt`: each
press is a `TreatmentSnapshotEvt` with `@EvtName` "Treatment" and the button's label in
`TreatmentLbl`; a waveform snapshot taken with it carries the same `TreatmentLbl`. When
these exist the viewer uses them as the case's treatments. `EPI` and `IV` have been seen in
a real export. Other labels (`IO`, `AMIO`, `INTUB` and the airway buttons) are mapped on
the assumption that the label is the button's text, which is unconfirmed; any label is
shown as written when it is not mapped. The `TreatmentSummary` bit
on other events (SpO2 Low Perfusion, NIBP Air Leak, ...) marks them for the printed
summary and does not mean care was given.

Not every key press is recorded: menu navigation, alarm-limit edits, volume and
brightness do not appear. Alarm limits are visible only as the values attached to each
`AlarmEvt`, which carries the value and the limits in force but no channel name, no
pressure part, no priority and no end time. Trend values carry a separate `Alarm` flag.

## Device determinations

`AedContinAnalysis` is written every 3 seconds while the pads are on, even in manual mode.
Each `AnalysisResult` carries `SceDecisionFlagVal` ("Disabled" when shock advice is off),
`ShockResult` (values 3 and 5 seen; their meanings are not documented) and segment
timing. `Aed` records log pads, cable and mode changes; their `AnalysisResults` are empty
unless an analysis was requested. Neither names a rhythm.

`AlarmEvt` carries a `DevEvtCode` but no name. Heart-rate alarms are 320 (high) and 319
(low), with the limits in `AlarmLimits`; a low alarm with value 0 means no rate could be
counted. Code 299 (`XidCode` 107) carries no limits and is unidentified.

A 12-lead's `AnalysisResult` holds the monitor's own `HeartRate`, `QrsDur`, `QtInt`,
`CorrQtInt` (correction formula not stated) and `QrsAxis`, with INT_MIN meaning "not
measured", alongside its interpretation statements.

## Unresolved details

- ECG scalar arithmetic and some channel/unit mappings.
- Clock alignment and reliable patient boundaries across all record types.
- Certain opaque event payloads and analysis segments.
- Alarm priority (the colour the monitor showed) and when an alarm ended.
- Units of `CompDisp` and `RelVelocity` (inferred), and the meaning of `ShockResult` codes.
- Treatment-button labels other than EPI and IV.
- Compatibility with other device families, firmware and schema versions.
- Detector accuracy, signal quality thresholds and model calibration.
