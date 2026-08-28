import json
import sys

from playwright.sync_api import sync_playwright


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
        if page.locator("#changelogDialog").get_attribute("open") is not None:
            page.locator("#changelogClose").click()

        page.locator('.game[data-game="th06"]').click()
        assert page.locator("#gameTitle").evaluate("el => getComputedStyle(el, '::before').content") in ("none", '""')

        page.locator('[data-product="th07mp"]').click()
        page.wait_for_selector("#mpShell:not([hidden])")
        assert page.locator("#gameId").inner_text() == "TH07 MP"
        assert page.locator("#gameTitle").inner_text() == "東方妖々夢"
        assert page.locator("#mpTitleBadge").is_visible()
        assert page.locator(".game-th07mp .mp-card-mark").count() == 1
        assert page.locator(".game-th07mp .mp-game-title-badge").is_visible()
        assert page.locator("#mpShell > .mp-fold").count() == 2
        assert page.locator('[data-mp-fold="settings"] > span').inner_text().strip() == "设置"
        assert page.locator('[data-mp-fold="online"] > span').inner_text().strip() == "联机"
        assert "THCRAP" not in page.locator("#mpShell").inner_text()
        assert page.locator("#mpFrameLimitHintText").text_content() == page.locator("#frameLimitHintText").text_content()
        assert page.locator("#mpFrameLimitAppleNote").text_content() == page.locator("#frameLimitAppleNote").text_content()
        assert page.locator("#mpMusicSelect option").all_inner_texts() == page.locator("#musicSelect option").all_inner_texts()
        assert page.locator("#mpSettingsFold .mp-fold-body").is_hidden()
        assert page.locator("#mpOnlineFold .mp-fold-body").is_visible()
        assert page.locator('[data-mp-fold="online"]').get_attribute("aria-expanded") == "true"
        page.wait_for_timeout(500)
        online_body = page.locator('#mpOnlineFold .mp-fold-body').bounding_box()
        create_button = page.locator('#mpCreateRoom').bounding_box()
        assert online_body and create_button
        assert create_button["y"] >= online_body["y"]
        assert create_button["y"] + create_button["height"] <= online_body["y"] + online_body["height"] + 1

        page.locator('[data-mp-fold="settings"]').click()
        page.wait_for_timeout(450)
        assert page.locator("#mpMobileOptions").is_visible()
        assert page.locator("#mpMobileOptions").evaluate("el => !!el.closest('#mpSettingsFold')")
        assert page.locator("#mpMobileOptionsBody").evaluate("el => getComputedStyle(el).maxHeight") == "0px"
        page.locator("#mpMobileOptionsToggle").click()
        page.wait_for_timeout(250)
        assert page.locator("#mpMobileOptions").evaluate("el => el.classList.contains('open')")
        assert page.locator("#mpFrameLimitAppleNote").is_visible()
        page.locator("#mpFrameLimitAppleNote").click()
        assert page.locator("#appleRefreshDialog").get_attribute("open") is not None
        page.locator("#appleRefreshClose").click()
        page.wait_for_timeout(250)

        page.locator("#mpCreateRoom").click()
        page.wait_for_selector("#mpRoomView:not([hidden])")
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
        assert page.locator("#mpReady").inner_text() == "已准备"
        page.locator("#mpStandUp").click()
        page.locator('[data-mp-seat-drop="0"] button').click()
        assert "房主" not in page.locator("#mpLocalRoleLabel").inner_text()
        # Standing up relinquishes the ready state; re-arm it in the new seat.
        assert page.locator("#mpReady").inner_text() == "准备"
        page.locator("#mpReady").click()
        assert page.locator("#mpReady").inner_text() == "已准备"

        page.locator("#mpRoomSettingsToggle").click()
        assert page.locator("#mpRoomSettings").is_visible()
        page.locator('[data-mp-player-count="3"]').click()
        assert page.locator('[data-mp-seat="2"]').is_visible()
        page.locator('[data-mp-difficulty="5"]').click()
        assert page.locator("#mpReady").inner_text() == "已准备"

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

        # Browser/system Back exits only the room and keeps the launcher page alive.
        page.go_back(wait_until="load")
        page.wait_for_selector("#mpRoomView", state="hidden")
        assert "mpRoom=" not in page.url
        assert page.locator("#mpShell").is_visible()

        mobile = browser.new_page(viewport={"width": 390, "height": 844})
        mobile.goto(url, wait_until="load", timeout=30000)
        mobile.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
        if mobile.locator("#changelogDialog").get_attribute("open") is not None:
            mobile.locator("#changelogClose").click()
        mobile.locator('[data-product="th07mp"]').click()
        mobile.locator("#mpCreateRoom").click()
        mobile.wait_for_selector("#mpRoomView:not([hidden])")
        mobile.wait_for_timeout(300)
        room_text = mobile.locator("#mpRoomView").inner_text()
        assert "TH07 MULTIPLAYER" not in room_text
        assert "等待房间" not in room_text
        assert mobile.evaluate("scrollY") == 0
        room_view = mobile.locator("#mpRoomView").bounding_box()
        back_button = mobile.locator("#mpLeaveRoom").bounding_box()
        seat_stage = mobile.locator("#mpSeatStage").bounding_box()
        first_seat = mobile.locator('[data-mp-seat="0"]').bounding_box()
        second_seat = mobile.locator('[data-mp-seat="1"]').bounding_box()
        room_body = mobile.locator(".mp-room-body").bounding_box()
        room_code_ticket = mobile.locator("#mpCopyRoomCode").bounding_box()
        action_row = mobile.locator(".mp-room-footer").bounding_box()
        settings_toggle = mobile.locator("#mpRoomSettingsToggle").bounding_box()
        assert room_view and back_button and seat_stage and first_seat and second_seat and room_body and room_code_ticket and action_row and settings_toggle
        # Measured against https://game.hullqin.cn/wzq/6461 at 390x844.
        assert abs(room_view["y"]) <= 1
        assert abs(back_button["x"] - 39) <= 1 and abs(back_button["y"] - 24) <= 1
        assert abs(back_button["width"] - 64) <= 1 and abs(back_button["height"] - 24) <= 1
        assert mobile.locator("#mpInviteRoom").count() == 0
        assert abs(seat_stage["y"] - 68) <= 1 and abs(seat_stage["height"] - 72) <= 1
        assert abs(first_seat["x"] - 123) <= 1 and abs(first_seat["y"] - 76) <= 1
        assert abs(first_seat["width"] - 56) <= 1 and abs(first_seat["height"] - 56) <= 1
        assert abs(second_seat["x"] - 211) <= 1 and abs(second_seat["y"] - 76) <= 1
        assert room_code_ticket["y"] >= room_body["y"] + room_body["height"] - 1
        assert abs((room_code_ticket["x"] + room_code_ticket["width"] / 2) - 195) <= 1
        assert abs(room_code_ticket["height"] - 54) <= 1
        assert mobile.locator("#mpCopyRoomCode").evaluate("el => el.tagName") == "BUTTON"
        assert mobile.locator(".mp-room-code-label").inner_text() == "房间号"
        assert mobile.locator(".mp-room-code-label").is_visible()
        assert mobile.locator(".mp-room-code-copy").is_visible()
        assert mobile.locator(".mp-room-code-label").evaluate("el => getComputedStyle(el).textAlign") == "center"
        assert mobile.locator("#mpRoomCode").evaluate("el => getComputedStyle(el, '::before').content") in ("none", '""')
        assert mobile.locator("#mpRoomCode").evaluate("el => getComputedStyle(el, '::after').content") in ("none", '""')
        assert mobile.locator("#mpCopyRoomCode").evaluate("el => getComputedStyle(el).borderTopWidth") == "0px"
        assert mobile.locator("#mpCopyRoomCode").evaluate("el => getComputedStyle(el).borderBottomWidth") == "0px"
        assert "加入游戏前可以选择角色" not in mobile.locator("#mpRoomView").inner_text()
        mobile.locator("#mpCopyRoomCode").click()
        mobile.wait_for_timeout(100)
        copied_notice = mobile.locator("#toastText").inner_text()
        assert "已复制" in copied_notice or mobile.locator("#mpRoomCode").inner_text() in copied_notice
        ready_box = mobile.locator("#mpReady").bounding_box()
        start_box = mobile.locator("#mpStartGame").bounding_box()
        assert ready_box and start_box
        assert abs(ready_box["y"] - start_box["y"]) <= 1
        assert settings_toggle["y"] > action_row["y"]
        mobile.locator("#mpRoomSettingsToggle").click()
        room_settings = mobile.locator("#mpRoomSettings").bounding_box()
        settings_toggle_open = mobile.locator("#mpRoomSettingsToggle").bounding_box()
        assert room_settings and settings_toggle_open
        assert room_settings["y"] < settings_toggle_open["y"]
        mobile.locator("#mpStandUp").click()
        spectator = mobile.locator("#mpUnseatedNote").bounding_box()
        spectator_loadout = mobile.locator(".mp-spectator-loadout").bounding_box()
        assert spectator and spectator_loadout
        assert spectator_loadout["y"] > spectator["y"]
        assert mobile.locator("#mpReady").is_hidden()
        assert mobile.locator(".mp-room-footer").is_hidden()
        assert mobile.locator("#mpStartGame").is_hidden()
        assert mobile.locator("#mpRoomSettingsDrawer").is_hidden()
        mobile.locator("#mpLeaveRoom").click()
        mobile.wait_for_selector("#mpRoomView", state="hidden")
        mobile.locator('[data-mp-fold="settings"]').click()
        mobile.wait_for_timeout(450)
        assert mobile.locator("#mpSettingsFold").evaluate("el => getComputedStyle(el).backgroundColor") == "rgba(0, 0, 0, 0)"
        assert mobile.locator("#mpSettingsFold .mp-setting-item").first.evaluate("el => getComputedStyle(el).backgroundColor") == "rgba(0, 0, 0, 0)"
        assert mobile.locator("#mpTouchToggle").count() == 1
        assert mobile.locator("#mpTouchSensitivity").count() == 0
        settings_before = mobile.locator("#mpSettingsFold").bounding_box()
        mobile.locator("#mpMobileOptionsToggle").click()
        mobile.wait_for_timeout(520)
        assert "TH06 / TH07 共用" in mobile.locator("#mpMobileOptions").inner_text()
        assert mobile.locator("#mpTouchLayoutEdit").is_visible()
        assert mobile.locator("#mpAlwaysHitboxToggle").is_visible()
        assert mobile.locator("#mpMagnifierToggle").is_visible()
        settings_after = mobile.locator("#mpSettingsFold").bounding_box()
        tools_after = mobile.locator(".tools").bounding_box()
        magnifier_box = mobile.locator("#mpMagnifierOption").bounding_box()
        assert settings_before and settings_after and tools_after and magnifier_box
        assert settings_after["height"] > settings_before["height"]
        assert magnifier_box["y"] + magnifier_box["height"] <= settings_after["y"] + settings_after["height"] + 1
        assert magnifier_box["y"] + magnifier_box["height"] <= tools_after["y"] + tools_after["height"] + 1
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
