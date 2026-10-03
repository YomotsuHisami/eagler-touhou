// Validation-only instrumentation; deliberately excluded from release targets.
#include "Controller.hpp"
#include "Player.hpp"
#include "GameManager.hpp"
#include "netplay/NetplayInputConfig.hpp"
#include <SDL3/SDL.h>
#include <emscripten.h>

extern "C" {
EMSCRIPTEN_KEEPALIVE int KeyboardProbeButtons(int seat) { return g_CurFrameGameInputs[seat]; }
EMSCRIPTEN_KEEPALIVE int KeyboardProbeFocus(int seat) { return g_Players[seat].isFocus; }
EMSCRIPTEN_KEEPALIVE int KeyboardProbeStage() { return g_GameManager.currentStage; }
EMSCRIPTEN_KEEPALIVE int KeyboardProbeSDLShift()
{
    const bool *keys = SDL_GetKeyboardState(nullptr);
    return keys[SDL_SCANCODE_LSHIFT] || keys[SDL_SCANCODE_RSHIFT];
}
EMSCRIPTEN_KEEPALIVE void KeyboardProbeReset() { Controller::ResetKeyboard(); }
}
