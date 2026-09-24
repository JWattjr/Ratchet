"""Work around gltest's Windows stdin temp-file cleanup ordering.

gltest 0.30.0rc2 closes and unlinks the temp file after duplicating it onto
fd 0. Windows refuses to unlink the file while fd 0 still holds it open.
Keep the generated path on the VM and unlink it after gltest restores stdin.
This compatibility shim only affects the local direct-test process.
"""

from __future__ import annotations

import os
import tempfile


def install() -> None:
    if os.name != "nt":
        return

    from gltest.direct import loader, vm

    if getattr(loader, "_ratchet_windows_stdin_patch", False):
        return

    def inject_message_to_fd0(vm_context) -> None:
        calldata = loader.import_calldata()
        Address = loader.import_address()

        sender_addr = vm_context.sender
        if isinstance(sender_addr, bytes):
            sender_addr = Address(sender_addr)
        contract_addr = vm_context._contract_address
        if isinstance(contract_addr, bytes):
            contract_addr = Address(contract_addr)
        origin_addr = vm_context.origin
        if isinstance(origin_addr, bytes):
            origin_addr = Address(origin_addr)

        message_data = {
            "contract_address": contract_addr,
            "sender_address": sender_addr,
            "origin_address": origin_addr,
            "stack": [],
            "value": vm_context._value,
            "datetime": vm_context._datetime,
            "is_init": False,
            "chain_id": vm_context._chain_id,
            "entry_kind": 0,
            "entry_data": b"",
            "entry_stage_data": None,
        }

        fd, path = tempfile.mkstemp()
        try:
            os.write(fd, calldata.encode(message_data))
            os.lseek(fd, 0, os.SEEK_SET)
            vm_context._original_stdin_fd = os.dup(0)
            os.dup2(fd, 0)
            pending = getattr(vm_context, "_ratchet_stdin_paths", None)
            if pending is None:
                pending = []
                vm_context._ratchet_stdin_paths = pending
            pending.append(path)
        except BaseException:
            os.close(fd)
            try:
                os.unlink(path)
            except OSError:
                pass
            raise
        else:
            os.close(fd)

    original_cleanup = vm.VMContext._cleanup_after_deactivate
    original_nondet_patch = loader._patch_run_nondet_for_direct_mode

    def cleanup_after_deactivate(vm_context) -> None:
        try:
            original_cleanup(vm_context)
        finally:
            for path in getattr(vm_context, "_ratchet_stdin_paths", []):
                try:
                    os.unlink(path)
                except FileNotFoundError:
                    pass
            vm_context._ratchet_stdin_paths = []

    def patch_nondet_for_direct_mode() -> None:
        original_nondet_patch()
        try:
            import genlayer.vm as gl_vm
        except ImportError:
            return
        # genlayer-test's direct shim predates the pinned runner's unsafe
        # spelling. In direct mode, both call the same captured leader path.
        if not hasattr(gl_vm, "run_nondet_unsafe"):
            gl_vm.run_nondet_unsafe = gl_vm.run_nondet

    loader._inject_message_to_fd0 = inject_message_to_fd0
    loader._patch_run_nondet_for_direct_mode = patch_nondet_for_direct_mode
    vm.VMContext._cleanup_after_deactivate = cleanup_after_deactivate
    loader._ratchet_windows_stdin_patch = True
