#!/usr/bin/env python3
"""Drive a command in a real pseudo-terminal (python3 standard library only, no native npm module).

Reads one JSON object on stdin:
  {"cmd": [...], "env": {...} (null removes a variable), "cwd": "...", "cols": 100, "rows": 40, "timeout": 30,
   "steps": [{"wait": "<regex>"}, {"send": "<keys>"}, {"resize": [cols, rows]}, {"sleep": ms},
             {"mark": "<name>"}]}
"marks" in the result: the output's length (in characters) when each mark was reached.
Each "wait" looks only at output written after the previous wait matched.
Prints one JSON object: {"code", "output", "icanon", "echo", "timedOut", "failedStep"}, where
icanon/echo are the terminal's modes after the command exited (was the terminal restored?).
"""
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import time


def set_size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))


def main():
    spec = json.load(sys.stdin)
    master, slave = pty.openpty()
    set_size(slave, spec.get('cols', 100), spec.get('rows', 40))
    env = dict(os.environ)
    for name, value in spec.get('env', {}).items():
        if value is None:
            env.pop(name, None)
        else:
            env[name] = value
    pid = os.fork()
    if pid == 0:
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
        for fd in (0, 1, 2):
            os.dup2(slave, fd)
        os.close(master)
        if spec.get('cwd'):
            os.chdir(spec['cwd'])
        script = '"$@"; code=$?; printf "\\n<<stty>>\\n"; stty -a; exit $code'
        os.execvpe('sh', ['sh', '-c', script, 'sh'] + spec['cmd'], env)
    output = bytearray()
    seen = 0
    deadline = time.time() + spec.get('timeout', 30)
    failed = None
    timed_out = False
    exited = None

    def pump(wait=0.05):
        nonlocal exited
        ready, _, _ = select.select([master], [], [], wait)
        if ready:
            try:
                chunk = os.read(master, 65536)
                if chunk:
                    output.extend(chunk)
            except OSError:
                pass
        if exited is None:
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                exited = status

    marks = {}
    for index, step in enumerate(spec.get('steps', [])):
        if 'mark' in step:
            marks[step['mark']] = len(output.decode('utf-8', 'replace'))
        if 'wait' in step:
            pattern = re.compile(step['wait'].encode(), re.S)
            while True:
                match = pattern.search(bytes(output), seen)
                if match:
                    seen = match.end()
                    break
                if time.time() > deadline or (exited is not None and not select.select([master], [], [], 0.05)[0]):
                    failed = index
                    timed_out = time.time() > deadline
                    break
                pump()
            if failed is not None:
                break
        elif 'send' in step:
            os.write(master, step['send'].encode())
            pump(0.02)
        elif 'resize' in step:
            cols, rows = step['resize']
            set_size(master, cols, rows)
            os.kill(pid, signal.SIGWINCH)
            pump(0.02)
        elif 'sleep' in step:
            end = time.time() + step['sleep'] / 1000
            while time.time() < end:
                pump(0.02)

    while exited is None and time.time() < deadline:
        pump()
    if exited is None:
        timed_out = True
        os.kill(pid, signal.SIGKILL)
        _, exited = os.waitpid(pid, 0)
    end = time.time() + 0.3
    while time.time() < end:
        ready, _, _ = select.select([master], [], [], 0.05)
        if not ready:
            break
        try:
            chunk = os.read(master, 65536)
        except OSError:
            break
        if not chunk:
            break
        output.extend(chunk)
    code = os.waitstatus_to_exitcode(exited) if hasattr(os, 'waitstatus_to_exitcode') else (exited >> 8)
    text = output.decode('utf-8', 'replace')
    # The command runs under sh, which prints `stty -a` after it: the modes it left the terminal in.
    modes = text[text.rfind('<<stty>>'):] if '<<stty>>' in text else ''
    json.dump({
        'code': code,
        'output': text[:text.rfind('<<stty>>')] if modes else text,
        'icanon': bool(re.search(r'(?<![-\w])icanon', modes)),
        'echo': bool(re.search(r'(?<![-\w])echo(?![\w])', modes)),
        'timedOut': timed_out,
        'failedStep': failed,
        'marks': marks,
    }, sys.stdout)


if __name__ == '__main__':
    main()
