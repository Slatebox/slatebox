#!/usr/bin/env python3
"""Build the public CLI and MCP source archive from a committed app revision."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile

REPOSITORY = Path(__file__).resolve().parents[1]
PACKAGE = "packages/slatebox-mcp"
# This is the entire public distribution, including its two executable sources.
PUBLIC_FILES = {
    "package.json": 0o644,
    "LICENSE.md": 0o644,
    "README.md": 0o644,
    "src/cli.js": 0o755,
    "src/slatebox.js": 0o755,
    "src/server.js": 0o644,
    "src/http-server.js": 0o644,
    "src/describe.js": 0o644,
    "src/typed-tools.js": 0o644,
    "src/generated.js": 0o644,
    "src/client/index.js": 0o644,
    "src/exec/index.js": 0o644,
    "src/exec/local-runner.js": 0o644,
    "src/exec/result.js": 0o644,
    "src/exec/script-process.js": 0o644,
    # Generated from the app's action registry (scripts/generate-action-contract.mjs).
    "generated/client.json": 0o644,
    "generated/exec-tool.json": 0o644,
    "generated/guest-client.js": 0o644,
    "generated/slatebox.d.ts": 0o644,
}


def git(*args):
    return subprocess.check_output(["git", "-C", str(REPOSITORY), *args])


def write_new_or_identical(path, content):
    try:
        with path.open("xb") as handle:
            handle.write(content)
    except FileExistsError:
        if path.read_bytes() != content:
            raise SystemExit(f"{path.name} already exists with different content")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_directory", type=Path)
    parser.add_argument("--revision", default="HEAD")
    args = parser.parse_args()
    revision = git("rev-parse", "--verify", "--end-of-options", args.revision + "^{commit}").decode().strip()
    archive = io.BytesIO()

    with gzip.GzipFile(fileobj=archive, mode="wb", mtime=0, filename="") as compressed:
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as release:
            for name, mode in sorted(PUBLIC_FILES.items()):
                path = f"{PACKAGE}/{name}"
                entry = git("ls-tree", revision, "--", path).split()
                if not entry or entry[1] != b"blob" or int(entry[0], 8) != (0o100000 | mode):
                    raise SystemExit(f"Missing regular public file or incorrect executable mode: {path}")
                data = git("cat-file", "blob", entry[2].decode())
                if name == "package.json":
                    manifest = json.loads(data)
                    if manifest["name"] != "slatebox-mcp" or not re.fullmatch(r"\d+\.\d+\.\d+", manifest["version"]):
                        raise SystemExit("Unexpected package name or release version")
                    if manifest["bin"] != {"slatebox": "src/slatebox.js", "slatebox-mcp": "src/cli.js"}:
                        raise SystemExit("Expected the CLI and MCP executable paths")
                if name == "LICENSE.md" and data != git("show", f"{revision}:LICENSE.md"):
                    raise SystemExit("The packaged license differs from the app license")
                info = tarfile.TarInfo("package/" + name)
                info.mode, info.size = mode, len(data)
                release.addfile(info, io.BytesIO(data))

    content = archive.getvalue()
    name = f"{manifest['name']}-{manifest['version']}.tgz"
    digest = hashlib.sha256(content).hexdigest()
    args.output_directory.mkdir(parents=True, exist_ok=True)
    write_new_or_identical(args.output_directory / name, content)
    write_new_or_identical(args.output_directory / (name + ".sha256"), f"{digest}  {name}\n".encode())
    print(f"{revision}\n{digest}  {name}")


if __name__ == "__main__":
    main()
