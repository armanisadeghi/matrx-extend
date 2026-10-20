"""Actual supervisor functions, external kernel/syscall seams only. No product proof."""
import importlib.util
import io
from pathlib import Path
from types import SimpleNamespace
import sys

spec = importlib.util.spec_from_file_location('supervisor', Path(__file__).with_name('linux_owned_supervisor.py'))
sut = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sut)

class Kernel:
    def __init__(self, mode):
        self.mode, self.events, self.clock = mode, [], 0
        self.children, self.handles, self.handlers = {}, {}, {}
        self.next_fd = 50
        self.os = SimpleNamespace(**{name: getattr(sut.os, name) for name in ('WNOHANG', 'WEXITED', 'WNOWAIT', 'P_ALL', 'waitstatus_to_exitcode')})
        for name in ('pidfd_open', 'listdir', 'waitid', 'getpid', 'close', 'fork', 'waitpid'):
            setattr(self.os, name, getattr(self, name))
        self.signals = SimpleNamespace(SIGCHLD=17, SIGTERM=15, SIGINT=2, SIGKILL=9, SIG_DFL=0,
                                       signal=self.install, pidfd_send_signal=self.send)
    def install(self, sig, handler): self.handlers[sig] = handler
    def listdir(self, _): return ['700']
    def getpid(self): return 700
    def waitid(self, *args):
        assert args[-1] & sut.WALL
        raise ChildProcessError()
    def prctl(self, cmd, arg, *_):
        if cmd == 37: arg._obj.value = 1
        return 0
    def pidfd_open(self, pid):
        self.events.append(('open', pid))
        if self.mode == 'unsupported' and pid == 700: raise OSError('unsupported')
        if self.mode == 'denied' and pid == 101: raise PermissionError('denied')
        self.next_fd += 1
        self.handles[self.next_fd] = pid
        return self.next_fd
    def close(self, fd):
        self.events.append(('close', fd))
        self.handles.pop(fd)
    def fork(self):
        self.events.append(('fork',))
        self.children[101] = 'dead' if self.mode == 'natural' else 'live'
        return 101
    def send(self, fd, sig):
        pid = self.handles[fd]
        self.events.append(('send', pid, sig, fd))
        if sig == 0: return
        if self.mode == 'permission_signal': raise PermissionError('denied')
        if self.mode == 'esrch': raise ProcessLookupError()
        if self.mode == 'unconfirmed': return
        if sig == 9 or self.mode not in ('escalate', 'descendant'):
            self.children[pid] = 'dead'
    def waitpid(self, pid, flags):
        assert pid == -1 and flags & sut.WALL
        if self.mode == 'reap_storm':
            self.clock += 0.01
            if self.clock > 0.08:
                raise RuntimeError('kernel seam stops runaway reap after deadline violation')
            return 103, 0
        for child, status in list(self.children.items()):
            if status == 'dead':
                del self.children[child]
                self.events.append(('reap', child))
                if self.mode == 'descendant' and child == 101:
                    self.children[102] = 'live'
                return child, 0
        if self.children: return 0, 0
        raise ChildProcessError()
    def read(self, path, **_):
        assert path == '/proc/self/task/700/children'
        if self.mode == 'census_omission': return io.StringIO('')
        return io.StringIO(' '.join(map(str, self.children)))
    def sleep(self, seconds):
        assert 0 < seconds <= 0.01
        self.clock += seconds
        if self.mode == 'cancel': self.handlers[15](15, None)

mode = sys.argv[1]
kernel = Kernel(mode)
sut.os, sut.signal, sut.sys = kernel.os, kernel.signals, SimpleNamespace(platform='linux')
sut.ctypes = SimpleNamespace(CDLL=lambda *_a, **_k: SimpleNamespace(prctl=kernel.prctl),
                             c_int=sut.ctypes.c_int, byref=sut.ctypes.byref)
sut.open = kernel.read
sut.time = SimpleNamespace(monotonic=lambda: kernel.clock, sleep=kernel.sleep)
if mode == 'pre_cancel':
    sut.select = SimpleNamespace(select=lambda read, *_: (read, [], []))
policy = dict(run_seconds=0.02, grace_seconds=0.02, kill_seconds=0.02, poll_seconds=0.01)
if mode == 'invalid': policy['kill_seconds'] = float('nan')
try:
    result = sut.supervise(['opaque-workload'], policy, cancel_fd=51 if mode == 'pre_cancel' else None)
except (sut.OwnershipHold, OSError) as error:
    assert mode in ('unsupported', 'invalid', 'pre_cancel', 'denied', 'permission_signal', 'esrch', 'unconfirmed', 'census_omission', 'reap_storm'), (mode, error)
    if mode in ('unsupported', 'invalid', 'pre_cancel'):
        assert ('fork',) not in kernel.events
    if mode == 'unsupported':
        assert str(error) == 'RESOURCE_KERNEL_OWNERSHIP_UNAVAILABLE'
    elif mode == 'invalid':
        assert str(error) == 'RESOURCE_PROCESS_POLICY_INVALID'
    if mode == 'pre_cancel':
        assert str(error) == 'RESOURCE_LAUNCH_CANCELLED'
    elif mode not in ('unsupported', 'invalid'):
        assert str(error) == 'RESOURCE_GROUP_UNCONFIRMED'
    if mode in ('esrch', 'unconfirmed', 'census_omission', 'reap_storm'):
        assert 0.06 <= kernel.clock < 0.071, kernel.clock
    if mode == 'census_omission':
        assert not any(event[0] == 'send' and event[2] != 0 for event in kernel.events)
else:
    assert mode not in ('unsupported', 'invalid', 'denied', 'permission_signal', 'esrch', 'unconfirmed', 'reap_storm'), mode
    assert result['cleanup'] == 'confirmed' and result['root_exit'] == 0
    assert result['reason'] == ('exited' if mode == 'natural' else 'cancelled' if mode == 'cancel' else 'deadline')
    assert not kernel.children and not kernel.handles
    if mode == 'descendant':
        assert ('reap', 102) in kernel.events
    if mode in ('descendant', 'escalate'):
        assert any(e[:3] == ('send', 101, 9) for e in kernel.events)
    if mode == 'natural':
        assert not any(e[0] == 'send' and e[2] != 0 for e in kernel.events)
# Every signal used a retained handle before that child was reaped. Numeric kill
# is absent from the supplied OS seam: a regression would fail immediately.
for i, event in enumerate(kernel.events):
    if event[0] == 'send' and event[2] != 0:
        assert ('open', event[1]) in kernel.events[:i]
        assert ('reap', event[1]) not in kernel.events[:i]
print(mode, 'PASS')
