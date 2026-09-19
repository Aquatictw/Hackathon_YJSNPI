"""Build the sparse-burst spread-down artifact from normal-fit wafers only.

Labels only choose the inherited normal-fit partition recorded by the core
artifact. Rows from every other wafer are skipped before any value is parsed.
Floors come from replaying the runtime detector itself on each fit wafer, so
calibration and runtime share one burst definition.
"""
import argparse
import csv
import hashlib
import json
import math
import statistics
from array import array
from pathlib import Path
from .sparse_burst import (ARTIFACT_NAME, ARTIFACT_VERSION, DETECTOR_ID, BurstCalibration,
                           SparseBurstSpreadDown, family_of)

EXPECTED_FIT = [2, 4, 5, 7, 8, 10, 11, 13, 16, 17, 19, 20, 22]
MAD_CONSISTENCY = 1.4826
MEAN_AD_CONSISTENCY = 1.2533141373155003  # sqrt(pi/2) for a Gaussian
SCALE_FLOOR_RELATIVE = 1e-9
DEFAULTS = {'z_threshold': 20., 'min_extreme_tests': 4, 'first_scan_devices': 72,
            'scan_interval_devices': 8, 'fisher_alpha': .10, 'min_family_coverage': .9,
            'min_family_tests': 100}
RUNTIME_KEYS = ('z_threshold', 'min_extreme_tests', 'first_scan_devices', 'scan_interval_devices',
                'fisher_alpha', 'min_family_coverage')
WARNING = ('Rule shape and parameters (z>20, >=4 extreme tests, first scan at 72, alpha 0.10) were proposed '
           'after W15/W25 were examined; W6/W12/W15/W21/W24 and all anomaly wafers were inspected during '
           'development. Normal-only fitting of baselines and floors does not remove that selection bias. '
           'This is a development candidate, not independent validation.')


def site_key(site):
    return (len(site), site)


def robust_scale(values, median):
    """1.4826*MAD, else Gaussian-consistent mean absolute deviation, else None."""
    deviations = [abs(value - median) for value in values]
    floor = SCALE_FLOOR_RELATIVE * max(1., abs(median))
    mad = statistics.median(deviations) * MAD_CONSISTENCY
    if mad > floor:
        return mad, 'mad'
    mean_ad = statistics.fmean(deviations) * MEAN_AD_CONSISTENCY
    if mean_ad > floor:
        return mean_ad, 'mean_absolute_deviation'
    return None, 'degenerate'


def read_fit_devices(data_dir, fit):
    """Return (header, used files, {wafer: [(pid, site, array)]}) for fit wafers only."""
    fit, header, used, devices = set(fit), None, {}, {}
    for path in sorted(Path(data_dir).glob('*_RawResult.csv')):
        with path.open(encoding='utf-8-sig', newline='') as handle:
            reader = csv.reader(handle)
            names = next(reader)
            for _ in range(4):
                next(reader)
            for row in reader:
                if not row or not row[0].isdigit():
                    continue
                meta = dict(zip(names[:10], row[:10]))
                if int(meta['Wafer']) not in fit:
                    continue
                if header is None:
                    header = names[10:]
                elif names[10:] != header:
                    raise ValueError('CSV columns differ: ' + path.name)
                if len(row) != len(names):
                    raise ValueError('Incomplete row: ' + path.name)
                numbers = array('d', (float(raw) if raw.strip() else math.nan for raw in row[10:]))
                used[path.name] = path
                devices.setdefault(int(meta['Wafer']), []).append((meta['PID'], meta['Site'], numbers))
    return header, used, devices


def device_values(header, numbers, positions):
    return {header[j]: numbers[j] for j in positions if math.isfinite(numbers[j])}


def build(data_dir, runtime_artifact, config=None):
    config = dict(DEFAULTS, **(config or {}))
    runtime_bytes = Path(runtime_artifact).read_bytes()
    runtime = json.loads(runtime_bytes)
    fit = list(runtime['detector_calibration']['normal_fit_wafers'])
    if sorted(fit) != EXPECTED_FIT:
        raise ValueError('normal-fit partition differs from the documented one: {}'.format(fit))
    header, used, devices = read_fit_devices(data_dir, fit)
    if sorted(devices) != sorted(fit):
        raise ValueError('missing fit wafers: {}'.format(sorted(set(fit) - set(devices))))
    grouped = {}
    for name in header:
        grouped.setdefault(family_of(name), []).append(name)
    families = {family: tests for family, tests in sorted(grouped.items())
                if len(tests) >= config['min_family_tests']}
    index = {name: j for j, name in enumerate(header)}
    positions = [index[test] for tests in families.values() for test in tests]
    sites = sorted({site for rows in devices.values() for _, site, _ in rows}, key=site_key)
    baselines, excluded, sources = {}, {}, {}
    for site in sites:
        rows = [numbers for wafer_rows in devices.values() for _, s, numbers in wafer_rows if s == site]
        baselines[site] = {}
        for j in positions:
            values = [numbers[j] for numbers in rows if math.isfinite(numbers[j])]
            median = statistics.median(values) if values else None
            scale, source = robust_scale(values, median) if values else (None, 'missing')
            sources[source] = sources.get(source, 0) + 1
            if scale is None:
                excluded.setdefault(site, []).append(header[j])
            else:
                baselines[site][header[j]] = [median, scale]
    artifact = {'detector': DETECTOR_ID, 'version': ARTIFACT_VERSION,
                'config': dict({k: config[k] for k in RUNTIME_KEYS}, min_family_tests=config['min_family_tests'],
                               floor_rule='early_burst_count must be strictly greater than normal_max_early_bursts',
                               mad_consistency=MAD_CONSISTENCY, mean_ad_consistency=MEAN_AD_CONSISTENCY,
                               scale_floor_relative=SCALE_FLOOR_RELATIVE,
                               scale_fallback='1.4826*MAD; else 1.2533*mean absolute deviation; else test excluded'),
                'families': families, 'baselines': baselines,
                'scale_sources': dict(sorted(sources.items())),
                'excluded_tests': {site: names for site, names in sorted(excluded.items())},
                'normal_max_early_bursts': {family: {} for family in families}}
    # Empty floors never pass; this provisional view lets the runtime class
    # itself count fit-wafer bursts with the exact runtime definition.
    provisional = BurstCalibration(artifact)
    shortest = min(len(rows) for rows in devices.values())
    scan_positions = list(range(config['first_scan_devices'], shortest + 1, config['scan_interval_devices']))
    if not scan_positions:
        raise ValueError('fit wafers are shorter than the first scan position')
    floors = {family: {} for family in families}
    scans = {family: {} for family in families}
    for wafer in fit:
        detector = SparseBurstSpreadDown(provisional)
        for pid, site, numbers in devices[wafer]:
            detector.add(site, device_values(header, numbers, positions), pid)
        for position in scan_positions:
            for family in families:
                window = detector.window(family, position)
                if window['low_coverage_devices']:
                    raise ValueError('normal-fit wafer {} lacks {} coverage'.format(wafer, family))
                pair =[window['early_burst_count'], window['recent_burst_count']]
                scans[family].setdefault(str(position), {})[str(wafer)] = pair
                floors[family][str(position)] = max(floors[family].get(str(position), 0), pair[0])
    artifact['normal_max_early_bursts'] = floors
    artifact['normal_fit_scans'] = scans
    artifact['provenance'] = {
        'builder': 'grp6_app.calibrate_burst', 'normal_fit_wafers': fit,
        'normal_fit_devices': {str(w): len(devices[w]) for w in fit},
        'positions': scan_positions, 'sites': sites,
        'source_files_sha256': {name: hashlib.sha256(path.read_bytes()).hexdigest()
                                for name, path in sorted(used.items())},
        'runtime_artifact_sha256': hashlib.sha256(runtime_bytes).hexdigest(),
        'labels_used': 'normal-fit partition selection only; other wafers are skipped before parsing values',
        'warning': WARNING}
    BurstCalibration(artifact)  # refuse to write an artifact the runtime would reject
    return artifact


def write(artifact, output):
    output = Path(output)
    output.write_text(json.dumps(artifact, allow_nan=False, sort_keys=True, separators=(',', ':')),
                      encoding='utf-8')
    return hashlib.sha256(output.read_bytes()).hexdigest()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--data', default='source_review/training/Data')
    parser.add_argument('--artifacts', default='grp6_app/artifacts')
    parser.add_argument('--output', help='defaults to <artifacts>/' + ARTIFACT_NAME)
    args = parser.parse_args(argv)
    artifact = build(args.data, Path(args.artifacts) / 'runtime.json')
    digest = write(artifact, args.output or Path(args.artifacts) / ARTIFACT_NAME)
    print(json.dumps({'sha256': digest, 'normal_max_early_bursts': artifact['normal_max_early_bursts'],
                      'scale_sources': artifact['scale_sources'],
                      'families': {f: len(t) for f, t in artifact['families'].items()}}, indent=1))


if __name__ == '__main__':
    main()
