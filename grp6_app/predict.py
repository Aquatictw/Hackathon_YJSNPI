from __future__ import annotations
import pickle
import numpy as np
from pathlib import Path
try:
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import Ridge
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
except ImportError:
    SimpleImputer = Ridge = StandardScaler = None
    def make_pipeline(*_):
        return _NumpyRidge()

class _NumpyRidge:
    def fit(self, x, y):
        x = np.asarray(x, dtype=float)
        self.medians = np.nanmedian(x, axis=0)
        self.medians = np.where(np.isfinite(self.medians), self.medians, 0.0)
        x = np.where(np.isfinite(x), x, self.medians)
        self.mean = x.mean(axis=0); self.scale = x.std(axis=0); self.scale = np.where(self.scale > 1e-12, self.scale, 1.0)
        z = (x-self.mean)/self.scale
        self.coef = np.linalg.solve(z.T@z + np.eye(z.shape[1]), z.T@np.asarray(y)) if z.shape[1] else np.zeros(0)
        self.intercept = float(np.mean(y))
        return self
    def predict(self, x):
        x = np.asarray(x, dtype=float); x = np.where(np.isfinite(x), x, self.medians)
        return self.intercept + ((x-self.mean)/self.scale) @ self.coef
from .data import TARGETS,TARGET_NUMBERS,stage_features

class StageModels:
    def __init__(self): self.models={}; self.features={}; self.defaults={}
    def fit(self, measurements, order=None, allowlists=None):
        if order is None and allowlists is None:
            raise ValueError("Training requires verified flow order or stage allowlists; CSV order is not execution order")
        groups={}
        for m in measurements: groups.setdefault((m.lot,m.wafer,m.device,m.site),{})[m.test]=m.value
        self.features = ({int(k): list(v) for k,v in allowlists.items()}
                         if allowlists is not None else stage_features(order))
        if any(any(target in name for target in TARGETS.values())
               for names in self.features.values() for name in names):
            raise ValueError("Sensor targets cannot be included in feature allowlists")
        for stage,target in TARGETS.items():
            fs=self.features.get(stage, []); x=[]; y=[]
            if not fs: continue
            for values in groups.values():
                target_key = next((name for name in values if target in name), None)
                if target_key is not None: x.append([values.get(n,np.nan) for n in fs]); y.append(values[target_key])
            if y:
                self.defaults[stage]=float(np.nanmedian(y)); self.models[stage]=(make_pipeline() if SimpleImputer is None else make_pipeline(SimpleImputer(strategy="median"),StandardScaler(),Ridge(alpha=1.0))); self.models[stage].fit(np.asarray(x,float),y)
        return self
    def predict(self,target,values):
        stage=TARGET_NUMBERS.get(target,target) if isinstance(target,str) else target
        if stage not in TARGETS or stage not in self.models: return None
        if not any(np.isfinite(values.get(n,np.nan)) for n in self.features[stage]): return None
        return float(self.models[stage].predict([[values.get(n,np.nan) for n in self.features[stage]]])[0])
    def save(self,path):
        with Path(path).open("wb") as f: pickle.dump(self,f)
    @classmethod
    def load(cls,path):
        with Path(path).open("rb") as f: return pickle.load(f)
