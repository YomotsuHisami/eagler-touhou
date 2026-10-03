// Local TH11 Hosted smoke: Launcher language selection must reach native Runtime.
import puppeteer from "puppeteer-core";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const browserRoot = resolve(process.env.LOCALAPPDATA || "", "ms-playwright");
const installations = existsSync(browserRoot)
  ? readdirSync(browserRoot).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()
  : [];
const executablePath = process.env.EAGLER_CHROMIUM ||
  resolve(browserRoot, installations[0] || "", "chrome-win64/chrome.exe");
if (!existsSync(executablePath)) throw Error(`Chromium not found: ${executablePath}`);
const site = process.env.EAGLER_TEST_URL || "http://127.0.0.1:8135/";
const packagePath = process.env.EAGLER_TEST_PACKAGE;
if (packagePath && !existsSync(packagePath)) throw Error(`Package not found: ${packagePath}`);
const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
try {
  for (const language of packagePath ? ["ja", "lang_zh-hans", "lang_en"] : ["lang_zh-hans", "lang_en"]) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(new URL("?game=th11", site).href, { waitUntil: "networkidle2", timeout: 30000 });
    if (await page.$eval("#firstUseNoticeDialog", dialog => dialog.open)) {
      await page.evaluate(() => document.querySelector("#firstUseNoticeClose").click());
    }
    const hostedResourceRequests = [];
    if (packagePath) {
      await page.evaluate(() => document.querySelector("#gamePackageImport").click());
      await page.waitForFunction(() => !document.querySelector("#gameDataImportWindow").hidden);
      await (await page.$("#gameDataImportInput")).uploadFile(resolve(packagePath));
      try {
        await page.waitForFunction(() => document.querySelector("#gameDataImportWindow").hidden, { timeout: 30000 });
      } catch {
        const state = await page.evaluate(() => ({ reason: document.querySelector("#gameDataImportReason")?.textContent,
          status: document.querySelector("#status")?.textContent,
          decisions: [...document.querySelectorAll("dialog[open]")].map(item => ({ id: item.id, text: item.textContent })) }));
        throw Error(`TH11 package import failed: ${JSON.stringify({ state, errors })}`);
      }
      await page.setRequestInterception(true);
      page.on("request", request => {
        const path = new URL(request.url()).pathname;
        if (/^\/shared\/(?:msgothic\.ttc|unifont\.otf)$/.test(path) || /^\/games\/th11\/language\//.test(path)) {
          hostedResourceRequests.push(path); void request.abort();
        } else void request.continue();
      });
    }
    if (packagePath && process.env.EAGLER_TEST_OFFLINE === "1") {
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        const manifest = await fetch("runtime-manifest.json").then(response => response.json());
        const group = manifest.groups.find(item => item.root === "runtime/th11/");
        const paths = group ? group.current.files.map(file =>
          `${group.root}${group.current.generation}/${file.path}`) : [];
        if (!paths.length) throw Error("TH11 Runtime is absent from App Shell manifest");
        const channel = new MessageChannel();
        const prepared = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error("TH11 offline cache timed out")), 30000);
          channel.port1.onmessage = event => {
            clearTimeout(timer);
            if (event.data?.ok) resolve(); else reject(Error(event.data?.error || "offline cache failed"));
          };
        });
        (navigator.serviceWorker.controller || registration.active).postMessage(
          { type: "CACHE_APP_SHELL_PATHS", paths }, [channel.port2]);
        await prepared;
      });
      await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await page.setOfflineMode(true);
      await page.reload({ waitUntil: "load", timeout: 30000 });
      await page.waitForFunction(() => window.__eaglerBoot?.done === true);
      await page.evaluate(() => document.querySelector("#firstUseNoticeDialog")?.close());
    }
    await page.select("#languageSelect", language);
    await page.select("#musicSelect", "ogg-stream");
    await page.evaluate(() => document.querySelector("#launch").click());
    if (packagePath) {
      await page.waitForFunction(() => document.querySelector("#decisionDialog")?.open ||
        [...document.querySelectorAll("iframe")].some(item => !!item.src), { timeout: 15000 });
      if (await page.$eval("#decisionDialog", item => item.open)) {
        await page.evaluate(() => document.querySelector("#decisionCancel").click());
      }
    }
    try { await page.waitForFunction(language => {
      const frame = [...document.querySelectorAll("iframe")].find(item => item.contentWindow?.core?.th11_phase);
      const error = document.querySelector("#startupErrorText")?.textContent || "";
      return (frame?.contentWindow?.core?.th11_frame?.() > 120 &&
        (language === "ja" || !!frame.contentWindow.FS?.analyzePath("/thcrap/th11/localization/options.json").exists)) || !!error;
    }, { timeout: 30000 }, language); } catch {
      const state = await page.evaluate(() => ({ status: document.querySelector("#status")?.textContent,
        reason: document.querySelector("#gameDataImportReason")?.textContent,
        startup: document.querySelector("#startupErrorText")?.textContent,
        decision: { hidden: document.querySelector("#decisionDialog")?.hidden, text: document.querySelector("#decisionDialog")?.textContent },
        dialogs: [...document.querySelectorAll("dialog[open]")].map(item => ({ id: item.id, text: item.textContent })),
        frames: [...document.querySelectorAll("iframe")].map(item => ({ url: item.src, frame: item.contentWindow?.core?.th11_frame?.(), error: item.contentDocument?.querySelector("#error")?.textContent })) }));
      throw Error(`TH11 startup failed: ${JSON.stringify({ language, state, errors, hostedResourceRequests })}`);
    }
    const result = await page.evaluate(() => {
      const frame = [...document.querySelectorAll("iframe")].find(item => item.contentWindow?.core?.th11_phase);
      const fs = frame?.contentWindow?.FS;
      const exists = path => !!fs?.analyzePath(path).exists;
      return {
        selected: document.querySelector("#languageSelect")?.value,
        phase: frame?.contentWindow?.core?.th11_phase(),
        frame: frame?.contentWindow?.core?.th11_frame(),
        error: document.querySelector("#startupErrorText")?.textContent ||
          frame?.contentDocument?.querySelector("#error")?.textContent || "",
        files: {
          options: exists("/thcrap/th11/localization/options.json"),
          strings: exists("/thcrap/th11/localization/strings.etl"),
          dialogue: exists("/thcrap/th11/st01_00a.msg"),
          ending: exists("/thcrap/th11/e00.msg"),
          image: exists("/thcrap/th11/ascii/pause.png"),
          font: exists("/thcrap/th11/fonts/unifont-15.1.05-subset.otf"),
        },
        sharedFonts: { japanese: exists("/msgothic.ttc"), unicode: exists("/unifont.otf") },
      };
    });
    console.log(JSON.stringify({ language, imported: !!packagePath,
      offlineReload: process.env.EAGLER_TEST_OFFLINE === "1", ...result, errors, hostedResourceRequests }));
    if (result.selected !== language || result.phase == null || result.frame <= 120 || result.error ||
        (language !== "ja" && Object.values(result.files).some(value => !value)) || errors.length ||
        hostedResourceRequests.length || (packagePath && Object.values(result.sharedFonts).some(value => !value))) {
      throw Error(`TH11 ${language} localization smoke failed`);
    }
    if (language === "lang_zh-hans" && process.env.EAGLER_TEST_SCREENSHOT) {
      await page.screenshot({ path: resolve(process.env.EAGLER_TEST_SCREENSHOT) });
    }
    if (language === "lang_zh-hans" && process.env.EAGLER_TEST_STORY === "1") {
      const frame = page.frames().find(item => item.url().includes("th11.html"));
      if (!frame) throw Error("TH11 Runtime frame not found");
      await frame.evaluate(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        for (let index = 0; index < 4; index++) {
          core.th11_key(44, 1); await wait(70); core.th11_key(44, 0); await wait(800);
        }
      });
      await page.waitForFunction(() => [...document.querySelectorAll("iframe")].some(item =>
        item.contentWindow?.core?.th11_phase?.() === 1) ||
        !!document.querySelector("#startupErrorText")?.textContent, { timeout: 30000 });
      const story = await frame.evaluate(() => ({ phase: core.th11_phase(), frame: core.th11_frame(), error: document.querySelector("#error")?.textContent || "" }));
      console.log(JSON.stringify({ language, story }));
      if (story.phase !== 1 || story.error) throw Error(`TH11 story: ${story.error || "not started"}`);
      if (process.env.EAGLER_TEST_STORY_SCREENSHOT) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const laterError = await frame.evaluate(() => document.querySelector("#error")?.textContent || "");
        if (laterError) throw Error(`TH11 story after 5s: ${laterError}`);
        await page.screenshot({ path: resolve(process.env.EAGLER_TEST_STORY_SCREENSHOT) });
      }
    }
    if (language === "lang_zh-hans" && process.env.EAGLER_TEST_MUSIC_ROOM === "1") {
      const frame = page.frames().find(item => item.url().includes("th11.html"));
      if (!frame) throw Error("TH11 Runtime frame not found");
      await frame.evaluate(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        for (let index = 0; index < 4; index++) {
          core.th11_key(208, 1); await wait(70); core.th11_key(208, 0); await wait(100);
        }
        core.th11_key(44, 1); await wait(70); core.th11_key(44, 0);
        await wait(4000);
      });
      const music = await frame.evaluate(() => {
        const pointer=core.th11_error(),end=Module.HEAPU8.indexOf(0,pointer);
        const audioPointer = core.th11_audio_statistics();
        const audio = Array.from(new Uint32Array(Module.HEAPU8.buffer, audioPointer, 9));
        return { phase: core.th11_phase(), frame: core.th11_frame(), audio,
          error: document.querySelector("#error")?.textContent || "",
          coreError: new TextDecoder().decode(Module.HEAPU8.subarray(pointer,end<0?pointer+256:end)) };
      });
      console.log(JSON.stringify({ language, musicRoom: music }));
      if (music.error || music.coreError) throw Error(`TH11 music room: ${music.error || music.coreError}`);
      if (!music.audio[0] || !music.audio[2] || music.audio[3] || music.audio[5] === 0xffffffff || !music.audio[7]) {
        throw Error(`TH11 music room audio did not produce PCM: ${JSON.stringify(music.audio)}`);
      }
      if (process.env.EAGLER_TEST_MUSIC_ROOM_SCREENSHOT) {
        await page.screenshot({ path: resolve(process.env.EAGLER_TEST_MUSIC_ROOM_SCREENSHOT) });
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}
