import BrowserStackLocalPackage from "browserstack-local";

const key = String(process.env.BROWSERSTACK_ACCESS_KEY || "").trim();
if (!key) throw new Error("BROWSERSTACK_ACCESS_KEY is required");

const BrowserStackLocal = BrowserStackLocalPackage.default || BrowserStackLocalPackage;
const local = new BrowserStackLocal.Local();
const options = { key, forceLocal: true };
const proxyValue = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
if (proxyValue) {
  const proxy = new URL(proxyValue);
  options.proxyHost = proxy.hostname;
  options.proxyPort = Number(proxy.port) || (proxy.protocol === "https:" ? 443 : 80);
  options.forceProxy = true;
  if (proxy.username) options.proxyUser = decodeURIComponent(proxy.username);
  if (proxy.password) options.proxyPass = decodeURIComponent(proxy.password);
}

await new Promise((resolve, reject) => {
  local.start(options, error => error ? reject(error) : resolve());
});
console.log("BrowserStack Live Local: CONNECTED");

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await new Promise(resolve => local.stop(() => resolve()));
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 60_000);
