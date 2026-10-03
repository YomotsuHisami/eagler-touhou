# DAIRI / はるか 角色素材：本地导入与署名

## 来源与使用范围

作者主页：https://dairi.fanbox.cc/
Pixiv：https://www.pixiv.net/users/4920496

核对日期：2026-10-03。作者主页列有免费素材使用规则，并明确要求不要商业使用或再分发。
不要把“可免费使用”理解成“可以把原 PNG 放进开源仓库/ZIP 再分发”；修改/裁切也不自动获得再分发许可。
项目 GPL 代码许可证不覆盖作者原画。公开发布具体美术前应核对作者当前规则并取得需要的许可。

因此，这个代码包**没有 DAIRI 原图**，也没有用 AI 仿画冒充 DAIRI。
代码、角色映射、加载/回退行为已接好；实际图片要由使用者从作者当前主页的素材入口取得，再本地导入。
没有素材时会明确显示“立绘未导入”。测试只用了程序构造的 PNG，不是作者插画的视觉验收。

## 图片命名（PNG，推荐透明背景）

每个角色选一张合适的单人图，保留原始文件；可以在单独目录复制并使用以下文件名：

| 文件名 | 角色 | 文件名 | 角色 |
|---|---|---|---|
| reimu.png | 博丽灵梦 | marisa.png | 雾雨魔理沙 |
| sakuya.png | 十六夜咲夜 | youmu.png | 魂魄妖梦 |
| yukari.png | 八云紫 | alice.png | 爱丽丝 |
| remilia.png | 蕾米莉亚 | yuyuko.png | 西行寺幽幽子 |
| reisen.png | 铃仙 | cirno.png | 琪露诺 |
| lyrica.png | 莉莉卡 | merlin.png | 梅露兰 |
| lunasa.png | 露娜萨 | mystia.png | 米斯蒂娅 |
| tewi.png | 因幡帝 | aya.png | 射命丸文 |
| medicine.png | 梅蒂欣 | yuuka.png | 风见幽香 |
| komachi.png | 小野塚小町 | eiki.png | 四季映姬 |

导入器也能识别代码中列出的准确中文/日文角色名。**不会猜测数字编号、同角色多个表情中的哪一张**。
角色文件名与机体编号分离；TH08 各双人组共用两张单人图，单人模式只用一张。TH09 独立的16角色顺序映射不依赖旧整张 sprite sheet 的裁切坐标。

```bash
npm run portraits:import -- --from="/实际素材目录" --dry-run
npm run portraits:import -- --from="/实际素材目录"
```

不需要20人齐全才能开始。要求一次齐全时加 `--require-all`。
有多个同名候选时导入会停止而不是随机选一张。用 JSON 明确指定相对于素材目录的文件路径：

```json
{
  "reimu": "东方立绘/霊夢/通常.png",
  "marisa": "东方立绘/魔理沙/通常.png"
}
```

```bash
npm run portraits:import -- --from="/实际素材目录" --map="/映射文件.json"
```

输出：`private-assets/dairi/<角色ID>.png` 和本地 `manifest.json`。
覆盖不同旧图片前备份到 `.cache/character-art-backups/`；重复导入相同图片不重写。
导入器限制目录深度/文件数量/图片尺寸，拒绝目录外映射、符号链接和非 PNG；不会解压不可信压缩包或执行任何素材里的脚本。

## 展示和打包边界

- 预览服务只映射明确的20角色文件和 manifest；不开放整个私有素材目录。
- 图片按角色独立加载，保持完整比例；双图并列/叠放，不再裁切原版人物表。
- manifest 标明已导入的角色，避免缺图时反复请求不存在的文件；文件损坏时回退为角色名提示。
- `.gitignore` 忽略 `private-assets/`。源码打包/发布审计也排除或拒绝这些素材。
- 本地预览可以使用它们；**普通 Host 发布工具不会自动复制这套 DAIRI 私有素材**，避免不知情地公开再分发。
- 未来取得明确发布许可后，可在独立、经审核的美术变更中接入正式发布；不要通过 `git add -f` 绕过保护。

## 本地补全记录（2026-10-03）

已从作者在分发公告中提供的 Google Drive 素材库取得并导入全部 **20/20** 个角色，
覆盖 TH06–TH10 的角色映射、TH08 双人组与 TH09 的16角色。

选图使用无“旧／水着／やられ／バトル”后缀的标准包；紫和幽幽子使用 `(1)`。
优先选择“通常”里的“普通／微笑”，琪露诺使用“余裕”；米斯蒂娅明确使用
“通常衣装”，爱丽丝选择本人而非上海／蓬莱。每个角色仅导入一张，PNG 字节保持不变。

- 本地原包：`~/Downloads/` 中对应的角色 ZIP。
- 实际素材：`private-assets/dairi/`。
- 原包名、包内选图路径与 SHA-256：`private-assets/dairi/provenance/selection.json`。
- 各包使用说明：`private-assets/dairi/provenance/*-readme.txt`。
- 导入与角色映射检查：`node tests/test-character-art.mjs` 通过。

这些素材仍仅用于本地预览，不随源码或普通 Host 包发布。
运行 `npm run preview:local`，打开 `http://127.0.0.1:8137/?game=th08mp`，
点击“创建房间”即可检查双人组立绘；切换到 TH09 可检查其他角色。
