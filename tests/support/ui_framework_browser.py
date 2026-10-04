"""Serve a verified Framework build only through isolated Playwright routes.

Build first with ``npm run build:ui``. EAGLER_UI_BUILD_DIRECTORY selects another
sealed build (including a nested-mount build); no launcher DOM is reconstructed.
The synthetic disposable GPU probe is test evidence, not hardware acceptance.
"""
from __future__ import annotations

import json
import mimetypes
import subprocess
from pathlib import Path
from urllib.parse import urlsplit


PROJECT = Path(__file__).resolve().parents[2]
ORIGIN = "https://framework-artifact.test"


class FrameworkArtifact:
    def __init__(self) -> None:
        # Reuse the publication verifier, including hashes, ownership and mount
        # checks. Never silently fall back to an obsolete or unsealed HTML file.
        result = subprocess.run(
            ["node", "--input-type=module", "-e", """
              import {uiBuildConfig} from './scripts/ui-build-config.mjs';
              import {readUiArtifact} from './lib/ui-artifact.mjs';
              import {readFile} from 'node:fs/promises';
              import assert from 'node:assert/strict';
              import {parse} from 'parse5';
              import {parse as parseScript} from 'acorn';
              const artifact = await readUiArtifact(uiBuildConfig().clientDirectory);
              const document = parse(await readFile(artifact.root + '/index.html', 'utf8'));
              const scripts = [];
              function visit(node) {if (node.tagName === 'script') scripts.push(node); for (const child of node.childNodes ?? []) visit(child);}
              visit(document);
              const first = scripts[0], attrs = Object.fromEntries(first.attrs.map(({name, value}) => [name, value]));
              assert.equal(attrs.id, 'browser-compatibility-gate');
              assert.equal(attrs['data-compatibility-url'], artifact.mountPath + 'compatibility.html');
              const gate = first.childNodes.map(node => node.value ?? '').join('');
              assert.equal(gate, await readFile('app/browser/compatibility-gate.js', 'utf8'));
              parseScript(gate, {ecmaVersion: 5, sourceType: 'script'});
              console.log(JSON.stringify({root: artifact.root,
                mountPath: artifact.mountPath, files: artifact.publishedFiles}));
            """],
            cwd=PROJECT, check=False, capture_output=True, text=True,
        )
        if result.returncode:
            raise RuntimeError("A current sealed Framework build is required; run npm run build:ui.\n" + result.stderr)
        verified = json.loads(result.stdout)
        self.root = Path(verified["root"])
        self.mount_path = verified["mountPath"]
        self.files = frozenset(verified["files"])
        self.base_url = ORIGIN + self.mount_path
        self.requests: list[str] = []
        for name in ("compatibility.html", "content/MULTIPLAYER.html"):
            assert (self.root / name).read_bytes() == (PROJECT / "public" / name).read_bytes(), (
                f"The sealed build must contain current canonical {name}; run npm run build:ui"
            )

    def install(self, context) -> None:
        # Intercept every request, so missing Host inputs and external URLs can
        # never accidentally reach a deployment or an unrelated local server.
        context.route("**/*", self.serve)

    def serve(self, route) -> None:
        url = urlsplit(route.request.url)
        if f"{url.scheme}://{url.netloc}" != ORIGIN or not url.path.startswith(self.mount_path):
            route.fulfill(status=404)
            return
        path = url.path[len(self.mount_path):]
        self.requests.append(path)
        # These tests enter only the library root. Assets must exist in the seal;
        # a missing asset must not receive the SPA HTML as a synthetic success.
        if not path:
            path = "index.html"
        if path not in self.files:
            route.fulfill(status=404)
            return
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if path.endswith((".js", ".mjs")):
            content_type = "text/javascript"
        route.fulfill(status=200, body=(self.root / path).read_bytes(), content_type=content_type)

    def install_probe(self, context, *, available: bool, guide: bool = False) -> None:
        """Mock only the early gate (and optionally standalone guide) probe.

        Restore the native canvas method immediately after that single call, or
        at DOMContentLoaded when a UA branch skips it. Framework/Runtime canvas
        calls are never synthetic. The guide gets its own new-document probe.
        """
        config = json.dumps({"available": available, "guide": guide,
                             "guidePath": self.mount_path + "compatibility.html"})
        context.add_init_script("(" + """config => {
          const prototype = HTMLCanvasElement.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getContext');
          const nativeGetContext = descriptor.value;
          const observation = window.__frameworkProbeFixture = {calls: 0, releases: 0, restored: false};
          function restore() {
            if (prototype.getContext === probeContext) Object.defineProperty(prototype, 'getContext', descriptor);
            observation.restored = prototype.getContext === nativeGetContext;
            document.removeEventListener('DOMContentLoaded', restore);
          }
          function probeContext(kind, ...attributes) {
            const script = document.currentScript;
            const gate = script?.id === 'browser-compatibility-gate'
              && script.getAttribute('data-compatibility-url') === config.guidePath;
            const standalone = config.guide && location.pathname === config.guidePath
              && script && !script.src && !script.type && document.getElementById('checks');
            if (kind === 'webgl2' && (gate || standalone)) {
              observation.calls++;
              restore();
              return config.available ? {isContextLost: () => false,
                getExtension: name => name === 'WEBGL_lose_context'
                  ? {loseContext() {observation.releases++;}} : null} : null;
            }
            return Reflect.apply(nativeGetContext, this, [kind, ...attributes]);
          }
          Object.defineProperty(prototype, 'getContext', {...descriptor, value: probeContext});
          document.addEventListener('DOMContentLoaded', restore, {once: true});
        }""" + ")(" + config + ");")


def suppress_automatic_notices(context) -> None:
    context.add_init_script("""(() => {
      localStorage.setItem('eagler-touhou-first-use-notice-seen-v1', '1');
      localStorage.setItem('eagler-touhou-site-notice-enabled-v1', '0');
    })();""")
