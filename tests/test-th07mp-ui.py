import json
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


PROJECT = Path(__file__).resolve().parents[1]
_adapter_contracts = json.loads(subprocess.run(
    ["node", "scripts/inspect-adapter-contract.mjs"],
    cwd=PROJECT,
    check=True,
    capture_output=True,
    text=True,
).stdout)
EXPECTED_PRODUCTS = [report["game"] for report in _adapter_contracts] + [
    f"{report['game']}mp" for report in _adapter_contracts if report["product"]["multiplayer"] is not None
]


def wait_for_text(page, selector: str, expected: str) -> None:
    page.wait_for_function(
        "args => document.querySelector(args.selector)?.textContent?.trim() === args.expected",
        arg={"selector": selector, "expected": expected},
    )


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit("usage: test-th07mp-ui.py URL")
    url = sys.argv[1]
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url, wait_until="load", timeout=30000)
        page.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
        if page.locator("#firstUseNoticeDialog").get_attribute("open") is not None:
            page.locator("#firstUseNoticeCloseHint").click()
            page.wait_for_function("document.querySelector('#firstUseNoticeDialog')?.open === false")

        products = page.locator(".game").evaluate_all(
            "els => els.map(el => el.dataset.product || el.dataset.game)"
        )
        assert products == EXPECTED_PRODUCTS
        assert page.locator("#mpNetworkDiagnostics").evaluate(
            "el => el.querySelector('#mpNetworkCheck').compareDocumentPosition(el.querySelector('#mpNetworkResults')) "
            "& Node.DOCUMENT_POSITION_FOLLOWING"
        )

        page.locator('.game[data-game="th06"]:not([data-product])').click()
        assert page.locator("#gameTitle").evaluate("el => getComputedStyle(el, '::before').content") in ("none", '""')

        # Both multiplayer products share one settings surface.  Keep the
        # storage tools immediately below the single-player settings toggle
        # and the Replay viewer as the final settings action.
        for product, game_id, title in (
            ("th06mp", "TH06 MP", "東方紅魔郷"),
            ("th07mp", "TH07 MP", "東方妖々夢"),
        ):
            page.locator(f'[data-product="{product}"]').click()
            page.wait_for_selector("#mpShell:not([hidden])")
            assert page.locator("#gameId").inner_text() == game_id
            assert page.locator("#gameTitle").inner_text() == title
            share_item = page.locator("#mpShareSettingsToggle").locator("xpath=ancestor::section[1]")
            file_tools = page.locator("#mpSettingsFold .mp-file-tools-grid")
            replay_wrap = page.locator("#mpReplayViewer").locator("xpath=ancestor::div[contains(@class,'mp-replay-launch-wrap')][1]")
            assert "共用单机设置" in (share_item.text_content() or "")
            assert "存档" in (file_tools.text_content() or "")
            assert "录像" in (file_tools.text_content() or "")
            assert (page.locator("#mpReplayViewer").text_content() or "").strip() == "观赏 Replay"
            assert page.locator("#mpSettingsFold .mp-settings-body").evaluate(
                "body => { const share = document.querySelector('#mpShareSettingsToggle')?.closest('section'); "
                "const files = document.querySelector('#mpSettingsFold .mp-file-tools-grid'); "
                "const replay = document.querySelector('#mpReplayViewer')?.closest('.mp-replay-launch-wrap'); "
                "return share?.parentElement === body && files?.parentElement === body && replay?.parentElement === body "
                "&& !!(share.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING) "
                "&& !!(files.compareDocumentPosition(replay) & Node.DOCUMENT_POSITION_FOLLOWING) "
                "&& replay === body.lastElementChild; }"
            )

        page.locator('[data-product="th06mp"]').click()
        page.locator("#mpCreateRoom").click()
        page.wait_for_selector("#mpRoomView:not([hidden])")
        page.wait_for_selector("#mpLocalPlayer:not([hidden])", timeout=10000)
        assert page.locator("#mpSettingsRoomDrawerToggle").is_visible()
        assert page.locator("#mpSettingsRoomDrawerToggle .mp-settings-room-cue-icon").is_visible()
        assert page.locator("#mpSettingsRoomDrawer").is_hidden()
        page.locator("#mpSettingsRoomDrawerToggle").click()
        assert page.locator("#mpSettingsRoomDrawer").is_visible()
        assert page.locator("#mpSettingsRoomDrawerToggle").is_hidden()
        assert page.locator("#mpSettingsFold").evaluate("el => el.parentElement?.id") == "mpSettingsRoomDrawerContent"
        assert page.locator("#mpSettingsFold .mp-fold-head").is_hidden()
        assert page.locator("#mpSettingsFold .mp-settings-body").is_visible()
        assert page.locator("#mpFocusHitboxOption").is_visible()
        page.locator("#mpFocusHitboxToggle").click()
        assert page.locator("#mpFocusHitboxToggle").get_attribute("aria-checked") == "true"
        drawer_padding = page.locator("#mpSettingsRoomDrawer").evaluate(
            "el => ({ left: parseFloat(getComputedStyle(el).paddingLeft), right: parseFloat(getComputedStyle(el).paddingRight) })"
        )
        assert drawer_padding["left"] >= 18 and drawer_padding["right"] >= 18
        assert page.locator("#mpSettingsRoomDrawerCloseHint").inner_text() == "右滑或点击该箭头关闭"
        box = page.locator("#mpSettingsRoomDrawer").bounding_box()
        assert box is not None
        page.mouse.move(box["x"] + 70, box["y"] + 260)
        page.mouse.down()
        page.mouse.move(box["x"] + 220, box["y"] + 260, steps=8)
        page.mouse.up()
        assert page.locator("#mpSettingsRoomDrawer").evaluate("el => el.classList.contains('closing')")
        assert page.locator("#mpSettingsRoomDrawerToggle").is_hidden()
        page.wait_for_selector("#mpSettingsRoomDrawer", state="hidden")
        assert page.locator("#mpSettingsRoomDrawerToggle").is_visible()
        page.locator("#mpSettingsRoomDrawerToggle").click()
        page.locator("#mpSettingsRoomDrawerCloseHint").click()
        assert page.locator("#mpSettingsRoomDrawer").evaluate("el => el.classList.contains('closing')")
        page.wait_for_selector("#mpSettingsRoomDrawer", state="hidden")
        assert page.locator("#mpRoomTitle").inner_text() == "東方紅魔郷"
        assert page.locator("#mpRoomView").get_attribute("aria-label") == "TH06 联机房间"
        th06_room_code = page.locator("#mpRoomCode").inner_text()
        assert page.evaluate("sessionStorage.getItem('eagler-touhou-th06mp-room-v1') !== null")
        assert page.evaluate("sessionStorage.getItem('eagler-touhou-th07mp-room-v1') === null")

        # The display code namespace is per product.  A TH07MP client joining
        # the exact same visible digits must enter a separate room and still
        # be able to occupy P1 while TH06MP's P1 remains occupied.
        other = browser.new_page(viewport={"width": 960, "height": 720})
        other.goto(url, wait_until="load", timeout=30000)
        other.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
        if other.locator("#firstUseNoticeDialog").get_attribute("open") is not None:
            other.locator("#firstUseNoticeCloseHint").click()
            other.wait_for_function("document.querySelector('#firstUseNoticeDialog')?.open === false")
        other.locator('[data-product="th07mp"]').click()
        other.locator("#mpJoinCode").fill(th06_room_code)
        other.locator("#mpJoinRoom").click()
        other.wait_for_selector("#mpRoomView:not([hidden])")
        other.wait_for_function("document.querySelector('#mpRoomView')?.hidden === false", timeout=10000)
        assert other.locator("#mpRoomTitle").inner_text() == "東方妖々夢"
        assert other.locator("#mpRoomView").get_attribute("aria-label") == "TH07 联机房间"
        assert other.locator("#mpRoomCode").inner_text() == th06_room_code
        other.wait_for_selector('[data-mp-seat-drop="0"] button:not([disabled])', timeout=10000)
        other.locator('[data-mp-seat-drop="0"] button').click()
        other.wait_for_selector("#mpLocalPlayer:not([hidden])", timeout=10000)
        assert page.locator("#mpLocalPlayer").is_visible()
        assert other.locator("#mpLocalPlayer").is_visible()
        assert other.evaluate("sessionStorage.getItem('eagler-touhou-th07mp-room-v1') !== null")
        assert other.evaluate("sessionStorage.getItem('eagler-touhou-th06mp-room-v1') === null")
        other.close()

        page.locator("#mpRoomSettingsToggle").click()
        assert page.locator('[data-mp-difficulty="4"]').is_visible()
        assert page.locator('[data-mp-difficulty="5"]').is_hidden()
        assert page.locator('#mpRoomDifficulty option[value="5"]').is_disabled()
        page.locator("#mpLeaveRoom").click()
        page.wait_for_selector("#mpRoomView", state="hidden")
        assert page.locator("#mpSettingsRoomDrawerToggle").is_hidden()
        assert page.locator("#mpSettingsFold").evaluate("el => el.parentElement?.id") == "mpShell"

        page.locator('[data-product="th07mp"]').click()
        page.wait_for_selector("#mpShell:not([hidden])")
        assert page.locator("#gameId").inner_text() == "TH07 MP"
        assert page.locator("#gameTitle").inner_text() == "東方妖々夢"
        assert page.locator("#mpTitleBadge").is_visible()
        assert page.locator(".game-th07mp .mp-card-mark").count() == 1
        assert page.locator(".game-th07mp .mp-game-title-badge").is_visible()
        assert page.locator("#mpShell > .mp-fold").count() == 1
        assert page.locator('[data-mp-fold="online"] > span').inner_text().strip() == "联机"
        assert "THCRAP" not in page.locator("#mpShell").inner_text()
        assert page.locator("#mpFrameLimitHintText").text_content() == page.locator("#frameLimitHintText").text_content()
        assert page.locator("#mpFrameLimitAppleNote").text_content() == page.locator("#frameLimitAppleNote").text_content()
        assert page.locator("#mpMusicSelect option").all_inner_texts() == page.locator("#musicSelect option").all_inner_texts()
        assert page.locator("#mpSettingsFold .mp-settings-body").is_visible()
        assert page.locator("#mpOnlineFold .mp-fold-body").is_visible()
        assert page.locator('[data-mp-fold="online"]').get_attribute("aria-expanded") == "true"
        assert page.locator('#mpCreateRoom').is_visible()

        assert page.locator("#mpMobileOptions").is_visible()
        assert page.locator("#mpMobileOptions").evaluate("el => !!el.closest('#mpSettingsFold')")
        assert page.locator("#mpMobileOptionsBody").evaluate("el => getComputedStyle(el).maxHeight") == "0px"
        page.locator("#mpMobileOptionsToggle").click()
        assert page.locator("#mpMobileOptions").evaluate("el => el.classList.contains('open')")
        assert page.locator("#mpFrameLimitAppleNote").is_visible()
        page.locator("#mpFrameLimitAppleNote").click()
        assert page.locator("#appleRefreshDialog").get_attribute("open") is not None
        page.locator("#appleRefreshClose").click()

        page.locator("#mpCreateRoom").click()
        page.wait_for_selector("#mpRoomView:not([hidden])")
        page.wait_for_selector("#mpLocalPlayer:not([hidden])", timeout=10000)
        room_code = page.locator("#mpRoomCode").inner_text()
        assert f"mpRoom={room_code}" in page.url
        assert not page.locator(".game").first.is_visible()
        assert page.locator("#mpLocalRoleLabel").inner_text() in ("灵梦 A", "灵梦 B", "魔理沙 A", "魔理沙 B", "咲夜 A", "咲夜 B")
        assert "准备" not in page.locator("#mpLocalRoleLabel").inner_text()
        assert "房主" not in page.locator("#mpLocalRoleLabel").inner_text()
        assert not page.locator("#mpRoomPlayerCount").is_disabled()
        assert page.locator("#mpStartGame").is_visible()
        assert page.locator("#mpRoomSettingsDrawer").is_visible()
        assert page.locator("#mpRoomSettings").is_hidden()
        for _ in range(6):
            if page.locator("#mpLocalRoleLabel").inner_text() == "魔理沙 B":
                break
            page.locator("#mpLoadoutNextSeat").click()
        assert page.locator("#mpLocalRoleLabel").inner_text() == "魔理沙 B"
        assert page.locator("#mpLocalRoleLabel").inner_text() != "魔理沙 B 未准备"

        # Leaving P1 leaves the room alive but ownerless.
        page.locator("#mpStandUp").click()
        assert page.locator("#mpLocalPlayer").is_hidden()
        assert page.locator("#mpRoomPlayerCount").is_disabled()
        assert page.locator("#mpReady").is_hidden()
        assert page.locator(".mp-room-footer").is_hidden()
        assert page.locator("#mpStartGame").is_hidden()
        assert page.locator("#mpRoomSettingsDrawer").is_hidden()

        # Any player may take P2, then move to P1 and become owner.
        page.locator('[data-mp-seat-drop="1"] button').click()
        assert page.locator("#mpLocalRoleLabel").inner_text() in ("灵梦 A", "灵梦 B", "魔理沙 A", "魔理沙 B", "咲夜 A", "咲夜 B")
        assert "未准备" not in page.locator("#mpLocalRoleLabel").inner_text()
        page.locator("#mpReady").click()
        wait_for_text(page, "#mpReady", "已准备")
        page.locator("#mpStandUp").click()
        page.locator('[data-mp-seat-drop="0"] button').click()
        assert "房主" not in page.locator("#mpLocalRoleLabel").inner_text()
        # Standing up relinquishes the ready state; re-arm it in the new seat.
        assert page.locator("#mpReady").inner_text() == "准备"
        page.locator("#mpReady").click()
        wait_for_text(page, "#mpReady", "已准备")

        page.locator("#mpRoomSettingsToggle").click()
        assert page.locator("#mpRoomSettings").is_visible()
        page.locator('[data-mp-player-count="3"]').click()
        assert page.locator('[data-mp-seat="2"]').is_visible()
        page.locator('[data-mp-difficulty="5"]').click()
        wait_for_text(page, "#mpReady", "准备")
        page.locator("#mpReady").click()
        wait_for_text(page, "#mpReady", "已准备")

        # Room page is a persistent page state: refresh stays in the same room.
        page.reload(wait_until="load", timeout=30000)
        page.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
        page.wait_for_selector("#mpRoomView:not([hidden])")
        assert page.locator("#mpRoomCode").inner_text() == room_code
        assert "房主" not in page.locator("#mpLocalRoleLabel").inner_text()
        assert page.locator("#mpReady").inner_text() == "已准备"
        assert page.locator("#mpRoomPlayerCount").input_value() == "3"
        assert page.locator("#mpRoomDifficulty").input_value() == "5"
        assert page.locator("#mpRoomDifficultyText").inner_text() == "Phantasm"
        assert not page.locator(".game").first.is_visible()

        # The in-room Return action is deterministic even after refresh: it
        # synchronously replaces the transient room route with the real home.
        page.locator("#mpLeaveRoom").click()
        page.wait_for_selector("#mpRoomView", state="hidden")
        assert "mpRoom=" not in page.url
        assert not page.locator("#main").evaluate("el => el.classList.contains('has-selection')")
        assert page.locator("#mpShell").is_hidden()

        # A fresh room route still participates in browser history. Back must
        # land on the same home state rather than another selected game card.
        page.locator('[data-product="th07mp"]').click()
        page.locator("#mpCreateRoom").click()
        page.wait_for_selector("#mpRoomView:not([hidden])")
        page.reload(wait_until="load", timeout=30000)
        page.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
        page.go_back(wait_until="load")
        page.wait_for_selector("#mpRoomView", state="hidden")
        assert "mpRoom=" not in page.url
        assert not page.locator("#main").evaluate("el => el.classList.contains('has-selection')")
        assert page.locator("#mpShell").is_hidden()

        mobile = browser.new_page(viewport={"width": 390, "height": 844})
        mobile.goto(url, wait_until="load", timeout=30000)
        mobile.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
        if mobile.locator("#firstUseNoticeDialog").get_attribute("open") is not None:
            mobile.locator("#firstUseNoticeCloseHint").click()
            mobile.wait_for_function("document.querySelector('#firstUseNoticeDialog')?.open === false")
        mobile.locator('[data-product="th07mp"]').click()
        mobile.locator("#mpCreateRoom").click()
        mobile.wait_for_selector("#mpRoomView:not([hidden])")
        room_text = mobile.locator("#mpRoomView").inner_text()
        assert "TH07 MULTIPLAYER" not in room_text
        assert "等待房间" not in room_text
        assert mobile.evaluate("scrollY") == 0
        assert mobile.locator("#mpInviteRoom").count() == 0
        assert mobile.locator('[data-mp-seat="0"]').is_visible()
        assert mobile.locator('[data-mp-seat="1"]').is_visible()
        assert mobile.locator("#mpCopyRoomCode").evaluate("el => el.tagName") == "BUTTON"
        assert mobile.locator(".mp-room-code-label").inner_text() == "房间号"
        assert mobile.locator(".mp-room-code-label").is_visible()
        assert mobile.locator(".mp-room-code-copy").is_visible()
        assert mobile.locator("#mpRoomCode").evaluate("el => getComputedStyle(el, '::before').content") in ("none", '""')
        assert mobile.locator("#mpRoomCode").evaluate("el => getComputedStyle(el, '::after').content") in ("none", '""')
        assert "加入游戏前可以选择角色" not in mobile.locator("#mpRoomView").inner_text()
        mobile.locator("#mpCopyRoomCode").click()
        copied_notice = mobile.locator("#toastText").inner_text()
        assert "已复制" in copied_notice or mobile.locator("#mpRoomCode").inner_text() in copied_notice
        mobile.locator("#mpRoomSettingsToggle").click()
        assert mobile.locator("#mpRoomSettings").is_visible()
        mobile.locator("#mpStandUp").click()
        assert mobile.locator("#mpUnseatedNote").is_visible()
        assert mobile.locator(".mp-spectator-loadout").is_visible()
        assert mobile.locator("#mpUnseatedNote").evaluate(
            "note => Boolean(note.compareDocumentPosition(document.querySelector('.mp-spectator-loadout')) & Node.DOCUMENT_POSITION_FOLLOWING)"
        )
        assert mobile.locator("#mpReady").is_hidden()
        assert mobile.locator(".mp-room-footer").is_hidden()
        assert mobile.locator("#mpStartGame").is_hidden()
        assert mobile.locator("#mpRoomSettingsDrawer").is_hidden()
        mobile.locator("#mpLeaveRoom").click()
        mobile.wait_for_selector("#mpRoomView", state="hidden")
        assert not mobile.locator("#main").evaluate("el => el.classList.contains('has-selection')")
        mobile.locator('[data-product="th07mp"]').click()
        assert mobile.locator("#mpTouchToggle").count() == 1
        assert mobile.locator("#mpTouchSensitivity").count() == 0
        mobile.locator("#mpMobileOptionsToggle").click()
        assert "按键布局 & 触控设置" in mobile.locator("#mpMobileOptions").inner_text()
        assert mobile.locator("#mpTouchLayoutEdit").is_visible()
        assert mobile.locator("#mpAlwaysHitboxToggle").is_visible()
        assert mobile.locator("#mpMagnifierToggle").is_visible()
        assert mobile.evaluate("document.documentElement.scrollWidth <= innerWidth")
        mobile.locator("#mpTouchLayoutEdit").click()
        mobile.wait_for_selector("#touchLayoutEditor:not([hidden])")
        assert mobile.locator("#player").evaluate("el => el.classList.contains('touch-layout-edit')")
        mobile.close()

        browser.close()

    if errors:
        print("TH07MP UI: FAIL " + json.dumps(errors, ensure_ascii=False))
        return 2
    print("TH07MP UI: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
