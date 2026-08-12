(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = `
    .thprac-ui{position:fixed;z-index:100;inset:0;display:grid;place-items:center;padding:10px;background:rgba(0,0,0,.78);color:#eee;font:13px/1.22 "Courier New","Microsoft YaHei",monospace}
    .thprac-ui[hidden]{display:none}.thprac-window{width:min(620px,97vw);max-height:96vh;overflow:auto;border:1px solid #999;background:#101214;box-shadow:6px 6px 0 #000}
    .thprac-window header{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;padding:9px 13px;border-bottom:1px solid #555;background:#17191c}.thprac-window h1{margin:0;font-size:17px;letter-spacing:.08em}.thprac-window header small{color:#ef6a58}
    .thprac-body{padding:10px 13px}.thprac-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px 12px}.thprac-wide{grid-column:1/-1}.thprac-ui label{display:grid;gap:3px;color:#bbb;font-size:10px}.thprac-ui select,.thprac-ui input{width:100%;box-sizing:border-box;padding:6px 7px;border:1px solid #737980;background:#050607;color:#fff;font:12px/1.2 "Courier New","Microsoft YaHei",monospace}.thprac-check{display:flex!important;align-items:center;gap:7px}.thprac-check input{width:auto}
    .thprac-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:11px;padding-top:9px;border-top:1px solid #45484b}.thprac-ui button{padding:7px 12px;border:1px solid #8a9097;background:#171a1d;color:#fff;font:inherit;cursor:pointer}.thprac-ui button.primary{border-color:#ef6a58;background:#4a1115}.thprac-hint{margin:0 0 9px;color:#aaa;font-size:10px}
    @media(max-width:560px){.thprac-ui{padding:3px}.thprac-window{max-height:99vh}.thprac-grid{grid-template-columns:1fr}.thprac-wide{grid-column:auto}.thprac-body{padding:8px 10px}}
  `;
  document.head.append(style);

  let game = "th06";
  let sections = [];
  const root = document.createElement("section");
  root.className = "thprac-ui";
  root.hidden = true;
  root.innerHTML = `<div class="thprac-window"><header><h1>thprac <small>REALLYPORTABLE</small></h1><small id="tp-game"></small></header><div class="thprac-body" id="tp-body"></div></div>`;
  document.body.append(root);
  const body = root.querySelector("#tp-body");
  const number = (id, fallback) => {
    const value = Number(root.querySelector(`#${id}`)?.value);
    return Number.isFinite(value) ? Math.trunc(value) : fallback;
  };
  const checked = id => !!root.querySelector(`#${id}`)?.checked;
  const difficultyCode = difficulty => "ENHLXP"[difficulty] || "";
  const matchingVariant = (section, difficulty) => section.variants?.find(variant =>
    !variant.condition || variant.condition.includes(difficultyCode(difficulty))) || section.variants?.[0];
  const sectionLabel = section => {
    const variant = matchingVariant(section, Number(root.dataset.difficulty));
    const appearance = section.appearance || [1, 1, 1];
    return `${appearance[0]}-${appearance[1]}-${appearance[2]} ${variant?.zh || variant?.en || section.key}`;
  };
  const selectedSection = () => sections.find(item => item.id === number("tp-section", 0));
  const chapterCounts = {
    th06:[[4,2],[2,2],[4,3],[4,5],[3,2],[2,0],[4,3]],
    th07:[[2,1],[1,1],[2,1],[4,4],[3,1],[2,0],[5,3],[5,3]]
  };
  const availableSections = () => {
    const stage = number("tp-stage", 0) + 1;
    const warp = number("tp-warp", 0);
    return sections.filter(section => section.appearance?.[0] === stage &&
      (warp === 2 ? section.appearance?.[1] === 1 :
       warp === 3 ? section.appearance?.[1] === 2 :
       warp === 4 ? !section.spell : warp === 5 ? !!section.spell : false));
  };
  const syncSectionOptions = () => {
    const select = root.querySelector("#tp-section");
    if (!select) return;
    const filtered = availableSections();
    select.innerHTML = filtered.map(s => `<option value="${s.id}">${sectionLabel(s)}</option>`).join("");
    syncConditionalFields();
  };
  const syncConditionalFields = () => {
    const section = selectedSection();
    const stage = number("tp-stage", 0);
    const mode = number("tp-mode", 1);
    const warp = number("tp-warp", 0);
    root.querySelector("#tp-advanced").hidden = mode !== 1;
    root.querySelector("#tp-chapter-row").hidden = mode !== 1 || warp !== 1;
    root.querySelector("#tp-section-row").hidden = mode !== 1 || warp < 2 || warp > 5;
    root.querySelector("#tp-frame-row").hidden = mode !== 1 || warp !== 6;
    root.querySelector("#tp-phase-row").hidden = mode !== 1 || !["TH06_ST7_END_S10","TH07_ST7_END_S10","TH07_ST8_END_S10"].includes(section?.key);
    const fake = root.querySelector("#tp-fake-row");
    if (fake) fake.hidden = !(mode === 1 && game === "th06" && stage === 3 && warp > 1 && warp < 6);
    const dialogue = root.querySelector("#tp-dialogue-row");
    if (dialogue) {
      dialogue.hidden = !(mode === 1 && warp >= 2 && warp <= 5 && section?.dialogue);
      if (dialogue.hidden) root.querySelector("#tp-dialogue").checked = false;
    }
    const rank = root.querySelector("#tp-rank");
    const rankLock = checked("tp-rank-lock");
    if (rank) {
      rank.min = game === "th07" && Number(root.dataset.difficulty) === 0 ? "12" : game === "th07" ? "10" : "0";
      rank.max = rankLock ? "99" : game === "th07" && Number(root.dataset.difficulty) === 0 ? "20" : "32";
      rank.value = String(Math.max(Number(rank.min), Math.min(Number(rank.max), number("tp-rank", game === "th06" ? 32 : 16))));
    }
    const counts = chapterCounts[game][stage];
    const chapter = root.querySelector("#tp-chapter");
    if (chapter) chapter.max = String(counts[0] + counts[1]);
  };
  function makeSession() {
    const mode = number("tp-mode", 1);
    const stage = number("tp-stage", 0);
    const warp = mode === 1 ? number("tp-warp", 0) : 0;
    const section = selectedSection();
    if (mode === 1 && warp >= 2 && warp <= 5 && !section) return null;
    const sectionId = warp === 1 ? 10000 + (stage + 1) * 100 + number("tp-chapter", 1) :
      warp >= 2 && warp <= 5 ? section.id : 0;
    const params = {
      mode, stage, warp, section:sectionId, phase:number("tp-phase",0), frame:warp === 6 ? number("tp-frame",0) : 0,
      dlg:checked("tp-dialogue"), life:number("tp-life",8), bomb:number("tp-bomb",8), power:number("tp-power",128),
      rank:number("tp-rank",game === "th06" ? 32 : 16), rankLock:checked("tp-rank-lock"), score:number("tp-score",0),
      graze:number("tp-graze",0)
    };
    params.difficulty = Number.isFinite(Number(root.dataset.difficulty)) ? Number(root.dataset.difficulty) : 0;
    params.shotType = Number.isFinite(Number(root.dataset.shotType)) ? Number(root.dataset.shotType) : 0;
    if (game === "th06") {
      params.point = number("tp-point",0);
      params.fakeType = number("tp-fake",0);
    } else {
      params.point_total = number("tp-point-total",0);
      params.point_stage = number("tp-point-stage",0);
      params.cherry = number("tp-cherry",0);
      params.cherryMax = number("tp-cherry-max",200000);
      params.cherryPlus = number("tp-cherry-plus",0);
      params.spellBonus = number("tp-spell-bonus",0);
    }
    return {schema:"eagler-touhou/thprac-session/1",game,source:"practice-stage-menu",params};
  }
  function open(options) {
    game = options.game;
    sections = Array.isArray(options.sections) ? options.sections : [];
    const difficulty = Number(options.difficulty);
    root.dataset.difficulty = String(difficulty);
    root.dataset.shotType = String(Number(options.shotType) || 0);
    const visible = sections.filter(section => {
      const condition = section.variants?.[0]?.condition || "";
      return !condition || "ENHLXP"[difficulty] == null || condition.includes("ENHLXP"[difficulty]);
    });
    sections = visible.length ? visible : sections;
    root.querySelector("#tp-game").textContent = game.toUpperCase();
    const stages = game === "th06" ? ["Stage 1","Stage 2","Stage 3","Stage 4","Stage 5","Stage 6","Extra"] : ["Stage 1","Stage 2","Stage 3","Stage 4","Stage 5","Stage 6","Extra","Phantasm"];
    body.innerHTML = `<p class="thprac-hint">此窗口只在原版 Practice 的机体选择完成后出现，并接管原版选关页。</p><div class="thprac-grid">
      <label>模式<select id="tp-mode"><option value="1">高级练习</option><option value="0">整关练习</option></select></label>
      <label>关卡<select id="tp-stage">${stages.map((s,i) => `<option value="${i}">${s}</option>`).join("")}</select></label>
      <div id="tp-advanced" class="thprac-wide thprac-grid">
      <label>位置<select id="tp-warp"><option value="1">章节</option><option value="2">中道中</option><option value="3">关底</option><option value="4">非符</option><option value="5">符卡</option><option value="6">指定帧</option></select></label>
      <label id="tp-chapter-row">章节<input id="tp-chapter" type="number" min="1" value="1"></label>
      <label id="tp-section-row" class="thprac-wide">练习段落<select id="tp-section"></select></label>
      <label id="tp-frame-row">帧<input id="tp-frame" type="number" min="0" value="0"></label>
      </div>
      <label>残机<input id="tp-life" type="number" min="0" max="8" value="8"></label><label>BOMB<input id="tp-bomb" type="number" min="0" max="8" value="8"></label>
      <label>火力<input id="tp-power" type="number" min="0" max="128" value="128"></label><label>Rank<input id="tp-rank" type="number" min="0" max="99" value="${game === "th06" ? 32 : 16}"></label>
      <label>分数<input id="tp-score" type="number" min="0" step="10" value="0"></label><label>擦弹<input id="tp-graze" type="number" min="0" value="0"></label>
      ${game === "th06" ? '<label>点道具<input id="tp-point" type="number" min="0" value="0"></label><label id="tp-fake-row">帕秋莉假机体<select id="tp-fake"><option value="0">当前机体</option><option value="1">灵梦A</option><option value="2">灵梦B</option><option value="3">魔理沙A</option><option value="4">魔理沙B</option></select></label>' : '<label>总点道具<input id="tp-point-total" type="number" min="0" value="0"></label><label>本关点道具<input id="tp-point-stage" type="number" min="0" value="0"></label><label>樱点<input id="tp-cherry" type="number" step="10" value="0"></label><label>樱点上限<input id="tp-cherry-max" type="number" step="10" value="200000"></label><label>樱点 +<input id="tp-cherry-plus" type="number" value="0"></label><label>符卡收取数<input id="tp-spell-bonus" type="number" min="0" max="30" value="0"></label>'}
      <label id="tp-phase-row">符卡阶段<input id="tp-phase" type="number" min="0" max="64" value="0"></label>
      <label id="tp-dialogue-row" class="thprac-check"><input id="tp-dialogue" type="checkbox">保留对话</label><label class="thprac-check"><input id="tp-rank-lock" type="checkbox">锁定 Rank</label>
    </div><div class="thprac-actions"><button id="tp-cancel">取消</button><button class="primary" id="tp-start">开始练习</button></div>`;
    root.querySelector("#tp-mode").onchange = syncConditionalFields;
    root.querySelector("#tp-stage").onchange = () => { syncSectionOptions(); syncConditionalFields(); };
    root.querySelector("#tp-warp").onchange = () => { syncSectionOptions(); syncConditionalFields(); };
    root.querySelector("#tp-section").onchange = syncConditionalFields;
    root.querySelector("#tp-rank-lock").onchange = syncConditionalFields;
    root.querySelector("#tp-cancel").onclick = () => {
      root.hidden = true;
      Module.eaglerThpracMenuStatus = 3;
    };
    root.querySelector("#tp-start").onclick = () => {
      const session = makeSession();
      if (!session) return;
      Module.eaglerOptions.thpracSession = session;
      root.hidden = true;
      Module.eaglerThpracMenuStatus = 2;
      if (window.parent !== window) parent.postMessage({protocol:"eagler-touhou/1",game,event:"thprac-session",session}, location.origin);
    };
    syncSectionOptions();
    syncConditionalFields();
    Module.eaglerThpracMenuStatus = 1;
    root.hidden = false;
  }
  window.EaglerThpracUI = { open };
})();
