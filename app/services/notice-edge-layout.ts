/** Native main's right-hand dialog fills the visual viewport, even when the
 * library reserves a classic scrollbar gutter. This keeps the library still. */
export function noticeEdgeLayout(viewportWidth:number,clientWidth:number) {
  const width=Math.max(1,Number.isFinite(viewportWidth)?viewportWidth:1);
  const gutter=Math.max(0,width-Math.max(0,Number.isFinite(clientWidth)?clientWidth:width));
  return {right:gutter?-gutter:0,width:Math.max(1,Math.min(700,width<=780?width*.94:width-24))};
}
