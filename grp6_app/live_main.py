import logging
import os
import signal
from pathlib import Path
from oneapi import AppInfo, Interface
from .monitor import create_monitor


def main():
    logging.basicConfig(level=logging.INFO)
    base = Path(__file__).resolve().parent
    monitor = create_monitor(base/'artifacts/runtime.json',os.environ.get('GRP6_EVIDENCE','/tmp/grp6_evidence.jsonl'))
    Interface.registerMonitor(monitor)
    info = AppInfo()
    info.name, info.vendor, info.version = 'sample','grp6','1.0.0'
    result = Interface.connect(info,True,True)
    if result != 0:
        raise RuntimeError('ONEAPI connection initiation failed: {}'.format(result))
    logging.info('ONEAPI connection initiated; awaiting actual callbacks')
    def shutdown(*_):
        Interface.disconnect()
        monitor.core.close()
        raise SystemExit(0)
    signal.signal(signal.SIGINT,shutdown)
    signal.signal(signal.SIGTERM,shutdown)
    while True:
        signal.pause()


if __name__ == '__main__':
    main()
