// Authored as ES5 and inlined unchanged before the Framework module boot.
(function () {
  // Explicit one-page retry for a user who has already followed the guide.
  // This is not persisted and does not relax checks for later visits.
  if (/(?:\?|&)compat=continue(?:&|$)/.test(location.search)) return;
  var ua = navigator.userAgent || "";
  var reasons = [];
  var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  var oldWindows = /Windows NT (?:[1-5]\.\d|6\.[01])(?:[;)]|$)/i.test(ua);
  var ie = /MSIE |Trident\//i.test(ua);
  // The Chrome/Chromium token identifies the actual Chromium engine in Edge,
  // Opera and many Android shells. Do not mistake iOS CriOS for Chromium.
  var chrome = /(?:Chrome|Chromium)\/(\d+)/i.exec(ua);
  var supportedChromium = chrome && Number(chrome[1]) >= 108;
  // New Chromium on older Windows (e.g. Supermium) is allowed. IE is never allowed.
  if (oldWindows && !supportedChromium) reasons.push("windows");
  if (ie) reasons.push("ie");
  if (chrome && Number(chrome[1]) < 108) reasons.push("chrome");
  // Equivalent to the WebGL2 context check used at get.webgl.org/webgl2/.
  // Do not require optional GPU extensions or over-restrict software drivers.
  if (!ie && (!oldWindows || supportedChromium) && !(chrome && Number(chrome[1]) < 108)) {
    try {
      var canvas = document.createElement("canvas");
      var gl = canvas.getContext && canvas.getContext("webgl2");
      if (!gl || (gl.isContextLost && gl.isContextLost())) reasons.push("webgl2");
      // An ephemeral probe must not keep an extra GPU context alive.
      if (gl && gl.getExtension) {
        var lose = gl.getExtension("WEBGL_lose_context");
        if (lose) lose.loseContext();
      }
    } catch (error) { reasons.push("webgl2"); }
  }
  if (reasons.length) {
    var platform = mobile ? "mobile" : "desktop";
    var huawei = /HUAWEI|HONOR|HarmonyOS|HMSCore/i.test(ua) ? "&huawei=1" : "";
    // Read a build-time mount from markup instead of resolving against a deep route.
    // IE does not implement document.currentScript, so use the stable script ID.
    var script = document.getElementById("browser-compatibility-gate");
    var guide = script.getAttribute("data-compatibility-url");
    // The following classic boot watchdog must not race this intentional exit.
    script.setAttribute("data-redirecting", "true");
    location.replace(guide + "?reasons=" + encodeURIComponent(reasons.join(",")) + "&platform=" + platform + huawei);
  }
}());
