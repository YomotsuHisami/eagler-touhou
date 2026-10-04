"""TEST-ONLY TH20 native touch adapter gate; TH20 remains a hidden product.

The separate verified-plan fixture owns the current createRuntimeService,
RuntimeViewport, RuntimeTouchOverlay and RuntimeControls. Trusted touch and host
keyboard input must reach actual __th20Runtime WebAssembly memory. Preserves
free-direction/rate-versus-unlimited movement, menu/two-finger pulses and
pause-menu ownership during dialogue. Requires explicit real Package/Runtime
inputs and a loopback assembled publication. Never starts a development server.
See tests/native-th20/README.md; mobile emulation is not physical-device proof.
"""
from __future__ import annotations

import math
import time
from playwright.sync_api import sync_playwright
from support.current_ui import runtime_frame
from support.th20_native import (arguments, inputs, inspect, runtime_eval,
                                  observe_failures, open_native, wait_presented, close_native)

VIEWPORT = {"width": 412, "height": 915}


PROBE = """() => {
  const core = globalThis.__th20Runtime?.core;
  if (!core) return null;
  const probe = new Float32Array(core.memory.buffer, core.sdl_touch_probe(), 28);
  const player = new Float32Array(core.memory.buffer, core.sdl_player_state(), 4);
  return {probe: Array.from(probe), player: Array.from(player)};
}"""

# [context, dragging, analog_active, analog_x, analog_y, confirm_pulse, escape_pulse, pause_state,
#  enabled, ready, motion, buttons_current, buttons_pressed, window_active,
#  confirm_pulses, escape_pulses, sample_ticks, unlimited_used, movement_mode, unlimited_mode,
#  pause_substate, pause_cursor, replay_mode, replay_frame, replay_stage, replay_cursor,
#  dialogue, replay_selection]
CONTEXT, DRAGGING, ANALOG, ANALOG_X, ANALOG_Y = 0, 1, 2, 3, 4
PAUSE_STATE, ENABLED, READY, BUTTONS, WINDOW_ACTIVE = 7, 8, 9, 11, 13
CONFIRM_PULSES, ESCAPE_PULSES, SAMPLE_TICKS = 14, 15, 16
UNLIMITED_USED, MOVEMENT_MODE, UNLIMITED_MODE = 17, 18, 19
PAUSE_SUBSTATE, PAUSE_CURSOR, DIALOGUE = 20, 21, 26


def state(page) -> dict | None:
    return runtime_eval(page, PROBE)


def key(page, code: str, down: bool) -> None:
    """Exercise the current host keyboard owner, not a direct native core call."""
    page.locator('main').focus()
    if down:
        page.keyboard.down(code)
    else:
        page.keyboard.up(code)


class MobileTouch:
    """The current RuntimeTouchOverlay direct-touch surface, driven with trusted touch events."""

    def __init__(self, page, context, rect):
        self.page = page
        self.rect = rect
        self.client = context.new_cdp_session(page)
        self.next_id = 1000

    def point(self, x: float, y: float) -> tuple[float, float]:
        return self.rect["x"] + x, self.rect["y"] + y

    def dispatch(self, kind: str, points) -> None:
        self.client.send("Input.dispatchTouchEvent", {
            "type": kind,
            "touchPoints": [{"x": x, "y": y, "id": identifier} for identifier, x, y in points],
        })

    def tap(self, x: float, y: float, hold_ms: int = 60) -> None:
        self.next_id += 1
        point = self.point(x, y)
        self.dispatch("touchStart", [(self.next_id, *point)])
        self.page.wait_for_timeout(hold_ms)
        self.dispatch("touchEnd", [])


def ticking(page, timeout: float = 15.0) -> bool:
    """Wait until the Runtime's frame loop is advancing its input samples."""
    first = state(page)
    if not first:
        return False
    deadline = time.time() + timeout
    while time.time() < deadline:
        page.wait_for_timeout(80)
        snapshot = state(page)
        if snapshot and snapshot["probe"][SAMPLE_TICKS] != first["probe"][SAMPLE_TICKS]:
            return True
    return False


def wait_enabled(page, timeout: float = 30.0) -> bool:
    """Wait for the Launcher's touch option to reach the Runtime."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        snapshot = state(page)
        if snapshot and snapshot["probe"][ENABLED] == 1:
            return True
        page.wait_for_timeout(200)
    return False


def wait_paused(page, paused: bool, timeout: float = 20.0) -> dict | None:
    deadline = time.time() + timeout
    snapshot = None
    while time.time() < deadline:
        snapshot = state(page)
        if snapshot and (snapshot["probe"][PAUSE_STATE] != 0) == paused:
            return snapshot
        page.wait_for_timeout(150)
    return None


def observed(page, index: int, timeout: float = 2.0, interval_ms: int = 20) -> bool:
    """Report whether a drained one-shot pulse counter became nonzero."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        snapshot = state(page)
        if snapshot and snapshot["probe"][index] != 0:
            return True
        page.wait_for_timeout(interval_ms)
    return False


def canvas_size(page) -> tuple[float, float]:
    size = runtime_eval(page, """() => {
      if (!globalThis.__th20Runtime) return null;
      const element = document.querySelector('canvas');
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? [rect.width, rect.height] : null;
    }""")
    assert size, "the Runtime canvas was never measurable"
    return float(size[0]), float(size[1])


def start_game(touch: MobileTouch, page, timeout: float = 25.0) -> None:
    """Start a run by tapping, the way a phone player does.

    Taps are the mobile path under test: the shared controller turns a tap in a
    menu/dialogue context into a confirm pulse, which the port maps onto the
    configured confirm binding. The title starts its attract loop about 30
    seconds in, so passing this bound means tapping advanced the menus rather
    than the demo reaching gameplay on its own.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        snapshot = state(page)
        if snapshot and snapshot["probe"][CONTEXT] == 1 and snapshot["player"][0] == 1 and snapshot["player"][1] == 1:
            return
        touch.tap(VIEWPORT["width"] / 2, VIEWPORT["height"] / 2)
        page.wait_for_timeout(700)
    raise RuntimeError(f"TH20 never reached gameplay by tapping: {state(page)}")


def run_drag(touch: MobileTouch, page, angle: float = -30.0, length_px: float = 60.0,
             samples: int = 45) -> list[tuple]:
    """Drag towards `angle` (up-right for -30) and return the per-frame trail.

    The expected field-space direction is derived from the Runtime canvas rect,
    because the Launcher hands over fractions of its canvas and the shared
    controller maps those to the 640x480 playfield. The drag is sampled while the
    finger is still down: the player reaches the target within a few frames and
    then reports no vector at all.
    """
    assert ticking(page), "the Runtime never advanced its input samples"
    width, height = canvas_size(page)
    # field_x = (px / canvas_width) * 640 and field_y = (py / canvas_height) * 480,
    # so this screen delta drags exactly along `angle` in field units and stays
    # well inside the playfield instead of pinning the player to a border.
    ratio = (height / 480.0) / (width / 640.0)
    dx = length_px
    dy = length_px * math.tan(math.radians(angle)) * ratio
    start_x, start_y = width / 2, height / 2
    assert start_x + dx < width and start_y + dy > 0, "the drag would leave the canvas"
    touch.next_id += 1
    identifier = touch.next_id
    touch.dispatch("touchStart", [(identifier, *touch.point(start_x, start_y))])
    page.wait_for_timeout(80)
    # The pre-move position is the first trail entry: the unlimited drag covers
    # its reach inside the first sampled frame, so the jump has to be visible.
    before = state(page)
    trail = []
    if before:
        probe = before["probe"]
        trail.append((0, before["player"][2], before["player"][3], 0.0, 0.0, probe[CONTEXT],
                      probe[DRAGGING], probe[ENABLED], probe[UNLIMITED_USED], probe[MOVEMENT_MODE]))
    touch.dispatch("touchMove", [(identifier, *touch.point(start_x + dx, start_y + dy))])
    for _ in range(samples):
        page.wait_for_timeout(16)
        snapshot = state(page)
        if snapshot:
            probe, player = snapshot["probe"], snapshot["player"]
            trail.append((probe[ANALOG], player[2], player[3], probe[ANALOG_X], probe[ANALOG_Y],
                          probe[CONTEXT], probe[DRAGGING], probe[ENABLED], probe[UNLIMITED_USED],
                          probe[MOVEMENT_MODE]))
    touch.dispatch("touchEnd", [])
    return trail


def drag_stats(trail: list[tuple]) -> dict:
    """Per-frame movement statistics of one drag (see `run_drag`).

    `first_ratio` is the share of the whole reach that the first sampled frame
    covered: an unlimited drag reaches the finger at once, a rate-limited one
    only advances by the player's own speed.
    """
    active = [sample for sample in trail if sample[0] == 1]
    steps = [math.hypot(trail[i][1] - trail[i - 1][1], trail[i][2] - trail[i - 1][2])
             for i in range(1, len(trail))]
    start, end = trail[0], trail[-1]
    total = math.hypot(end[1] - start[1], end[2] - start[2])
    first = steps[0] if steps else 0.0
    return {"active": len(active), "moving": len([s for s in active if math.hypot(s[3], s[4]) > 0]),
            "max_step": max(steps) if steps else 0.0, "total": total, "first_step": first,
            "first_ratio": first / total if total else 0.0,
            "max_vector": max((math.hypot(sample[3], sample[4]) for sample in active), default=0.0),
            "unlimited_used": trail[-1][8] if trail else None,
            "mode": trail[-1][9] if trail else None}


def drag_movement(touch: MobileTouch, page, angle: float = -30.0, length_px: float = 60.0,
                  samples: int = 45) -> tuple[float, float, float, list[tuple]]:
    """Drag and report (player path angle, analog vector angle, distance, trail)."""
    trail = run_drag(touch, page, angle, length_px, samples)
    active = [sample for sample in trail if sample[0] == 1]
    assert active, f"the drag never activated the direct-touch path: {trail[:3]}"
    moving = [sample for sample in active if math.hypot(sample[3], sample[4]) > 20]
    assert moving, f"the drag produced no movement vector: {active[:3]}"
    first, last = active[0], moving[-1]
    path_dx, path_dy = last[1] - first[1], last[2] - first[2]
    vector_x = sum(sample[3] for sample in moving)
    vector_y = sum(sample[4] for sample in moving)
    summary = {"active": len(active), "moving": len(moving), "first": trail[0], "last": trail[-1],
               "moving_head": moving[:2]}
    assert len(active) >= 5, f"the direct-touch path was active for too few frames: {summary}"
    assert math.hypot(path_dx, path_dy) > 10, f"the drag moved the player too little: {summary}"
    return (math.degrees(math.atan2(path_dy, path_dx)), math.degrees(math.atan2(vector_y, vector_x)),
            math.hypot(path_dx, path_dy), trail)


def open_runtime(page, context, verified, movement_mode: str) -> MobileTouch:
    """Prepare a real, newly imported epoch through the test-only component seam."""
    result = open_native(page, verified, music='none', movement=movement_mode)
    wait_presented(page, verified)
    assert result['context']['options']['touchMovementMode'] == movement_mode, result
    assert wait_enabled(page), f"The current owner's touch option never reached native input: {state(page)}"
    touch = MobileTouch(page, context, runtime_frame(page).bounding_box())
    start_game(touch, page)
    live = state(page)
    assert live['probe'][READY] == 1, f"Gameplay never reported a live player: {live}"
    assert live['probe'][WINDOW_ACTIVE] == 1, f"The input window is not active: {live}"
    assert live['probe'][MOVEMENT_MODE] == ['touch', 'touch-unlimited'].index(movement_mode), live
    return touch


def main() -> None:
    args = arguments(__doc__)
    verified = inputs(args)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            context = browser.new_context(viewport=VIEWPORT, has_touch=True, is_mobile=True,
                device_scale_factor=2, service_workers='block',
                user_agent='Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36')
            page = context.new_page()
            errors, data_requests = observe_failures(page)
            touch = open_runtime(page, context, verified, 'touch')

            # Free-direction movement: -30 degrees is not an octant of the
            # recovered eight-way input.
            path_angle, vector_angle, distance, trail = drag_movement(touch, page)
            assert abs(vector_angle - (-30)) < 15, (
                f"the ported movement vector is not the finger direction: {vector_angle:.1f} "
                f"(trail={trail[:3]})")
            assert abs(path_angle - (-30)) < 20, (
                f"the player did not travel along the drag: {path_angle:.1f} (trail={trail[:3]})")
            limited = drag_stats(trail)

            # Keyboard keeps the recovered eight-way path.
            before = state(page)["player"]
            key(page, "ArrowRight", True)
            page.wait_for_timeout(500)
            held = state(page)["probe"][BUTTONS]
            key(page, "ArrowRight", False)
            page.wait_for_timeout(120)
            after = state(page)["player"]
            assert held != 0, "the hosted keyboard key never reached the game input owner"
            assert after[2] - before[2] > 4, f"keyboard movement regressed: {before} -> {after}"

            # Pause menu: the shared controller must own the menu context so a
            # tap confirms and a two-finger tap cancels.
            assert page.get_by_role("button", name="ESC", exact=True).is_visible(), "the touch pause button is missing"
            page.get_by_role("button", name="ESC", exact=True).click()
            paused = wait_paused(page, True)
            assert paused, f"the Launcher's pause button never opened the menu: {state(page)}"
            assert paused["probe"][CONTEXT] == 0, f"the pause menu must report the menu context: {paused}"
            assert paused["probe"][ANALOG] == 0, "a paused game must not run the movement path"

            # A one-shot gesture pulse belongs to the state that produced it,
            # so a menu animation that is not accepting input yet drops it.
            # Retry the gesture the way a player would tap again.
            def confirm_by_tap() -> bool:
                for _ in range(3):
                    touch.tap(VIEWPORT["width"] / 2, VIEWPORT["height"] / 2)
                    assert observed(page, CONFIRM_PULSES), "a tap in the pause menu produced no confirm pulse"
                    if wait_paused(page, False, timeout=6.0):
                        return True
                    page.wait_for_timeout(500)
                return False

            def cancel_by_two_fingers() -> bool:
                for _ in range(3):
                    touch.next_id += 1
                    first_id, second_id = touch.next_id, touch.next_id + 1
                    touch.dispatch("touchStart", [
                        (first_id, *touch.point(VIEWPORT["width"] / 2 - 30, VIEWPORT["height"] / 2)),
                        (second_id, *touch.point(VIEWPORT["width"] / 2 + 30, VIEWPORT["height"] / 2))])
                    page.wait_for_timeout(70)
                    touch.dispatch("touchEnd", [])
                    assert observed(page, ESCAPE_PULSES), (
                        "a two-finger tap in the pause menu produced no cancel pulse")
                    if wait_paused(page, False, timeout=6.0):
                        return True
                    page.wait_for_timeout(500)
                return False

            assert confirm_by_tap(), f"a tap did not confirm/resume: {state(page)}"

            page.get_by_role("button", name="ESC", exact=True).click()
            assert wait_paused(page, True), f"the pause menu did not reopen: {state(page)}"
            assert cancel_by_two_fingers(), f"a two-finger tap did not cancel: {state(page)}"

            def menu_drag(dy_px: float) -> None:
                """Drag inside the pause menu; the menu owner turns it into arrows."""
                touch.next_id += 1
                identifier = touch.next_id
                x, y = VIEWPORT["width"] / 2, VIEWPORT["height"] / 2
                touch.dispatch("touchStart", [(identifier, *touch.point(x, y))])
                page.wait_for_timeout(80)
                touch.dispatch("touchMove", [(identifier, *touch.point(x, y + dy_px))])
                page.wait_for_timeout(450)
                touch.dispatch("touchEnd", [])
                page.wait_for_timeout(300)

            # A displayed dialogue must not steal the pause menu's gesture:
            # the phone's pause button opens the menu during a mid-stage
            # dialogue, and dragging then has to move the menu cursor (the
            # dialogue context has no menu owner at all).
            deadline = time.time() + 300
            while time.time() < deadline and state(page)["probe"][DIALOGUE] != 1:
                page.wait_for_timeout(500)
            assert state(page)["probe"][DIALOGUE] == 1, (
                f"no mid-stage dialogue appeared to test the pause menu against: {state(page)}")
            during_dialogue = None
            for _ in range(10):
                page.get_by_role("button", name="ESC", exact=True).click()
                during_dialogue = wait_paused(page, True, timeout=4.0)
                if during_dialogue:
                    break
            assert during_dialogue, f"the pause menu did not open during a dialogue: {state(page)}"
            assert during_dialogue["probe"][DIALOGUE] == 1, "the dialogue ended before the menu opened"
            assert during_dialogue["probe"][CONTEXT] == 0, (
                f"a dialogue pause menu must report the menu context: {during_dialogue}")
            cursor_before = during_dialogue["probe"][PAUSE_CURSOR]
            cursor_after = cursor_before
            for offset in (70.0, -70.0, 70.0):
                menu_drag(offset)
                cursor_after = state(page)["probe"][PAUSE_CURSOR]
                if cursor_after != cursor_before:
                    break
            assert cursor_before >= 0 and cursor_after != cursor_before, (
                f"dragging in a dialogue pause menu did not move the cursor: "
                f"{cursor_before} -> {cursor_after} (probe={state(page)['probe']})")
            assert confirm_by_tap(), f"the dialogue pause menu did not close: {state(page)}"
            dialogue_cursor = (cursor_before, cursor_after)

            # Second pass: the unlimited option ("touch-unlimited") must
            # actually remove the speed cap, so the same drag covers the
            # reach in far fewer frames. Merely enabling the option must not
            # mark the run; a non-zero unlimited movement consumed by
            # gameplay must (the Launcher protocol's cheat marker, which
            # forces a 100% drop rate on the Result/high-score and the saved
            # replay). A movement-mode change is applied at launch, so this
            # pass opens a fresh Runtime.
            close_native(page)
            touch = open_runtime(page, context, verified, "touch-unlimited")
            opted = state(page)
            assert opted["probe"][UNLIMITED_MODE] == 1, f"the unlimited mode was not adopted: {opted}"
            assert opted["probe"][UNLIMITED_USED] == 0, "enabling the option must not mark the run"
            unlimited = drag_stats(run_drag(touch, page))
            assert unlimited["total"] > 10, f"the unlimited drag moved nothing: {unlimited}"
            assert unlimited["first_ratio"] > 0.7, (
                f"the unlimited drag is still rate-limited: unlimited={unlimited} limited={limited}")
            assert limited["first_ratio"] < 0.4, (
                f"the rate-limited drag reached the finger at once: limited={limited}")
            assert state(page)["probe"][UNLIMITED_USED] == 1, "an unlimited drag did not mark the run"

            assert not data_requests, f"Managed DATA was fetched over HTTP: {data_requests}"
            assert not page.evaluate("window.__nativeTestIdbErrors"), page.evaluate("window.__nativeTestIdbErrors")
            close_native(page)
            assert not errors, errors
            print(f"TH20 TEST-ONLY native adapter touch: PASS path_angle={path_angle:.1f}deg vector_angle={vector_angle:.1f}deg "
                  f"distance={distance:.1f} limited_first={limited['first_ratio']:.2f} "
                  f"unlimited_first={unlimited['first_ratio']:.2f} unlimited_marked=ok "
                  f"dialogue_menu_cursor={dialogue_cursor[0]}->{dialogue_cursor[1]} "
                  "tap_confirm=ok two_finger_cancel=ok pause_button=ok keyboard=ok native_presented>=120; public product support remains hidden")
        finally:
            browser.close()


if __name__ == '__main__':
    main()
