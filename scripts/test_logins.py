#!/usr/bin/env python3
"""
Test Firebase email/password logins against the axelrod project.

Usage:
    python3 scripts/test_logins.py <credentials_file>

Input file format: one credential per line, "email,password" (CSV).
Blank lines and lines starting with '#' are ignored. Whitespace around
values is trimmed.

Example:
    # team-1
    team1@example.com,SuperPass123
    team2@example.com,AnotherPass

Exit code: 0 if every login succeeds, 1 if at least one fails.

The API key below is the Firebase web config key — not a secret (it just
identifies the project; Firestore security comes from the rules). Override
with the AXELROD_FIREBASE_API_KEY env var if needed.
"""

import json
import os
import ssl
import sys
import urllib.error
import urllib.request


def build_ssl_context():
    """macOS Python from python.org often ships without a usable CA bundle,
    causing CERTIFICATE_VERIFY_FAILED. Prefer certifi if installed; fall back
    to the system default."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


SSL_CONTEXT = build_ssl_context()

API_KEY = os.environ.get(
    "AXELROD_FIREBASE_API_KEY",
    "AIzaSyApN-eX720BrAl8bnYdONjs38TY5pUW2lc",
)
PROJECT_ID = os.environ.get("AXELROD_FIREBASE_PROJECT_ID", "axelrod-6f71e")
SIGN_IN_URL = (
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
    f"?key={API_KEY}"
)
FIRESTORE_DOC_URL = (
    f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}"
    "/databases/(default)/documents/teams/{uid}"
)

# Friendlier rendering of Firebase REST error codes
ERROR_HINTS = {
    "EMAIL_NOT_FOUND": "no account with this email",
    "INVALID_PASSWORD": "wrong password",
    "INVALID_LOGIN_CREDENTIALS": "wrong email or password",
    "USER_DISABLED": "account disabled in Firebase",
    "TOO_MANY_ATTEMPTS_TRY_LATER": "rate-limited by Firebase — wait a bit",
    "INVALID_EMAIL": "malformed email",
    "MISSING_PASSWORD": "empty password",
}

# ANSI colors — disabled automatically when stdout isn't a tty
if sys.stdout.isatty():
    GREEN, RED, DIM, RESET = "\033[32m", "\033[31m", "\033[2m", "\033[0m"
else:
    GREEN = RED = DIM = RESET = ""


def parse_credentials(path):
    creds = []
    with open(path, "r", encoding="utf-8") as f:
        for lineno, raw in enumerate(f, 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if "," not in line:
                print(f"{RED}line {lineno}: missing comma, skipped: {line!r}{RESET}")
                continue
            email, password = line.split(",", 1)
            creds.append((lineno, email.strip(), password.strip()))
    return creds


def try_login(email, password):
    """Returns (ok: bool, uid_or_None, id_token_or_None, detail: str)."""
    payload = json.dumps(
        {"email": email, "password": password, "returnSecureToken": True}
    ).encode("utf-8")
    req = urllib.request.Request(
        SIGN_IN_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15, context=SSL_CONTEXT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            uid = data.get("localId")
            id_token = data.get("idToken")
            return True, uid, id_token, f"uid={uid}"
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
            code = body.get("error", {}).get("message", f"HTTP {e.code}")
        except Exception:
            code = f"HTTP {e.code}"
        short = code.split(" ")[0].split(":")[0]
        hint = ERROR_HINTS.get(short)
        return False, None, None, f"{code}" + (f" ({hint})" if hint else "")
    except urllib.error.URLError as e:
        reason = str(e.reason)
        if "CERTIFICATE_VERIFY_FAILED" in reason:
            reason += (
                "\n      → Fix: run '/Applications/Python 3.X/Install Certificates.command'"
                "\n        or 'pip3 install certifi' then re-run this script."
            )
        return False, None, None, f"network error: {reason}"


def _firestore_value(field):
    """Unwrap a Firestore REST field value (stringValue, integerValue, etc.)."""
    if not isinstance(field, dict) or len(field) != 1:
        return None
    return next(iter(field.values()))


def fetch_team_doc(uid, id_token):
    """Returns (status, fields_dict_or_None, detail).
    status is one of: 'ok', 'not_found', 'forbidden', 'error'.
    """
    url = FIRESTORE_DOC_URL.format(uid=uid)
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {id_token}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=15, context=SSL_CONTEXT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            fields = {k: _firestore_value(v) for k, v in (data.get("fields") or {}).items()}
            return "ok", fields, ""
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return "not_found", None, "no /teams doc for this uid"
        if e.code == 403:
            return "forbidden", None, "Firestore rules denied read"
        try:
            body = json.loads(e.read().decode("utf-8"))
            msg = body.get("error", {}).get("message", f"HTTP {e.code}")
        except Exception:
            msg = f"HTTP {e.code}"
        return "error", None, msg
    except urllib.error.URLError as e:
        return "error", None, f"network error: {e.reason}"


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)

    path = sys.argv[1]
    if not os.path.isfile(path):
        print(f"File not found: {path}", file=sys.stderr)
        sys.exit(2)

    creds = parse_credentials(path)
    if not creds:
        print("No credentials found in file.", file=sys.stderr)
        sys.exit(2)

    print(f"Testing {len(creds)} account(s) against project {PROJECT_ID}")
    print(f"Checks per account: auth · firestore /teams/{{uid}} · email match\n")
    ok_count = 0
    fail_count = 0
    width = max(len(email) for _, email, _ in creds)

    for lineno, email, password in creds:
        # Check 1: authentication
        auth_ok, uid, id_token, detail = try_login(email, password)
        if not auth_ok:
            fail_count += 1
            print(f"  {RED}✗{RESET} {email:<{width}}  auth: {RED}{detail}{RESET}")
            continue

        # Check 2: team doc exists
        status, fields, doc_detail = fetch_team_doc(uid, id_token)
        if status != "ok":
            fail_count += 1
            print(
                f"  {RED}✗{RESET} {email:<{width}}  "
                f"auth {GREEN}✓{RESET} · doc {RED}✗{RESET} ({doc_detail}) "
                f"{DIM}uid={uid}{RESET}"
            )
            continue

        # Check 3: stored email matches login email
        stored_email = fields.get("email")
        display_name = fields.get("display_name") or "?"
        if stored_email is None:
            fail_count += 1
            print(
                f"  {RED}✗{RESET} {email:<{width}}  "
                f"auth {GREEN}✓{RESET} · doc {GREEN}✓{RESET} · "
                f"email {RED}✗{RESET} (field missing) {DIM}name='{display_name}'{RESET}"
            )
        elif stored_email.strip().lower() != email.strip().lower():
            fail_count += 1
            print(
                f"  {RED}✗{RESET} {email:<{width}}  "
                f"auth {GREEN}✓{RESET} · doc {GREEN}✓{RESET} · "
                f"email {RED}✗{RESET} (stored: {stored_email!r}) {DIM}name='{display_name}'{RESET}"
            )
        else:
            ok_count += 1
            print(
                f"  {GREEN}✓{RESET} {email:<{width}}  "
                f"auth {GREEN}✓{RESET} · doc {GREEN}✓{RESET} · email {GREEN}✓{RESET} "
                f"{DIM}name='{display_name}'{RESET}"
            )

    print()
    if fail_count == 0:
        print(f"{GREEN}All {ok_count} account(s) passed all checks.{RESET}")
        sys.exit(0)
    else:
        print(f"{RED}{fail_count} failure(s){RESET}, {ok_count} success(es).")
        sys.exit(1)


if __name__ == "__main__":
    main()
