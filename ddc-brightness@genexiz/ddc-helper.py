#!/usr/bin/env python3
# Long-running helper for the DDC Brightness extension.
#
# All ddcutil work happens here so gnome-shell never has to fork (forking the
# compositor stalls its frame loop). Line protocol:
#
#   stdin                    stdout
#   detect               ->  display <bus> <name...>   (0..n lines), then: detected
#   get <bus>            ->  value <bus> <current> <max>   |   error <bus> <message>
#   set <bus> <value>    ->  (nothing; failures go to stderr)
#
# Requests that arrive while ddcutil is busy pile up; only the latest "set"
# per bus is applied, and queued sets run before queued gets so a read always
# reflects the most recent write.

import os
import re
import select
import subprocess
import sys

FAST = ['--noverify', '--skip-ddc-checks', '--sleep-multiplier', '0.2']
SAFE = ['--noverify']


def emit(line):
    sys.stdout.write(line + '\n')
    sys.stdout.flush()


def ddcutil(*args):
    try:
        return subprocess.run(['ddcutil', *args], capture_output=True, text=True, timeout=30)
    except FileNotFoundError:
        return subprocess.CompletedProcess(args, 127, '', 'ddcutil is not installed')
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(args, 124, '', 'ddcutil timed out')


def setvcp(bus, value):
    for flags in (FAST, SAFE):
        res = ddcutil('--bus', bus, *flags, 'setvcp', '10', value)
        if res.returncode == 0:
            return
    print(f'setvcp bus {bus} = {value} failed: {res.stderr.strip() or res.stdout.strip()}',
          file=sys.stderr, flush=True)


def getvcp(bus):
    res = ddcutil('--bus', bus, '--terse', 'getvcp', '10')
    m = re.search(r'VCP\s+10\s+C\s+(\d+)\s+(\d+)', res.stdout)
    if m:
        emit(f'value {bus} {m[1]} {m[2]}')
    else:
        msg = (res.stderr.strip() or res.stdout.strip() or 'no output').replace('\n', ' ')
        emit(f'error {bus} {msg}')


def detect():
    res = ddcutil('detect', '--terse')
    if res.returncode != 0:
        print(f'ddcutil detect failed: {res.stderr.strip()}', file=sys.stderr, flush=True)
    # Only "Display N" sections are usable; "Invalid display" sections are skipped.
    for section in re.split(r'\n(?=\S)', res.stdout):
        if not re.match(r'Display \d+', section):
            continue
        bus = re.search(r'I2C bus:\s+/dev/i2c-(\d+)', section)
        if not bus:
            continue
        monitor = re.search(r'Monitor:\s+(.*)', section)
        parts = monitor[1].split(':') if monitor else []
        name = parts[1].strip() if len(parts) > 1 and parts[1].strip() else f'Monitor (i2c-{bus[1]})'
        emit(f'display {bus[1]} {name}')
    emit('detected')


def main():
    fd = sys.stdin.fileno()
    buf = b''
    eof = False
    while not eof:
        select.select([fd], [], [])
        # Drain everything queued so far before acting.
        while select.select([fd], [], [], 0)[0]:
            chunk = os.read(fd, 4096)
            if not chunk:
                eof = True
                break
            buf += chunk
        *lines, buf = buf.split(b'\n')
        sets, gets, want_detect = {}, [], False
        for line in lines:
            cmd = line.decode(errors='replace').split()
            if cmd == ['detect']:
                want_detect = True
            elif len(cmd) == 2 and cmd[0] == 'get' and cmd[1].isdigit():
                if cmd[1] not in gets:
                    gets.append(cmd[1])
            elif len(cmd) == 3 and cmd[0] == 'set' and cmd[1].isdigit() and cmd[2].isdigit():
                sets[cmd[1]] = cmd[2]
        for bus, value in sets.items():
            setvcp(bus, value)
        if want_detect:
            detect()
        for bus in gets:
            getvcp(bus)


if __name__ == '__main__':
    try:
        main()
    except BrokenPipeError:
        pass
