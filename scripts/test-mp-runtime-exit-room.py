import sys

from playwright.sync_api import sync_playwright


def close_changelog(page) -> None:
    if page.locator("#changelogDialog").get_attribute("open") is not None:
        page.locator("#changelogClose").click()


def run_case(browser, base_url: str, product: str, game: str, game_label: str) -> None:
    page = browser.new_page(viewport={"width": 960, "height": 720})
    page.goto(base_url, wait_until="load", timeout=30000)
    page.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
    close_changelog(page)

    page.locator(f'[data-product="{product}"]').click()
    page.locator("#mpCreateRoom").click()
    page.wait_for_selector("#mpRoomView:not([hidden])", timeout=10000)
    page.wait_for_selector("#mpLocalPlayer:not([hidden])", timeout=10000)
    room_code = page.locator("#mpRoomCode").inner_text()
    assert room_code

    # The Player route is a transient view layered on top of the persistent
    # lobby room.  We do not need to boot a WASM runtime to test the exit
    # routing contract: inject the same authenticated same-frame message that
    # the hosted Runtime emits after main() returns/disconnects.
    page.evaluate(
        """() => {
          const player = document.querySelector('#player');
          player.classList.add('open');
          player.setAttribute('aria-hidden', 'false');
          document.body.classList.add('player-active');
          history.replaceState({
            ...(history.state || {}),
            eaglerTouhouPlayer: true,
            game: new URL(location.href).searchParams.get('game'),
          }, '', location.href);
        }"""
    )
    page.wait_for_function("document.querySelector('#player')?.classList.contains('open') === true")
    page.evaluate(
        """({ game }) => {
          const frame = document.querySelector('#gameFrame');
          window.dispatchEvent(new MessageEvent('message', {
            origin: location.origin,
            source: frame.contentWindow,
            data: {
              protocol: 'eagler-touhou/1',
              game,
              event: 'exit',
              status: 'error',
            },
          }));
        }""",
        {"game": game},
    )
    page.wait_for_function("document.querySelector('#player')?.classList.contains('open') === false", timeout=5000)

    assert page.locator("#mpRoomView").is_visible()
    assert page.locator("#mpRoomCode").inner_text() == room_code
    assert page.locator("#mpLocalPlayer").is_visible()
    assert page.locator("#gameId").inner_text() == game_label
    assert page.locator("#main").evaluate("el => el.classList.contains('has-selection')")
    assert f"game={product}" in page.url
    assert f"mpRoom={room_code}" in page.url
    assert page.evaluate(
        """({ product, roomCode }) => {
          const saved = JSON.parse(sessionStorage.getItem(`eagler-touhou-${product}-room-v1`) || 'null');
          return saved?.room?.code === roomCode;
        }""",
        {"product": product, "roomCode": room_code},
    )

    # Only the explicit leave-room action is allowed to destroy lobby state.
    page.locator("#mpLeaveRoom").click()
    page.wait_for_selector("#mpRoomView", state="hidden", timeout=5000)
    assert f"mpRoom={room_code}" not in page.url
    page.locator('.game[data-game="th06"]:not([data-product])').click()
    assert page.locator("#gameId").inner_text() == "TH06"
    page.close()


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit("usage: test-mp-runtime-exit-room.py URL")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        run_case(browser, sys.argv[1], "th06mp", "th06", "TH06 MP")
        run_case(browser, sys.argv[1], "th07mp", "th07", "TH07 MP")
        browser.close()
    print("MP Runtime exit -> room: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
