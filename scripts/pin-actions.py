#!/usr/bin/env python3
"""Rewrites `uses: owner/repo@tag` in .github/workflows to full commit SHAs (keeping the tag as a comment).

Run this on a machine with normal internet access (set GITHUB_TOKEN to avoid rate limits):
    GITHUB_TOKEN=... python3 scripts/pin-actions.py
Review the diff, then commit. Dependabot (github-actions ecosystem) keeps the SHAs updated afterwards.
"""
import json, os, pathlib, re, urllib.request

def get(url):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "shopsphere-pin"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20))

def resolve(repo, tag):
    obj = get(f"https://api.github.com/repos/{repo}/git/ref/tags/{tag}")["object"]
    if obj["type"] == "tag":  # annotated tag -> dereference to the commit
        obj = get(f"https://api.github.com/repos/{repo}/git/tags/{obj['sha']}")["object"]
    return obj["sha"]

pattern = re.compile(r"uses:\s+([\w.-]+/[\w./-]+)@([\w.-]+)\s*(#.*)?$")
for path in pathlib.Path(".github/workflows").glob("*.yml"):
    out = []
    for line in path.read_text().splitlines():
        m = pattern.search(line)
        if m and not re.fullmatch(r"[0-9a-f]{40}", m.group(2)):
            repo, tag = m.group(1), m.group(2)
            sha = resolve(repo, tag)
            line = line[: m.start()] + f"uses: {repo}@{sha} # {tag}"
            print(f"{path.name}: {repo}@{tag} -> {sha}")
        out.append(line)
    path.write_text("\n".join(out) + "\n")
