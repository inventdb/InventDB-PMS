#!/usr/bin/env python3
"""Quick connectivity check against your InventDB instance.

Usage:
    python check_inventdb.py <username> <password>

It reads INVENTDB_BASE_URL / INVENTDB_NAMESPACE from your environment or .env,
attempts a login, calls /api/auth/me, and lists the namespace types. Use it to
confirm your credentials and connection before starting the app.
"""

from __future__ import annotations

import sys

import httpx

from app.config import get_settings


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2

    username, password = sys.argv[1], sys.argv[2]
    settings = get_settings()
    base = settings.base_url
    print(f"InventDB base URL : {base}")
    print(f"Namespace         : {settings.inventdb_namespace}\n")

    with httpx.Client(timeout=settings.inventdb_timeout) as client:
        print("-> POST /api/auth/login")
        r = client.post(
            f"{base}/api/auth/login",
            json={"username": username, "password": password},
        )
        if r.status_code >= 400:
            print(f"   FAILED [{r.status_code}]: {r.text}")
            return 1
        data = r.json()
        token = data.get("token")
        user = data.get("user", {})
        print(f"   OK  user={user.get('username')} role={user.get('role')}")

        headers = {"Authorization": f"Bearer {token}"}
        print("-> GET  /api/auth/me")
        me = client.get(
            f"{base}/api/auth/me",
            params={"app": settings.inventdb_app},
            headers=headers,
        )
        print(f"   [{me.status_code}] {me.text[:200]}")

        print(f"-> GET  /api/namespaces/{settings.inventdb_namespace}/types")
        types = client.get(
            f"{base}/api/namespaces/{settings.inventdb_namespace}/types",
            params={"metadata": "true"},
            headers=headers,
        )
        print(f"   [{types.status_code}] {types.text[:400]}")

    print("\nConnection check complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
