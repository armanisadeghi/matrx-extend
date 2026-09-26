"""Fail-closed local canonical cleanup for receipt-proven Vault canary items.

The bearer token is accepted only in the JSON document on standard input.  This
adapter never writes a fixture, reaches the distributed Vault API, or emits
values, exception bodies, or bootstrap output.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import importlib.machinery
import importlib.util
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any

import httpx

REPO = Path("/Users/armanisadeghi/code")
# Secrets remain in the canonical working checkout. The optionally pinned
# source tree is import-only; it never receives a copied .env or dependencies.
AIDREAM_ENV_ROOT = REPO / "aidream"
ROUTER_RELATIVE = Path("aidream/api/routers/vault.py")
SERVICE_RELATIVE = Path("aidream/services/user_secrets/vault.py")
ADMIN_EMAIL = "admin@admin.com"
LOCAL_APP_BOOTSTRAP_TYPE_ERROR_STAGE = "build_local_app_bootstrap"
TRUSTED_AIDREAM_GIT_ROOT = Path("/Users/armanisadeghi/code/aidream")
TRUSTED_SOURCE_COMMIT = "b20c757670f5348f5d198f3a1c64d25a1343f5c3"
TRUSTED_SOURCE_GIT_TREE = "dbe91a70fbc62eb3c7496eb3fc8445c6f52ea54e"
TRUSTED_GIT = "/usr/bin/git"
REQUIRED_ARCHIVE_MODULES = (
    "aidream.api.routers.vault",
    "aidream.services.user_secrets.vault",
    "aidream.api.middleware.auth",
    "matrx_orm",
    "matrx_orm.secrets_battery",
    "matrx_connect",
)


class Refused(Exception):
    def __init__(self, code: str) -> None:
        self.code = code


class LocalAppBootstrapTypeError(Exception):
    pass


def refuse(condition: bool, code: str) -> None:
    if not condition:
        raise Refused(code)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _archive_relative(root: Path, path: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        raise Refused("source_tree_path_refused") from None


def _git_output(*args: str) -> bytes:
    try:
        return subprocess.run(
            [TRUSTED_GIT, "-C", str(TRUSTED_AIDREAM_GIT_ROOT), *args], check=True,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        raise Refused("trusted_git_refused") from None


def _trusted_git_entries() -> dict[str, tuple[str, str]]:
    tree = _git_output("rev-parse", f"{TRUSTED_SOURCE_COMMIT}^{{tree}}")
    refuse(tree.decode("ascii", "strict").strip() == TRUSTED_SOURCE_GIT_TREE, "trusted_git_tree_refused")
    entries: dict[str, tuple[str, str]] = {}
    for record in _git_output("ls-tree", "-rz", "--full-tree", "-r", TRUSTED_SOURCE_COMMIT).split(b"\0"):
        if not record:
            continue
        try:
            metadata, raw_path = record.split(b"\t", 1)
            mode, object_type, oid = metadata.decode("ascii", "strict").split(" ")
            relative = raw_path.decode("utf-8", "strict")
        except (UnicodeDecodeError, ValueError):
            raise Refused("trusted_git_tree_refused") from None
        refuse(object_type == "blob" and mode in {"100644", "100755", "120000"}, "trusted_git_tree_refused")
        refuse(relative not in entries and not relative.startswith("/") and ".." not in Path(relative).parts, "trusted_git_tree_refused")
        entries[relative] = (mode, oid)
    refuse(bool(entries), "trusted_git_tree_refused")
    return entries


def _git_blob_oid(content: bytes) -> str:
    return hashlib.sha1(f"blob {len(content)}\0".encode("ascii") + content).hexdigest()


def _symlink_target_is_internal(root: Path, link: Path, target: str) -> bool:
    if os.path.isabs(target):
        return False
    try:
        (link.parent / target).resolve().relative_to(root)
    except (OSError, ValueError):
        return False
    return True


def _archive_entries(source_root: Path) -> dict[str, tuple[str, str]]:
    root = source_root.resolve()
    refuse(root.is_dir() and not source_root.is_symlink(), "source_root_refused")
    entries: dict[str, tuple[str, str]] = {}
    def visit(directory: Path) -> None:
        for entry in sorted(directory.iterdir(), key=lambda candidate: candidate.name):
            relative = _archive_relative(root, entry)
            entry_stat = entry.lstat()
            if stat.S_ISDIR(entry_stat.st_mode):
                refuse(stat.S_IMODE(entry_stat.st_mode) == 0o500, "archive_mode_refused")
                visit(entry)
                continue
            if stat.S_ISREG(entry_stat.st_mode):
                content = entry.read_bytes()
                mode = "100755" if entry_stat.st_mode & stat.S_IXUSR else "100644"
                refuse(stat.S_IMODE(entry_stat.st_mode) == (0o555 if mode == "100755" else 0o444), "archive_mode_refused")
            elif stat.S_ISLNK(entry_stat.st_mode):
                target = os.readlink(entry)
                refuse(_symlink_target_is_internal(root, entry, target), "archive_link_escape")
                content = os.fsencode(target)
                mode = "120000"
            else:
                raise Refused("archive_entry_refused")
            refuse(relative not in entries, "archive_entry_refused")
            entries[relative] = (mode, _git_blob_oid(content))
    visit(root)
    return entries


def verify_git_derived_archive(source_root: Path) -> dict[str, str | int]:
    trusted = _trusted_git_entries()
    archive = _archive_entries(source_root)
    refuse(archive == trusted, "archive_git_tree_mismatch")
    return {"sourceCommit": TRUSTED_SOURCE_COMMIT, "sourceGitTree": TRUSTED_SOURCE_GIT_TREE, "sourceEntryCount": len(trusted)}


def _archive_package_dirs(source_root: Path) -> list[Path]:
    packages_root = source_root / "packages"
    refuse(packages_root.is_dir(), "archive_packages_refused")
    package_dirs: list[Path] = []
    for package in sorted(packages_root.iterdir(), key=lambda candidate: candidate.name):
        if not package.is_dir() or package.is_symlink():
            continue
        if any(
            child.is_dir() and not child.is_symlink() and (child / "__init__.py").is_file()
            for child in package.iterdir()
        ):
            package_dirs.append(package)
    refuse(bool(package_dirs), "archive_packages_refused")
    return package_dirs


def _path_is_inside(path: str | None, source_root: Path) -> bool:
    if not path:
        return False
    try:
        Path(path).resolve().relative_to(source_root.resolve())
    except (OSError, ValueError):
        return False
    return True


def prepare_archive_imports(source_root: Path) -> None:
    archive_paths = [str(source_root), *(str(path) for path in _archive_package_dirs(source_root))]
    sys.path[:0] = [entry for entry in archive_paths if entry not in sys.path]


def _verify_required_module_specs(source_root: Path, *, prepare: bool = True) -> None:
    if prepare:
        prepare_archive_imports(source_root)
    for module_name in REQUIRED_ARCHIVE_MODULES:
        search_paths = list(sys.path)
        parts = module_name.split(".")
        spec = None
        for index in range(len(parts)):
            partial_name = ".".join(parts[: index + 1])
            spec = importlib.machinery.PathFinder.find_spec(partial_name, search_paths)
            refuse(spec is not None, "required_import_origin_refused")
            refuse(_path_is_inside(spec.origin, source_root), "required_import_origin_refused")
            search_paths = list(spec.submodule_search_locations or ())


def verify_archive_import_closure(source_root: Path) -> None:
    _verify_required_module_specs(source_root)
    for module_name in REQUIRED_ARCHIVE_MODULES:
        module = sys.modules.get(module_name)
        refuse(module is not None, "required_import_origin_refused")
        refuse(_path_is_inside(getattr(module, "__file__", None), source_root), "required_import_origin_refused")
    for name, module in tuple(sys.modules.items()):
        if not (name == "aidream" or name.startswith(("aidream.", "matrx_orm", "matrx_connect"))):
            continue
        origin = getattr(module, "__file__", None)
        if origin is not None:
            refuse(_path_is_inside(origin, source_root), "loaded_import_origin_refused")


def loaded_security_module_snapshot(source_root: Path) -> dict[str, str]:
    """Return the small, already-loaded delete-path closure without walking the archive.

    This is deliberately narrower than the Git-tree admission above.  It is run
    immediately before each DELETE, so a newly loaded local package module or
    a changed loaded module fails closed without repeating the 21k-entry scan.
    """
    snapshot: dict[str, str] = {}
    for name, module in tuple(sys.modules.items()):
        if not (name == "aidream" or name.startswith(("aidream.", "matrx_orm", "matrx_connect"))):
            continue
        origin = getattr(module, "__file__", None)
        if origin is None:
            continue
        refuse(_path_is_inside(origin, source_root), "loaded_import_origin_refused")
        origin_path = Path(origin)
        origin_stat = origin_path.lstat()
        refuse(stat.S_ISREG(origin_stat.st_mode), "loaded_import_origin_refused")
        snapshot[name] = sha256(origin_path)
    for required in REQUIRED_ARCHIVE_MODULES:
        refuse(required in snapshot, "required_import_origin_refused")
    return snapshot


def verify_loaded_delete_closure(
    data: dict[str, Any], expected_snapshot: dict[str, str]
) -> None:
    source_root = Path(data["sourceRoot"])
    refuse(
        sha256(source_root / ROUTER_RELATIVE) == data["expectedRouterSha256"],
        "router_hash_mismatch",
    )
    refuse(
        sha256(source_root / SERVICE_RELATIVE) == data["expectedServiceSha256"],
        "service_hash_mismatch",
    )
    refuse(
        loaded_security_module_snapshot(source_root) == expected_snapshot,
        "loaded_delete_closure_changed",
    )


def uuid_text(value: Any, code: str) -> str:
    refuse(isinstance(value, str), code)
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError):
        raise Refused(code) from None


def ids(value: Any, code: str, *, minimum: int = 0, maximum: int = 16) -> list[str]:
    refuse(isinstance(value, list) and minimum <= len(value) <= maximum, code)
    result = [uuid_text(item, code) for item in value]
    refuse(len(set(result)) == len(result), code)
    return result


def parse_stdin() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(32768)
    refuse(bool(raw) and len(raw) < 32768, "input_refused")
    try:
        data = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise Refused("input_refused") from None
    refuse(
        isinstance(data, dict)
        and set(data)
        == {
            "token",
            "userId",
            "organizationId",
            "createKeys",
            "baselineIds",
            "provenIDs",
            "expectedRouterSha256",
            "expectedServiceSha256",
            "sourceRoot",
        },
        "input_shape_refused",
    )
    token = data["token"]
    refuse(
        isinstance(token, str)
        and 20 <= len(token) <= 8192
        and "\n" not in token
        and "\r" not in token,
        "token_refused",
    )
    data["userId"] = uuid_text(data["userId"], "user_id_refused")
    data["organizationId"] = uuid_text(
        data["organizationId"], "organization_id_refused"
    )
    data["createKeys"] = ids(data["createKeys"], "create_keys_refused", minimum=1)
    data["baselineIds"] = ids(data["baselineIds"], "baseline_ids_refused", maximum=64)
    data["provenIDs"] = ids(data["provenIDs"], "proven_ids_refused", minimum=1)
    refuse(len(data["createKeys"]) == len(data["provenIDs"]), "proven_count_refused")
    refuse(
        not set(data["baselineIds"]).intersection(data["provenIDs"]),
        "baseline_target_refused",
    )
    for key in ("expectedRouterSha256", "expectedServiceSha256"):
        value = data[key]
        refuse(
            isinstance(value, str)
            and len(value) == 64
            and all(char in "0123456789abcdef" for char in value),
            "source_hash_refused",
        )
    source_root = data["sourceRoot"]
    refuse(isinstance(source_root, str), "source_root_refused")
    source_path = Path(source_root)
    refuse(source_path.is_absolute() and source_path.is_dir(), "source_root_refused")
    data["sourceRoot"] = str(source_path.resolve())
    return data


def verify_sources(data: dict[str, Any]) -> dict[str, str | int]:
    source_root = Path(data["sourceRoot"])
    router_hash = sha256(source_root / ROUTER_RELATIVE)
    service_hash = sha256(source_root / SERVICE_RELATIVE)
    refuse(router_hash == data["expectedRouterSha256"], "router_hash_mismatch")
    refuse(service_hash == data["expectedServiceSha256"], "service_hash_mismatch")
    return {
        "router": router_hash,
        "service": service_hash,
        **verify_git_derived_archive(source_root),
    }


def load_reconciler():
    path = Path(__file__).with_name("reconcile-vault-canary.py")
    spec = importlib.util.spec_from_file_location("vault_canary_reconciler", path)
    refuse(spec is not None and spec.loader is not None, "reconciler_load_refused")
    module = importlib.util.module_from_spec(spec)
    with (
        contextlib.redirect_stdout(io.StringIO()),
        contextlib.redirect_stderr(io.StringIO()),
    ):
        spec.loader.exec_module(module)
    return module.reconcile_receipts


def build_local_app(data: dict[str, Any]):
    # The same minimal app setup as the Task 3 canonical-route proof.  Bootstrap
    # output is intentionally discarded; the Node parent never receives stderr.
    with (
        contextlib.redirect_stdout(io.StringIO()),
        contextlib.redirect_stderr(io.StringIO()),
    ):
        from dotenv import load_dotenv

        # The source root takes precedence before the first aidream import;
        # the runtime and secrets deliberately remain the existing checkout.
        source_root = Path(data["sourceRoot"])
        prepare_archive_imports(source_root)
        load_dotenv(AIDREAM_ENV_ROOT / ".env")
        from matrx_orm import register_platform_db

        register_platform_db(
            "supabase_automation_matrix",
            package="vault_canary_cleanup",
            additional_schemas=["auth"],
        )
        from aidream.package_integration import configure_packages

        configure_packages()
        from aidream.api.errors import register_error_handlers
        from aidream.api.middleware.auth import AuthMiddleware
        from aidream.api.routers import vault as vault_router
        from aidream.services.user_secrets import vault as vault_service
        from fastapi import FastAPI
        import matrx_connect
        from matrx_orm import secrets_battery

        refuse(
            Path(vault_router.__file__).resolve()
            == (source_root / ROUTER_RELATIVE).resolve(),
            "router_import_refused",
        )
        refuse(
            Path(vault_service.__file__).resolve()
            == (source_root / SERVICE_RELATIVE).resolve(),
            "service_import_refused",
        )
        verify_archive_import_closure(source_root)
        refuse(callable(vault_router.delete_item), "delete_path_import_refused")
        refuse(callable(vault_service.vault_delete_item), "delete_path_import_refused")
        refuse(matrx_connect is not None and secrets_battery is not None, "delete_path_import_refused")
        app = FastAPI()
        register_error_handlers(app, capture_system_errors=False)
        app.include_router(vault_router.router, prefix="/api/vault")
        app.add_middleware(AuthMiddleware)
    return app, loaded_security_module_snapshot(source_root)


async def verify_identity(token: str, user_id: str) -> None:
    key = os.environ.get("SUPABASE_MATRIX_PUBLISHABLE_KEY", "")
    refuse(bool(key), "identity_config_refused")
    async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
        response = await client.get(
            "https://db.matrxserver.com/auth/v1/user",
            headers={"apikey": key, "Authorization": f"Bearer {token}"},
        )
    refuse(response.status_code == 200, "identity_refused")
    try:
        identity = response.json()
    except ValueError:
        raise Refused("identity_refused") from None
    refuse(
        identity.get("id") == user_id and identity.get("email") == ADMIN_EMAIL,
        "identity_refused",
    )


async def run(data: dict[str, Any], hashes: dict[str, str | int]) -> dict[str, Any]:
    await verify_identity(data["token"], data["userId"])
    reconcile = load_reconciler()
    receipts = await reconcile(
        data["userId"], data["organizationId"], data["createKeys"]
    )
    refuse(len(receipts) == len(data["createKeys"]), "receipt_incomplete")
    receipt_ids = [row.get("result_item_id") for row in receipts]
    refuse(all(isinstance(item, str) for item in receipt_ids), "receipt_item_refused")
    receipt_ids = [uuid_text(item, "receipt_item_refused") for item in receipt_ids]
    refuse(len(set(receipt_ids)) == len(receipt_ids), "receipt_duplicate_item")
    refuse(set(receipt_ids) == set(data["provenIDs"]), "proven_ids_mismatch")
    refuse(
        not set(receipt_ids).intersection(data["baselineIds"]),
        "baseline_target_refused",
    )
    # The full Git-derived archive proof runs before custody.  Each DELETE then
    # rehashes only the imported security closure and router/service.
    try:
        app, delete_closure = build_local_app(data)
    except TypeError as exc:
        # A broad package bootstrap has one observed TypeError mode.  Mark
        # only that narrow boundary so the parent cannot mistake a handler or
        # cleanup TypeError for permission to use the distributed route.
        raise LocalAppBootstrapTypeError() from exc
    headers = {
        "Authorization": f"Bearer {data['token']}",
        "X-Organization-Id": data["organizationId"],
    }
    attempts: list[dict[str, str | int]] = []
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://vault-canary-local",
        timeout=30,
    ) as client:
        for item_id in receipt_ids:
            attempt: dict[str, str | int] = {
                "id": item_id,
                "initialGetStatus": "request_refused",
                "deleteStatus": "not_attempted",
                "finalGetStatus": "not_attempted",
                "terminal": "not_clean",
            }
            try:
                initial = await client.get(
                    f"/api/vault/items/{item_id}", headers=headers
                )
                attempt["initialGetStatus"] = initial.status_code
                if initial.status_code == 404:
                    attempt["terminal"] = "already_cleaned"
                elif initial.status_code == 200:
                    verify_loaded_delete_closure(data, delete_closure)
                    deleted = await client.delete(
                        f"/api/vault/items/{item_id}", headers=headers
                    )
                    attempt["deleteStatus"] = deleted.status_code
                    if deleted.status_code == 204:
                        final = await client.get(
                            f"/api/vault/items/{item_id}", headers=headers
                        )
                        attempt["finalGetStatus"] = final.status_code
                        if final.status_code == 404:
                            attempt["terminal"] = "deleted_and_missing"
            except Exception:
                pass
            attempts.append(attempt)
    complete = all(
        attempt["terminal"] in {"already_cleaned", "deleted_and_missing"}
        for attempt in attempts
    )
    result: dict[str, Any] = {
        "ok": complete,
        "identity": "admin_verified",
        "route": "local_canonical_authmiddleware",
        "provenance": "local_router_and_service_hash_pinned",
        "sourceSha256": hashes,
        "receiptCount": len(receipt_ids),
        "attempts": attempts,
    }
    if not complete:
        result["code"] = "cleanup_incomplete"
    return result


def _verify_source_root_args(args: list[str], *, checkout_fallback_test: bool = False) -> int:
    if len(args) != 3:
        result = {"ok": False, "code": "source_verify_args_refused"}
    else:
        source_root, router_hash, service_hash = args
        data = {
            "sourceRoot": source_root,
            "expectedRouterSha256": router_hash,
            "expectedServiceSha256": service_hash,
        }
        try:
            source_path = Path(source_root)
            refuse(source_path.is_absolute() and source_path.is_dir(), "source_root_refused")
            data["sourceRoot"] = str(source_path.resolve())
            hashes = verify_sources(data)
            if checkout_fallback_test:
                prepare_archive_imports(source_path)
                archived_connect = str(source_path / "packages" / "matrx-connect")
                checkout_connect = str(AIDREAM_ENV_ROOT / "packages" / "matrx-connect")
                refuse(Path(checkout_connect).is_dir(), "required_import_origin_refused")
                sys.path[:] = [entry for entry in sys.path if entry != archived_connect]
                sys.path.insert(0, checkout_connect)
                _verify_required_module_specs(source_path, prepare=False)
            try:
                build_local_app(data)
            except Exception:
                raise Refused("bootstrap_refused") from None
            result = {"ok": True, "source": hashes}
        except Refused as exc:
            result = {"ok": False, "code": exc.code}
        except Exception as exc:
            result = {"ok": False, "code": "internal_refused", "errorType": type(exc).__name__}
    sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
    return 0 if result["ok"] else 1


def main() -> int:
    if len(sys.argv) > 1:
        command, *args = sys.argv[1:]
        if command == "--verify-source-root":
            return _verify_source_root_args(args)
        if command == "--verify-import-closure":
            return _verify_source_root_args(args)
        if command == "--self-test-checkout-package-fallback":
            return _verify_source_root_args(args, checkout_fallback_test=True)
        if command == "--self-test-bootstrap-refusal":
            global build_local_app
            original_build_local_app = build_local_app
            try:
                def build_local_app(_data: dict[str, Any]):
                    raise RuntimeError("self-test bootstrap refusal")
                return _verify_source_root_args(args)
            finally:
                build_local_app = original_build_local_app
        sys.stdout.write('{"ok":false,"code":"source_verify_args_refused"}\n')
        return 1
    try:
        data = parse_stdin()
        # Runtime request handlers can emit console output after bootstrap.
        # Keep the whole operation off the JSON result channel.
        with tempfile.TemporaryDirectory(prefix="vault-canary-runtime-") as runtime_dir:
            previous_temp_dir = os.environ.get("MATRX_TEMP_DIR")
            os.environ["MATRX_TEMP_DIR"] = runtime_dir
            try:
                with (
                    contextlib.redirect_stdout(io.StringIO()),
                    contextlib.redirect_stderr(io.StringIO()),
                ):
                    hashes = verify_sources(data)
                    result = asyncio.run(run(data, hashes))
            finally:
                if previous_temp_dir is None:
                    os.environ.pop("MATRX_TEMP_DIR", None)
                else:
                    os.environ["MATRX_TEMP_DIR"] = previous_temp_dir
    except LocalAppBootstrapTypeError:
        result = {
            "ok": False,
            "code": "internal_refused",
            "errorType": "TypeError",
            "stage": LOCAL_APP_BOOTSTRAP_TYPE_ERROR_STAGE,
        }
    except Refused as exc:
        result = {"ok": False, "code": exc.code}
    except Exception as exc:
        result = {
            "ok": False,
            "code": "internal_refused",
            "errorType": type(exc).__name__,
        }
    sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
