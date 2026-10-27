#!/usr/bin/env python3
"""Exports Strimzi operator GA release dates for the /perf-dashboard/ markers.

Writes assets/data/strimzi-releases.json as [{"version", "date"}], newest first,
release candidates excluded. Uses GITHUB_TOKEN when set (the Pages workflow has
one) to avoid the anonymous API rate limit.
"""
import json
import os
import subprocess

API = "https://api.github.com/repos/strimzi/strimzi-kafka-operator/releases?per_page=50"
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "data", "strimzi-releases.json")


def main():
    cmd = ["curl", "-sSf", "--retry", "3", "--max-time", "60", "-H", "Accept: application/vnd.github+json"]
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        cmd += ["-H", f"Authorization: Bearer {token}"]
    releases = json.loads(subprocess.run(cmd + [API], capture_output=True, check=True).stdout)
    out = [{"version": r["tag_name"], "date": r["published_at"]}
           for r in releases if not r["prerelease"] and not r["draft"] and r["published_at"]]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f)
    print(f"{len(out)} releases written to {OUT}")


if __name__ == "__main__":
    main()
