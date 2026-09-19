"""Fail-closed local canonical cleanup for receipt-proven Vault canary items.

The bearer token is accepted only in the JSON document on standard input.  This
adapter never writes a fixture, reaches the distributed Vault API, or emits
values, exception bodies, or bootstrap output.
"""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import uuid
from typing import Any

import httpx


REPO = Path("/Users/armanisadeghi/code")
# Secrets remain in the canonical working checkout. The optionally pinned
# source tree is import-only; it never receives a copied .env or dependencies.
AIDREAM_ENV_ROOT = REPO / "aidream"
ROUTER_RELATIVE = Path("aidream/api/routers/vault.py")
SERVICE_RELATIVE = Path("aidream/services/user_secrets/vault.py")
ADMIN_EMAIL = "admin@admin.com"


class Refused(Exception):
    def __init__(self, code: str) -> None:
        self.code = code


def refuse(condition: bool, code: str) -> None:
    if not condition:
        raise Refused(code)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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
    refuse(isinstance(data, dict) and set(data) == {
        "token", "userId", "organizationId", "createKeys", "baselineIds", "provenIDs",
        "expectedRouterSha256", "expectedServiceSha256", "sourceRoot",
    }, "input_shape_refused")
    token = data["token"]
    refuse(isinstance(token, str) and 20 <= len(token) <= 8192 and "\n" not in token and "\r" not in token, "token_refused")
    data["userId"] = uuid_text(data["userId"], "user_id_refused")
    data["organizationId"] = uuid_text(data["organizationId"], "organization_id_refused")
    data["createKeys"] = ids(data["createKeys"], "create_keys_refused", minimum=1)
    data["baselineIds"] = ids(data["baselineIds"], "baseline_ids_refused", maximum=64)
    data["provenIDs"] = ids(data["provenIDs"], "proven_ids_refused", minimum=1)
    refuse(len(data["createKeys"]) == len(data["provenIDs"]), "proven_count_refused")
    refuse(not set(data["baselineIds"]).intersection(data["provenIDs"]), "baseline_target_refused")
    for key in ("expectedRouterSha256", "expectedServiceSha256"):
        value = data[key]
        refuse(isinstance(value, str) and len(value) == 64 and all(char in "0123456789abcdef" for char in value), "source_hash_refused")
    source_root = data["sourceRoot"]
    refuse(isinstance(source_root, str), "source_root_refused")
    source_path = Path(source_root)
    refuse(source_path.is_absolute() and source_path.is_dir(), "source_root_refused")
    data["sourceRoot"] = str(source_path.resolve())
    return data


def verify_sources(data: dict[str, Any]) -> dict[str, str]:
    source_root = Path(data["sourceRoot"])
    router_hash = sha256(source_root / ROUTER_RELATIVE)
    service_hash = sha256(source_root / SERVICE_RELATIVE)
    refuse(router_hash == data["expectedRouterSha256"], "router_hash_mismatch")
    refuse(service_hash == data["expectedServiceSha256"], "service_hash_mismatch")
    return {"router": router_hash, "service": service_hash}


def load_reconciler():
    path = Path(__file__).with_name("reconcile-vault-canary.py")
    spec = importlib.util.spec_from_file_location("vault_canary_reconciler", path)
    refuse(spec is not None and spec.loader is not None, "reconciler_load_refused")
    module = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        spec.loader.exec_module(module)
    return module.reconcile_receipts


def build_local_app(data: dict[str, Any]):
    # The same minimal app setup as the Task 3 canonical-route proof.  Bootstrap
    # output is intentionally discarded; the Node parent never receives stderr.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        from dotenv import load_dotenv
        # The source root takes precedence before the first aidream import;
        # the runtime and secrets deliberately remain the existing checkout.
        source_root = Path(data["sourceRoot"])
        sys.path.insert(0, str(source_root))
        load_dotenv(AIDREAM_ENV_ROOT / ".env")
        from matrx_orm import register_platform_db
        register_platform_db("supabase_automation_matrix", package="vault_canary_cleanup", additional_schemas=["auth"])
        from aidream.package_integration import configure_packages
        configure_packages()
        from fastapi import FastAPI
        from aidream.api.errors import register_error_handlers
        from aidream.api.middleware.auth import AuthMiddleware
        from aidream.api.routers import vault as vault_router
        from aidream.services.user_secrets import vault as vault_service
        refuse(Path(vault_router.__file__).resolve() == (source_root / ROUTER_RELATIVE).resolve(), "router_import_refused")
        refuse(Path(vault_service.__file__).resolve() == (source_root / SERVICE_RELATIVE).resolve(), "service_import_refused")
        app = FastAPI()
        register_error_handlers(app, capture_system_errors=False)
        app.include_router(vault_router.router, prefix="/api/vault")
        app.add_middleware(AuthMiddleware)
    return app


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
    refuse(identity.get("id") == user_id and identity.get("email") == ADMIN_EMAIL, "identity_refused")


async def run(data: dict[str, Any], hashes: dict[str, str]) -> dict[str, Any]:
    await verify_identity(data["token"], data["userId"])
    reconcile = load_reconciler()
    receipts = await reconcile(data["userId"], data["organizationId"], data["createKeys"])
    refuse(len(receipts) == len(data["createKeys"]), "receipt_incomplete")
    receipt_ids = [row.get("result_item_id") for row in receipts]
    refuse(all(isinstance(item, str) for item in receipt_ids), "receipt_item_refused")
    receipt_ids = [uuid_text(item, "receipt_item_refused") for item in receipt_ids]
    refuse(len(set(receipt_ids)) == len(receipt_ids), "receipt_duplicate_item")
    refuse(set(receipt_ids) == set(data["provenIDs"]), "proven_ids_mismatch")
    refuse(not set(receipt_ids).intersection(data["baselineIds"]), "baseline_target_refused")
    # The pinned source is checked once before the app imports and again with
    # no await between the check and each local DELETE.
    hashes = verify_sources(data)
    app = build_local_app(data)
    headers = {"Authorization": f"Bearer {data['token']}", "X-Organization-Id": data["organizationId"]}
    attempts: list[dict[str, str | int]] = []
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://vault-canary-local", timeout=30) as client:
        for item_id in receipt_ids:
            attempt: dict[str, str | int] = {
                "id": item_id,
                "initialGetStatus": "request_refused",
                "deleteStatus": "not_attempted",
                "finalGetStatus": "not_attempted",
                "terminal": "not_clean",
            }
            try:
                initial = await client.get(f"/api/vault/items/{item_id}", headers=headers)
                attempt["initialGetStatus"] = initial.status_code
                if initial.status_code == 404:
                    attempt["terminal"] = "already_cleaned"
                elif initial.status_code == 200:
                    verify_sources(data)
                    deleted = await client.delete(f"/api/vault/items/{item_id}", headers=headers)
                    attempt["deleteStatus"] = deleted.status_code
                    if deleted.status_code == 204:
                        final = await client.get(f"/api/vault/items/{item_id}", headers=headers)
                        attempt["finalGetStatus"] = final.status_code
                        if final.status_code == 404:
                            attempt["terminal"] = "deleted_and_missing"
            except Exception:
                pass
            attempts.append(attempt)
    complete = all(attempt["terminal"] in {"already_cleaned", "deleted_and_missing"} for attempt in attempts)
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


def main() -> int:
    try:
        data = parse_stdin()
        # Runtime request handlers can emit console output after bootstrap.
        # Keep the whole operation off the JSON result channel.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            hashes = verify_sources(data)
            result = asyncio.run(run(data, hashes))
    except Refused as exc:
        result = {"ok": False, "code": exc.code}
    except Exception as exc:
        result = {"ok": False, "code": "internal_refused", "errorType": type(exc).__name__}
    sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
