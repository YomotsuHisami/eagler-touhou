import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const html = await readFile(resolve(project, "index.html"), "utf8");
const script = await readFile(resolve(project, "app.js"), "utf8");

const htmlIds = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]));
const scriptIds = new Set([...script.matchAll(/\$\(["']#([^"']+)["']\)/g)].map(match => match[1]));
const missing = [...scriptIds].filter(id => !htmlIds.has(id));

if (missing.length) {
  throw new Error(`app.js 引用了 index.html 中不存在的 ID：${missing.join(", ")}`);
}

if (!/<input\b[^>]*\bid=["']fileInput["'][^>]*\btype=["']file["']/i.test(html)) {
  throw new Error("文件选择器 #fileInput 缺失或类型错误");
}
if (!script.includes("input.onchange =") || !script.includes("input.oncancel =")) {
  throw new Error("文件选择器必须分别处理选择和取消事件");
}
if (/window\.addEventListener\(["']focus["']\s*,\s*onFocus/.test(script)) {
  throw new Error("文件选择器不能用窗口 focus 判断选择结果");
}

console.log(JSON.stringify({ htmlIds: htmlIds.size, referencedIds: scriptIds.size, missing: 0 }));
