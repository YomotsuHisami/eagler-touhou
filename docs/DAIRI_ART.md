# DAIRI / はるか 角色素材与署名

## 当前发布状态（2026-10-03）

应项目所有者明确要求，本次 PR 收录 20 张标准立绘，位于 `public/assets/dairi/`，并接入正式前端发布与离线资源清单。仅包含当前使用的标准图，不包含其他差分、PSD 或完整原包。

作者：dairi / はるか。东方 Project 角色归 ZUN / 上海アリス幻樂団。
作者主页：https://dairi.fanbox.cc/
来源：https://drive.google.com/drive/folders/0B34TvJayojX_SU44YUtISFVRTnM?resourcekey=0-mhlyeSSR6Pctax9CSF6FRg

**这些图片不适用项目的 GPL 许可证。** 原包说明中有「商用利用、再配布はご遠慮下さい。」的限制。项目所有者表示作者不会对此种再分发有意见，并明确要求公开提交；本仓库没有记录另行取得的书面许可，也不因此授予其他人额外使用或再分发权利。

各包原始说明（仅转为 UTF-8）：`docs/dairi-art/*-readme.txt`。
原包名、所选图片路径与 SHA-256：`docs/dairi-art/selection.json`。
PNG 字节保持原样。正式发布者仍需处理素材使用条款与许可问题。

## 展示与本地覆盖

覆盖 TH06–TH10 的全部 20 个角色；TH08 双人组使用两张独立图。无 DAT 或无法识别最常用机体时，game info 不显示立绘；有效立绘靠右并朝中心渐隐。

`npm run portraits:import -- --from="素材目录" --require-all` 仍支持导入本地替换素材到忽略的 `private-assets/dairi/`。本地预览优先使用该目录，正式网站默认使用本次提交的公共素材。私有目录和用户存档不会随 PR 上传。
