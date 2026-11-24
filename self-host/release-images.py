#!/usr/bin/env python3
"""Verify a matched self-host image pair, assemble release indexes, or promote latest."""

import argparse
import json
import re
import subprocess
import sys


ARCHITECTURES = ("amd64", "arm64")
REVISION = "org.opencontainers.image.revision"
ENGINE = "com.slatebox.engine.revision"


def crane(*args):
    return subprocess.run(["crane", *args], check=True, stdout=subprocess.PIPE, text=True).stdout.strip()


def digest(ref):
    result = crane("digest", ref)
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", result):
        raise ValueError(f"Missing SHA-256 digest for {ref}")
    return result


def check_candidates(repo, version, labels):
    children = {}
    for arch in ARCHITECTURES:
        source = f"{repo}:{version}-{arch}"
        sha = digest(source)
        pinned = f"{repo}@{sha}"
        manifest = json.loads(crane("manifest", pinned))
        if "config" not in manifest:
            raise ValueError(f"{source} must reference a single image; push it with docker push --platform linux/{arch}")
        config = json.loads(crane("config", pinned))
        if (config.get("os"), config.get("architecture")) != ("linux", arch):
            raise ValueError(f"{source} is not linux/{arch}")
        actual = config.get("config", {}).get("Labels") or {}
        for key, value in labels.items():
            if actual.get(key) != value:
                raise ValueError(f"{source} has a mismatched {key}")
        children[arch] = sha
    return children


def check_index(repo, version, expected):
    source = f"{repo}:{version}"
    sha = digest(source)
    index = json.loads(crane("manifest", f"{repo}@{sha}"))
    items = index.get("manifests", [])
    platforms = {(p.get("platform", {}).get("os"), p.get("platform", {}).get("architecture")): p.get("digest")
                 for p in items}
    if len(items) != len(expected) or platforms != {("linux", arch): value for arch, value in expected.items()}:
        raise ValueError(f"{source} does not contain exactly the verified linux/amd64 and linux/arm64 images")
    return sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["check", "assemble", "promote"])
    parser.add_argument("version", help="Release version, for example v1.3.21")
    parser.add_argument("app_revision", help="Exact app revision label from build-images.sh")
    parser.add_argument("engine_revision", help="Exact engine revision label from build-images.sh")
    parser.add_argument("relay_revision", help="Exact relay revision label from build-images.sh")
    parser.add_argument("--namespace", default="ghcr.io/slatebox", help="Registry/namespace containing slatebox and relay")
    args = parser.parse_args()
    stable = r"v?(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
    if not re.fullmatch(stable, args.version):
        parser.error("supply a stable release version such as v1.3.21")
    if not all(re.fullmatch(r"(?:[0-9a-f]{12}|[0-9a-f]{40})", rev)
               for rev in [args.app_revision, args.engine_revision, args.relay_revision]):
        parser.error("supply the exact 12- or 40-character Git revision labels")
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]*(?::[0-9]+)?(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)+", args.namespace):
        parser.error("supply the registry hostname and namespace without a URL scheme")
    repos = {
        f"{args.namespace}/slatebox": {REVISION: args.app_revision, ENGINE: args.engine_revision},
        f"{args.namespace}/relay": {REVISION: args.relay_revision},
    }
    # Resolve all four candidate tags before the first registry write. Every
    # subsequent manifest operation uses these immutable child digests.
    children = {repo: check_candidates(repo, args.version, labels) for repo, labels in repos.items()}
    indexes = {}
    for repo in repos:
        if args.version in crane("ls", repo).splitlines():
            indexes[repo] = check_index(repo, args.version, children[repo])
        elif args.action == "promote":
            raise ValueError(f"Missing assembled release index {repo}:{args.version}")
    if args.action == "check":
        for repo, arches in children.items():
            for arch, sha in arches.items():
                print(f"{repo} linux/{arch} {sha}")
        return
    if args.action == "assemble":
        for repo in repos:
            if repo not in indexes:
                flags = [item for sha in children[repo].values() for item in ("-m", f"{repo}@{sha}")]
                crane("index", "append", *flags, "-t", f"{repo}:{args.version}")
                indexes[repo] = check_index(repo, args.version, children[repo])
    else:
        for repo, sha in indexes.items():
            crane("tag", f"{repo}@{sha}", "latest")
        # A registry updates the two tags separately. A failed verification is
        # a failed release; retry this exact pair before announcing latest.
        for repo, sha in indexes.items():
            if digest(f"{repo}:latest") != sha:
                raise ValueError(f"{repo}:latest does not resolve to the release index")
    for repo, sha in indexes.items():
        print(f"{repo}:{args.version} = {repo}@{sha}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f"Image release did not complete: {error}")
