from __future__ import annotations
from collections import defaultdict,deque
from dataclasses import dataclass
import math,time

@dataclass
class Alert:
    kind:str; wafer:str; site:str; test:str; message:str; score:float; timestamp:float

class StreamingDetector:
    def __init__(self,window=40,min_samples=12,z_limit=4.0): self.window=window; self.min_samples=min_samples; self.z_limit=z_limit; self.values=defaultdict(lambda:deque(maxlen=window)); self.alert_keys=set()
    def update(self,wafer,site,test,value):
        history=self.values[(site,test)]; alert=None
        if len(history)>=self.min_samples:
            mean=sum(history)/len(history); sd=math.sqrt(sum((x-mean)**2 for x in history)/max(1,len(history)-1)); z=abs(value-mean)/max(sd,1e-9)
            if z>=self.z_limit and (wafer,site,test) not in self.alert_keys:
                self.alert_keys.add((wafer,site,test)); alert=Alert("point_shift",wafer,site,test,f"{test} shifted at site {site}: {value:.4g} vs baseline {mean:.4g}",z,time.time())
        history.append(value); return alert

