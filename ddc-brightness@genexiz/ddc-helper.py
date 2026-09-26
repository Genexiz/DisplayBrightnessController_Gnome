#!/usr/bin/env python3
# Long-running helper for the DDC Brightness extension.
#
# Reads "<bus> <value>" lines on stdin and applies them with ddcutil. Running
# ddcutil from here instead of from gnome-shell keeps process spawning off the
# compositor's main loop, so dragging the slider stays smooth. While a write is
# in progress new requests pile up; only the latest value per bus is applied.

import os
import select
import subprocess
import sys

FAST = ['--noverify', '--skip-ddc-checks', '--sleep-multiplier', '0.2']
SAFE = ['--noverify']


def setvcp(bus, value):
    for flags in (FAST, SAFE):
        res = subprocess.run(['ddcutil', '--bus', bus, *flags, 'setvcp', '10', value],
                             capture_output=True, text=True)
        if res.returncode == 0:
            return
    print(f'setvcp bus {bus} = {value} failed: {res.stderr.strip() or res.stdout.strip()}',
          file=sys.stderr, flush=True)


def main():
    fd = sys.stdin.fileno()
    buf = b''
    eof = False
    while not eof:
        select.select([fd], [], [])
        # Drain everything queued so far, then act on the newest value only.
        while select.select([fd], [], [], 0)[0]:
            chunk = os.read(fd, 4096)
            if not chunk:
                eof = True
                break
            buf += chunk
        *lines, buf = buf.split(b'\n')
        latest = {}
        for line in lines:
            parts = line.decode(errors='replace').split()
            if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                latest[parts[0]] = parts[1]
        for bus, value in latest.items():
            setvcp(bus, value)


if __name__ == '__main__':
    main()
