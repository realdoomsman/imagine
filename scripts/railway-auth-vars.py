"""Set the auth/account variables on the Railway api service.

Reads the Google client secret from apps/api/.google-oauth.tmp and the wallet
master key + session secret from apps/api/.railway-secrets.tmp (both
gitignored). Run once; re-running is idempotent.
"""

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
oauth = json.loads((ROOT / "apps/api/.google-oauth.tmp").read_text())
secrets = dict(
    line.split("=", 1)
    for line in (ROOT / "apps/api/.railway-secrets.tmp").read_text().split("\n")
    if "=" in line
)

common = {
    "GOOGLE_CLIENT_ID": oauth["clientId"],
    "GOOGLE_CLIENT_SECRET": oauth["clientSecret"],
    "GOOGLE_REDIRECT_URI": "https://api.imagine.fun/api/auth/google/callback",
    "SITE_ORIGIN": "https://imagine.fun",
    "API_PUBLIC_ORIGIN": "https://api.imagine.fun",
    "WALLET_MASTER_KEY": secrets["WALLET_MASTER_KEY"],
    "SESSION_SECRET": secrets["SESSION_SECRET"],
    "COOKIE_SECURE": "1",
    "CORS_ORIGINS": "https://imagine.fun,https://www.imagine.fun",
}

railway = pathlib.Path.home() / "AppData/Roaming/npm/node_modules/@railway/cli/bin/railway.exe"
# Only the api service reads these; the indexer processes untrusted input and
# must not hold the wallet master key or the session secret.
for service in sys.argv[1:] or ["api"]:
    args = [str(railway), "variables", "--service", service, "--skip-deploys"]
    for key, value in common.items():
        args += ["--set", f"{key}={value}"]
    subprocess.run(args, check=True, cwd=ROOT)
    print(service, "set")
