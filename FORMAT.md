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

Real-arrest per-compression extraction is unverified. CPR field discovery and waveform
detection are heuristic fallbacks and require independent real-file validation.

## Events and operator actions

`AnnotationEvt` names many operator actions as well as device states: *Alarms
Silenced*, *NIBP Reading Started*, *IBP Probe1 Zeroed*, *New Patient*, *Patient Mode
Adult*, probe connect/disconnect and lead faults. Snapshots are separate `SnapshotRpt`
records, and changes to the displayed waveforms appear in `DisplayInfo`/`TraceConfigs`.
Not every key press is recorded: menu navigation, alarm-limit edits, volume and
brightness do not appear. Alarm limits are visible only as the values attached to each
`AlarmEvt`, which carries the value and the limits in force but no channel name, no
pressure part, no priority and no end time. Trend values carry a separate `Alarm` flag.

## Unresolved details

- ECG scalar arithmetic and some channel/unit mappings.
- Clock alignment and reliable patient boundaries across all record types.
- Certain opaque event payloads and analysis segments.
- Alarm priority (the colour the monitor showed) and when an alarm ended.
- Per-compression record layout on a real arrest export.
- Compatibility with other device families, firmware and schema versions.
- Detector accuracy, signal quality thresholds and model calibration.
