"""Copied, current-touchdown measurements; no SDK objects are retained."""
from dataclasses import dataclass, field
import math
from threading import RLock


@dataclass
class TesterState:
    lot: str = ""
    wafer: str = ""
    touchdown: int = 0
    active_sites: set = field(default_factory=set)
    values: dict = field(default_factory=dict)


class LiveState:
    def __init__(self):
        self.testers = {}
        self.lock = RLock()
        self.rejected = 0

    def reset(self, tester, lot="", wafer=""):
        with self.lock:
            self.testers[str(tester)] = TesterState(lot=str(lot), wafer=str(wafer))

    def start(self, tester, sites):
        with self.lock:
            state = self.testers.setdefault(str(tester), TesterState())
            state.touchdown += 1
            state.active_sites = {str(site) for site in sites}
            state.values = {site: {} for site in state.active_sites}
            return state.touchdown

    def record(self, tester, site, feature, value):
        with self.lock:
            state = self.testers.get(str(tester))
            site = str(site)
            try:
                value = float(value)
            except (TypeError, ValueError):
                self.rejected += 1
                return False
            if state is None or site not in state.active_sites or not math.isfinite(value):
                self.rejected += 1
                return False
            state.values[site][str(feature)] = value
            return True

    def snapshot(self, tester):
        with self.lock:
            state = self.testers.get(str(tester))
            if state is None:
                return {}
            return {site: dict(state.values[site]) for site in sorted(state.active_sites)}

    def end(self, tester, sites=None):
        with self.lock:
            state = self.testers.get(str(tester))
            if state is not None:
                ended = set(state.active_sites) if sites is None else {str(s) for s in sites}
                state.active_sites.difference_update(ended)
                for site in ended:
                    state.values.pop(site, None)
