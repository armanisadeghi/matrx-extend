"""Real Linux lifecycle proof. Invoked by Node tests only on Linux."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from linux_owned_supervisor import supervise

POLICY = dict(run_seconds=0.3, grace_seconds=0.1, kill_seconds=1.0, poll_seconds=0.005)

if sys.argv[1] == 'payload':
    mode, marker = sys.argv[2:]
    if mode == 'natural':
        sys.exit(7)
    if mode == 'descendant':
        read, write = os.pipe()
        if os.fork() != 0:
            os.close(write)
            assert os.read(read, 1) == b'R'
            os._exit(0)
        os.close(read)
        os.setsid()
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        Path(marker).write_text(str(os.getpid()))
        os.write(write, b'R')
        os.close(write)
    elif mode == 'churn':
        for index in range(24):
            child = os.fork()
            if child == 0:
                if index != 23:
                    os._exit(0)
                os.setsid()
                signal.signal(signal.SIGTERM, signal.SIG_IGN)
                Path(marker).write_text(str(os.getpid()))
                while True:
                    signal.pause()
        deadline = time.monotonic() + 2
        while not Path(marker).exists():
            assert time.monotonic() < deadline, 'churn survivor never started'
            time.sleep(0.001)
        os._exit(0)
    else:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        Path(marker).write_text(str(os.getpid()))
    while True:
        signal.pause()

if sys.argv[1] == 'worker':
    request = json.load(sys.stdin)
    try:
        result = supervise(request['command'], request['policy'], request.get('cancel_fd'))
    except Exception as error:
        if request['command'][3] != 'pre_cancel': raise
        result = {'hold': str(error)}
    print(json.dumps(result), flush=True)
    sys.exit(0)

mode = sys.argv[1]
if mode == 'stale-handle':
    child = os.fork()
    if child == 0:
        while True: signal.pause()
    fd = os.pidfd_open(child)
    signal.pidfd_send_signal(fd, signal.SIGKILL)
    os.waitpid(child, 0)
    sentinel = os.fork()
    if sentinel == 0:
        while True: signal.pause()
    sentinel_fd = os.pidfd_open(sentinel)
    try:
        try:
            signal.pidfd_send_signal(fd, signal.SIGKILL)
        except ProcessLookupError:
            pass
        else:
            raise AssertionError('dead pidfd accepted a signal')
        assert os.waitpid(sentinel, os.WNOHANG) == (0, 0), 'unrelated sentinel was signalled'
    finally:
        os.close(fd)
        signal.pidfd_send_signal(sentinel_fd, signal.SIGKILL)
        os.waitpid(sentinel, 0)
        os.close(sentinel_fd)
    print(json.dumps({'case': mode, 'dead_handle': 'ESRCH', 'sentinel': 'alive'}))
    sys.exit(0)

with tempfile.TemporaryDirectory(prefix='linux-owner-proof-') as directory:
    marker = Path(directory) / 'owned-pid'
    read, write = os.pipe()
    request = {'command': [sys.executable, __file__, 'payload', mode, str(marker)], 'policy': POLICY, 'cancel_fd': read}
    worker = subprocess.Popen([sys.executable, __file__, 'worker'], stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, pass_fds=(read,))
    os.close(read)
    try:
        if mode == 'pre_cancel':
            os.close(write)
            write = None
        worker.stdin.write(json.dumps(request))
        worker.stdin.close()
        worker.stdin = None
        if mode == 'cancel':
            deadline = time.monotonic() + 2
            while not marker.exists():
                assert worker.poll() is None, 'supervisor exited before payload readiness'
                assert time.monotonic() < deadline, 'payload did not become ready'
                time.sleep(0.005)
            os.close(write)  # Real control-pipe EOF, no signal number targeting.
            write = None
        out, err = worker.communicate(timeout=4)
        assert worker.returncode == 0, err
        result = json.loads(out)
        if mode == 'pre_cancel':
            assert result == {'hold': 'RESOURCE_LAUNCH_CANCELLED'}, result
            assert not marker.exists(), 'cancelled supervisor launched its payload'
            print(json.dumps({'case': mode, **result}))
            sys.exit(0)
        assert result['cleanup'] == 'confirmed'
        assert result['reason'] == ('cancelled' if mode == 'cancel' else 'exited' if mode in ('natural', 'descendant', 'churn') else 'deadline'), result
        assert result['root_exit'] == (7 if mode == 'natural' else 0 if mode in ('descendant', 'churn') else -9), result
        if mode != 'natural':
            assert marker.exists(), 'payload path was not reached'
            pid = int(marker.read_text())
            assert not Path(f'/proc/{pid}').exists(), 'owned survivor remains after confirmed cleanup'
        print(json.dumps({'case': mode, **result}))
    finally:
        if write is not None: os.close(write)
        # If this assertion fails, the CI test fails rather than claiming cleanup.
        # Normal code paths must not need a test-side process-group kill fallback.
        assert worker.poll() is not None, 'helper exceeded bounded lifecycle; cleanup unconfirmed'
