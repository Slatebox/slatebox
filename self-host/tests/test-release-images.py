#!/usr/bin/env python3
"""Exercise actual OCI registry reads and writes over loopback. Requires crane 0.20+."""

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
import urllib.request


TOOL = Path(__file__).resolve().parents[1] / "release-images.py"
APP, ENGINE, RELAY = "a" * 12, "b" * 12, "c" * 12
VERSION = "v1.2.3"


class RegistryRelease(unittest.TestCase):
    def test_matched_pair(self):
        with tempfile.TemporaryDirectory() as work:
            env = dict(os.environ, DOCKER_CONFIG=work)
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                host = f"127.0.0.1:{listener.getsockname()[1]}"
            server = subprocess.Popen(["crane", "registry", "serve", "--address", host],
                                      env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.addCleanup(server.wait, 5)
            self.addCleanup(server.terminate)
            for _ in range(50):
                try:
                    with urllib.request.urlopen(f"http://{host}/v2/", timeout=1):
                        break
                except OSError:
                    time.sleep(0.1)
            else:
                self.fail("Loopback registry did not start")
            namespace = host + "/slatebox"
            app, relay = namespace + "/slatebox", namespace + "/relay"

            def run(*args, check=True):
                return subprocess.run(args, env=env, text=True, capture_output=True, check=check)

            def crane(*args):
                return run("crane", *args).stdout.strip()

            def release(action, version=VERSION, check=True):
                return run(sys.executable, str(TOOL), action, version, APP, ENGINE, RELAY,
                           "--namespace", namespace, check=check)

            layer = Path(work, "layer.tar")
            with tarfile.open(layer, "w"):
                pass
            seed = namespace + "/fixture:seed"
            crane("append", "--oci-empty-base", "-f", str(layer), "-t", seed)

            def stage(repo, arch, revision):
                tag = f"{repo}:{VERSION}-{arch}"
                args = ["mutate", seed, "--set-platform", "linux/" + arch, "-l",
                        "org.opencontainers.image.revision=" + revision]
                if repo == app:
                    args += ["-l", "com.slatebox.engine.revision=" + ENGINE]
                crane(*args, "-t", tag)
                return crane("digest", tag)

            expected = {app: {}, relay: {}}
            for arch in ("amd64", "arm64"):
                expected[app][arch] = stage(app, arch, APP)
                expected[relay][arch] = stage(relay, arch, RELAY)
            release("check")
            self.assertNotIn(VERSION, crane("ls", app).splitlines())
            crane("tag", app + "@" + expected[app]["amd64"], VERSION + "-arm64")
            self.assertNotEqual(release("check", check=False).returncode, 0)
            crane("tag", app + "@" + expected[app]["arm64"], VERSION + "-arm64")
            crane("mutate", app + "@" + expected[app]["amd64"], "-l",
                  "com.slatebox.engine.revision=" + "e" * 12, "-t", app + ":" + VERSION + "-amd64")
            self.assertNotEqual(release("assemble", check=False).returncode, 0)
            self.assertNotIn(VERSION, crane("ls", relay).splitlines())
            crane("tag", app + "@" + expected[app]["amd64"], VERSION + "-amd64")
            stage(relay, "arm64", "d" * 12)
            self.assertNotEqual(release("assemble", check=False).returncode, 0)
            self.assertNotIn(VERSION, crane("ls", app).splitlines())
            stage(relay, "arm64", RELAY)
            # A conflicting pre-existing relay version must not be overwritten;
            # preflight must finish for both repositories before staging app.
            crane("tag", relay + ":" + VERSION + "-amd64", VERSION)
            self.assertNotEqual(release("assemble", check=False).returncode, 0)
            self.assertNotIn(VERSION, crane("ls", app).splitlines())
            # Prepare a new release name to avoid registry deletion semantics.
            clean_version = "v1.2.4"
            for repo, arches in expected.items():
                for arch, sha in arches.items():
                    crane("tag", repo + "@" + sha, clean_version + "-" + arch)
            self.assertNotEqual(release("promote", clean_version, check=False).returncode, 0)
            release("assemble", clean_version)
            receipts = {repo: crane("digest", repo + ":" + clean_version) for repo in expected}
            for repo, arches in expected.items():
                index = json.loads(crane("manifest", repo + "@" + receipts[repo]))
                self.assertEqual({m["platform"]["architecture"]: m["digest"] for m in index["manifests"]}, arches)
                self.assertNotIn("latest", crane("ls", repo).splitlines())
            release("assemble", clean_version)
            release("promote", clean_version)
            # Recover from an interrupted pair update (only app points at the release).
            crane("tag", relay + "@" + expected[relay]["amd64"], "latest")
            release("promote", clean_version)
            for repo, sha in receipts.items():
                self.assertEqual(crane("digest", repo + ":latest"), sha)
                self.assertEqual(crane("digest", repo + ":" + clean_version), sha)


if __name__ == "__main__":
    unittest.main()
