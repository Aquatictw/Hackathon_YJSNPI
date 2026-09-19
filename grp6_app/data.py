from __future__ import annotations

import csv
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

TARGETS = {
    1: "100_Main.sensor1#CP",
    2: "120_Main.sensor2#DS0",
    3: "140_Main.sensor3#IO4",
    4: "160_Main.sensor4#IO1",
    5: "180_Main.sensor5#IO2",
    6: "200_Main.sensor6#IO3",
}
TARGET_NUMBERS = {value: key for key, value in TARGETS.items()}


@dataclass(frozen=True)
class Measurement:
    wafer: str
    device: str
    site: str
    test: str
    value: float
    order: int
    lot: str = ""


def _number(value):
    try:
        number = float(str(value).strip())
        return number if math.isfinite(number) else None
    except (AttributeError, TypeError, ValueError):
        return None


def _wafer_from_name(path: Path) -> str:
    match = re.search(r"_(W\d+)_", path.name, re.IGNORECASE)
    return match.group(1).upper() if match else path.stem


def _real_header(rows):
    for index, row in enumerate(rows):
        names = {str(value).strip().lower() for value in row}
        if {"pid", "lot", "wafer", "site"}.issubset(names):
            return index, row
    return None, None


def parse_csv(path):
    """Parse challenge exports and the compact synthetic test fixture."""
    path = Path(path)
    with path.open(newline="", encoding="utf-8-sig", errors="replace") as handle:
        rows = list(csv.reader(handle))
    if not rows:
        return []

    wafer = _wafer_from_name(path)
    header_index, header = _real_header(rows)
    positions = {}
    if header is not None:
        positions = {name.strip().lower(): index for index, name in enumerate(header)}
        device_index = positions["pid"]
        site_index = positions["site"]
        identity = {"pid", "lot", "wafer", "site", "x", "y", "pf", "sbin", "hbin", "test time"}
        columns = [(index, name.strip()) for index, name in enumerate(header)
                   if name.strip() and name.strip().lower() not in identity]
        first_data = header_index + 5
    else:
        header_index = next((i for i, row in enumerate(rows)
                             if any("#" in cell for cell in row)), 0)
        header = rows[header_index]
        columns = [(index, name.strip()) for index, name in enumerate(header) if "#" in name]
        device_index, site_index = 0, 1
        first_data = header_index + 1

    out = []
    order = 0
    max_index = max([device_index, site_index] + [index for index, _ in columns], default=-1)
    for row in rows[first_data:]:
        if len(row) <= max_index:
            continue
        device = row[device_index].strip()
        site = row[site_index].strip()
        if not device or device.lower() in {"pid", "pin", "test num", "high limit", "low limit"}:
            continue
        row_wafer = row[positions["wafer"]].strip() if "wafer" in positions else wafer
        for index, test in columns:
            value = _number(row[index])
            if value is not None:
                lot = row[positions["lot"]].strip() if "lot" in positions else ""
                out.append(Measurement(row_wafer or wafer, device, site, test, value, order, lot))
                order += 1
    return out


def load_training(data_dir):
    return [measurement for path in sorted(Path(data_dir).glob("*_RawResult.csv"))
            for measurement in parse_csv(path)]


def stage_features(test_names: Iterable[str]):
    """Return only measurements before each target in the supplied flow order."""
    names = list(dict.fromkeys(test_names))
    positions = {
        stage: next((i for i, name in enumerate(names) if target in name), 0)
        for stage, target in TARGETS.items()
    }
    return {
        stage: [name for index, name in enumerate(names)
                if index < positions[stage]
                and not any(target in name for target in TARGETS.values())]
        for stage in TARGETS
    }
