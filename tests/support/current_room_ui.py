"""Semantic controls for real Framework multiplayer rooms.

These helpers never manufacture room state, Runtime readiness or native frames.
Callers select either an explicitly synthetic protocol publication or a complete
local native publication; the relay remains the room authority in both cases.
"""
from __future__ import annotations

import json
import re
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect

from support.current_ui import open_current, runtime_frame, runtime_url, wait_for_launch_action


def room(page):
    return page.locator('section[aria-label="Multiplayer room"]')


def room_code(page) -> str:
    room(page).wait_for(state="visible", timeout=30000)
    code = parse_qs(urlsplit(page.url).query).get("mpRoom", [""])[0]
    assert re.fullmatch(r"\d{4,8}", code), page.url
    expect(room(page).locator('header button').filter(has_text=re.compile(rf"Room code\s*{code}\s*Copy"))).to_be_visible()
    return code


def open_lobby(page, base: str, product: str):
    open_current(page, base, "lobby", game=product)
    page.get_by_role("button", name="Enter room code", exact=True).wait_for(state="visible")


def create_room(page, product: str, *, players: int = 2, difficulty: int = 1) -> str:
    page.get_by_role("button", name="Create room", exact=True).first.click()
    dialog = page.get_by_role("dialog", name="Create room", exact=True)
    dialog.get_by_label("Game", exact=True).select_option(product)
    dialog.get_by_label("Players", exact=True).select_option(str(players))
    dialog.get_by_label("Difficulty", exact=True).select_option(str(difficulty))
    dialog.get_by_role("button", name="Continue to create", exact=True).click()
    code = room_code(page)
    expect(room(page).get_by_role("article").nth(0).get_by_role("heading")).to_be_visible(timeout=30000)
    return code


def join_room(page, product: str, code: str, *, seat: int | None = None):
    page.get_by_role("button", name="Enter room code", exact=True).click()
    dialog = page.get_by_role("dialog", name="Enter room code", exact=True)
    dialog.get_by_label("Game", exact=True).select_option(product)
    dialog.get_by_label("Room code", exact=True).fill(code)
    dialog.get_by_role("button", name="Continue to join", exact=True).click()
    assert room_code(page) == code
    # Directory joins request the first free seat. Observe the confirmed seat
    # instead of trying to click an already-occupied legacy drop target.
    if seat is not None:
        wait_local_seat(page, seat)


def wait_local_seat(page, seat: int, *, timeout=30000):
    page.wait_for_function("""seat => {
      const articles = document.querySelectorAll('section[aria-label="Multiplayer room"] article');
      return articles[seat]?.querySelector('h2 span')?.textContent?.trim() === 'You';
    }""", arg=seat, timeout=timeout)


def wait_occupied(page, count: int):
    page.wait_for_function("""count => {
      const seats = [...document.querySelectorAll('section[aria-label="Multiplayer room"] article')];
      return seats.length === count && seats.every(seat => seat.querySelector('h2'));
    }""", arg=count, timeout=30000)


def room_panel(page, name: str):
    room(page).get_by_role("button", name=name, exact=True).click()
    dialog = page.get_by_role("dialog", name=name, exact=True)
    dialog.wait_for(state="visible")
    return dialog


def close_room_panel(page, dialog):
    dialog.get_by_role("button", name="Close", exact=True).click()
    dialog.wait_for(state="hidden")


def prepare_room(page, *, timeout=180000):
    root = room(page)
    root.get_by_role("button", name="Prepare resources", exact=True).click()
    expect(root.get_by_role("status").filter(has_text="Multiplayer resources ready")).to_be_visible(timeout=timeout)


def ready_room(page):
    room(page).get_by_role("button", name="Ready", exact=True).click()
    expect(room(page).get_by_role("button", name="Cancel ready status", exact=True)).to_be_enabled(timeout=30000)


def start_room(page):
    button = room(page).get_by_role("button", name="Start game", exact=True)
    expect(button).to_be_enabled(timeout=30000)
    button.click()


def wait_runtime(page, *, timeout=180000):
    visible = page.locator('[data-runtime-host][aria-hidden="false"]')
    wait_for_launch_action(page, visible.is_visible, timeout=timeout)
    visible.wait_for(state="visible", timeout=timeout)


def diagnostics_report(page) -> dict:
    menu = page.locator('[data-player-tools-menu]')
    if menu.count() and menu.get_attribute("open") is None:
        menu.locator('summary').click()
    page.get_by_role("button", name="Runtime diagnostics", exact=True).click()
    dialog = page.get_by_role("dialog", name="Runtime diagnostics", exact=True)
    expect(dialog.locator('[data-diagnostic-health]')).to_be_visible()
    dialog.locator("summary").filter(has_text="Diagnostic report").click()
    report = json.loads(dialog.get_by_label("Diagnostic report", exact=True).input_value())
    dialog.get_by_role("button", name="Close", exact=True).click()
    expect(dialog).to_be_hidden()
    return report


def launch_state(page) -> dict:
    return {"url": page.url, "frame": runtime_url(page),
            "runtimeVisible": page.locator('[data-runtime-host]').get_attribute('aria-hidden') == 'false',
            "alerts": page.get_by_role("alert").all_text_contents(),
            "status": page.get_by_role("status").all_text_contents()}


# Used only by explicitly synthetic protocol + real-relay integration lanes.
# Building and starting this publication happens when their CLI is run on an
# authorized machine, never as an implicit substitute for native acceptance.
from contextlib import contextmanager
from pathlib import Path
import os
import socket
import subprocess
import tempfile
import time


@contextmanager
def protocol_publication(games, *, with_relay=True, manual_preflight_frame=False):
    project = Path(__file__).resolve().parents[2]
    processes = []
    def free_port():
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(('127.0.0.1', 0)); return int(sock.getsockname()[1])
    def wait_port(process, port):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if process.poll() is not None: raise RuntimeError(f'Fixture service exited: {process.returncode}')
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=.25): return
            except OSError: time.sleep(.05)
        raise RuntimeError('Fixture service did not start')
    (project / '.cache').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='current-protocol-', dir=project / '.cache') as temporary:
        try:
            relay_url = ''
            if with_relay:
                port = free_port(); relay_url = f'ws://127.0.0.1:{port}/'
                env = dict(os.environ, EAGLER_NETPLAY_RELAY_HOST='127.0.0.1',
                           EAGLER_NETPLAY_RELAY_PORT=str(port), EAGLER_NETPLAY_STUN_URLS='')
                process = subprocess.Popen(['node', 'server/netplay-relay.mjs'], cwd=project,
                    env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                processes.append(process); wait_port(process, port)
            site = Path(temporary) / 'site'
            command = ['node', 'tests/support/build-current-protocol-fixture.mjs',
                       f'--output={site}', '--games=' + ','.join(games), '--ogg=0']
            if relay_url: command.append(f'--relay={relay_url}')
            if manual_preflight_frame: command.append('--manual-preflight-frame=1')
            built = subprocess.run(command, cwd=project, check=True, capture_output=True, text=True)
            metadata = json.loads(built.stdout.strip().splitlines()[-1])
            marker = json.loads((site / 'protocol-fixture.json').read_text())
            assert marker['nativeRuntime'] is False and marker['retailData'] is False, marker
            port = free_port()
            server = subprocess.Popen(['node', 'scripts/serve-static.mjs', str(site), str(port)],
                cwd=project, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            processes.append(server); wait_port(server, port)
            base = f'http://127.0.0.1:{port}' + metadata['mountPath']
            from support.current_ui import require_local_publication
            require_local_publication(base, games=tuple(game + 'mp' if with_relay else game for game in games))
            yield base, relay_url
        finally:
            for process in reversed(processes):
                if process.poll() is None: process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
