import argparse
from .data import load_training
from .detectors import StreamingDetector
from .report import write_report
def main():
    p=argparse.ArgumentParser(); p.add_argument("data_dir"); p.add_argument("--report",default="results/replay.json"); a=p.parse_args(); d=StreamingDetector(); alerts=[]
    for m in load_training(a.data_dir):
        x=d.update(m.wafer,m.site,m.test,m.value)
        if x: alerts.append(x)
    write_report(alerts,a.report); print(f"alerts={len(alerts)} report={a.report}")
if __name__=="__main__": main()

