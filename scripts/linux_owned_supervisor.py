"""Preparation only. Run in a dedicated, single-threaded Linux helper process.

Ownership begins at fork, never from a supplied PID/PGID. All signals use pidfds.
An unreaped direct child's PID cannot be reused: SIGCHLD is default and this
helper is the sole reaper. Subreaping makes orphan descendants our children.
Completion requires kernel ECHILD, including after the root has exited.
Unexpected helper death cannot be recovered from a saved numeric identity.
"""
import ctypes
import math
import os
import select
import signal
import sys
import time


WALL = 0x40000000  # Linux __WALL: include clone children regardless of exit signal.


class OwnershipHold(RuntimeError):
    pass


def validate_policy(policy):
    for key in ('run_seconds', 'grace_seconds', 'kill_seconds', 'poll_seconds'):
        value = policy.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise OwnershipHold('RESOURCE_PROCESS_POLICY_INVALID')
    if not math.isfinite(sum(policy[key] for key in ('run_seconds', 'grace_seconds', 'kill_seconds', 'poll_seconds'))):
        raise OwnershipHold('RESOURCE_PROCESS_POLICY_INVALID')


def prepare_kernel():
    if sys.platform != 'linux' or not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
        raise OwnershipHold('RESOURCE_KERNEL_OWNERSHIP_UNAVAILABLE')
    if len(os.listdir('/proc/self/task')) != 1:
        raise OwnershipHold('RESOURCE_SUPERVISOR_NOT_ISOLATED')
    # Python installs sigaction without SA_NOCLDWAIT here. No other thread or
    # Popen object is permitted to reap children in this dedicated helper.
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)
    try:
        os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | os.WNOWAIT | WALL)
    except ChildProcessError:
        pass
    else:
        raise OwnershipHold('RESOURCE_SUPERVISOR_NOT_ISOLATED')
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise OwnershipHold('RESOURCE_KERNEL_OWNERSHIP_UNAVAILABLE')
    enabled = ctypes.c_int()
    if libc.prctl(37, ctypes.byref(enabled), 0, 0, 0) != 0 or enabled.value != 1:
        raise OwnershipHold('RESOURCE_KERNEL_OWNERSHIP_UNAVAILABLE')
    fd = os.pidfd_open(os.getpid())
    try:
        signal.pidfd_send_signal(fd, 0)
    finally:
        os.close(fd)


class OwnedChildren:
    """Only this class reaps; handles are opened before identities are released."""
    def __init__(self, root, deadline):
        self.deadline = deadline
        self.root = root
        self.root_exit = None
        self.handles = {}
        self.term_sent = set()

    def check_deadline(self):
        if time.monotonic() >= self.deadline:
            raise OwnershipHold('RESOURCE_GROUP_UNCONFIRMED')

    def acquire(self):
        self.check_deadline()
        with open(f'/proc/self/task/{os.getpid()}/children', encoding='ascii') as stream:
            children = [int(value) for value in stream.read().split()]
        # All listed identities remain pinned by parenthood, including zombies,
        # until our reap() below. No external PID is accepted by this API.
        for pid in children:
            self.check_deadline()
            if pid not in self.handles:
                self.handles[pid] = os.pidfd_open(pid)

    def send(self, sig):
        for pid, fd in self.handles.items():
            self.check_deadline()
            if sig == signal.SIGTERM and pid in self.term_sent:
                continue
            try:
                signal.pidfd_send_signal(fd, sig)
            except ProcessLookupError:
                pass  # A dead handle is NOT completion; reap() must prove it.
            if sig == signal.SIGTERM:
                self.term_sent.add(pid)

    def reap(self):
        while True:
            self.check_deadline()
            try:
                pid, status = os.waitpid(-1, os.WNOHANG | WALL)
            except ChildProcessError:
                return True
            if pid == 0:
                return False
            if pid == self.root and self.root_exit is None:
                self.root_exit = os.waitstatus_to_exitcode(status)
            fd = self.handles.pop(pid, None)
            if fd is not None:
                os.close(fd)
            self.term_sent.discard(pid)

    def close(self):
        for fd in self.handles.values():
            os.close(fd)
        self.handles.clear()


def supervise(command, policy, cancel_fd=None):
    """Run one payload; return only after all owned children are reaped.

    SIGTERM/SIGINT or cancellation-pipe readiness begins bounded cleanup.
    A caller must retain this helper through grace+kill deadlines. SIGKILL or
    unexpected helper loss means UNCONFIRMED, never recover by numeric PGID.
    Payload streams are deliberately discarded in this preparation primitive.
    """
    validate_policy(policy)
    if not isinstance(command, list) or not command or any(not isinstance(x, str) or '\0' in x for x in command):
        raise OwnershipHold('RESOURCE_PROCESS_COMMAND_INVALID')
    try:
        prepare_kernel()
    except OSError as error:
        raise OwnershipHold('RESOURCE_KERNEL_OWNERSHIP_UNAVAILABLE') from error
    cancelled = False
    def cancel(_signum, _frame):
        nonlocal cancelled
        cancelled = True
    signal.signal(signal.SIGTERM, cancel)
    signal.signal(signal.SIGINT, cancel)
    # A closed or ready control pipe means the caller has already cancelled.
    # Check it before fork so a dead parent cannot launch new work.
    try:
        if cancel_fd is not None and select.select([cancel_fd], [], [], 0)[0]:
            cancelled = True
    except OSError as error:
        raise OwnershipHold('RESOURCE_GROUP_UNCONFIRMED') from error
    if cancelled:
        raise OwnershipHold('RESOURCE_LAUNCH_CANCELLED')
    root = os.fork()
    if root == 0:
        try:
            signal.signal(signal.SIGTERM, signal.SIG_DFL)
            signal.signal(signal.SIGINT, signal.SIG_DFL)
            if cancel_fd is not None:
                os.close(cancel_fd)
            null = os.open(os.devnull, os.O_RDWR)
            for fd in (0, 1, 2):
                os.dup2(null, fd)
            if null > 2:
                os.close(null)
            os.execvp(command[0], command)
        except BaseException:
            os._exit(127)
    deadline = time.monotonic() + policy['run_seconds']
    owner = OwnedChildren(root, deadline + policy['grace_seconds'] + policy['kill_seconds'])
    phase = 'running'
    reason = 'exited'
    try:
        while True:
            owner.acquire()
            if phase != 'running':
                owner.send(signal.SIGTERM if phase == 'grace' else signal.SIGKILL)
            gone = owner.reap()
            if gone:
                if owner.root_exit is None:
                    raise OwnershipHold('RESOURCE_GROUP_UNCONFIRMED')
                return {'cleanup': 'confirmed', 'reason': reason,
                        'root_exit': owner.root_exit}
            now = time.monotonic()
            if phase == 'running' and (cancelled or owner.root_exit is not None or now >= deadline):
                reason = 'cancelled' if cancelled else ('exited' if owner.root_exit is not None else 'deadline')
                phase = 'grace'
                deadline = now + policy['grace_seconds']
                owner.deadline = deadline + policy['kill_seconds']
                continue
            if now >= deadline:
                if phase == 'kill':
                    raise OwnershipHold('RESOURCE_GROUP_UNCONFIRMED')
                phase = 'kill'
                deadline = now + policy['kill_seconds']
                continue
            delay = min(policy['poll_seconds'], deadline - now)
            if cancel_fd is not None and phase == 'running':
                if select.select([cancel_fd], [], [], delay)[0]:
                    cancelled = True
            else:
                time.sleep(delay)
    except Exception as error:
        # No numeric fallback and no "gone" inference on permission/IO errors.
        raise OwnershipHold('RESOURCE_GROUP_UNCONFIRMED') from error
    finally:
        owner.close()
