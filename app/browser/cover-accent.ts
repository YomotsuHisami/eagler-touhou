const accentsBySource = new Map<string, string>();

/** Sample main's restrained selected-card outline from the decoded cover. */
export function coverAccentForImage(image: HTMLImageElement): string | null {
  if (!image.naturalWidth || !image.naturalHeight) return null;
  const source = image.currentSrc || image.src;
  const cached = accentsBySource.get(source);
  if (cached) return cached;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (!context) return null;
    context.drawImage(image, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    const bins = Array.from({length: 24}, () => ({weight: 0, x: 0, y: 0}));

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index] / 255, green = pixels[index + 1] / 255, blue = pixels[index + 2] / 255;
      const high = Math.max(red, green, blue), low = Math.min(red, green, blue), chroma = high - low;
      if (pixels[index + 3] < 128 || chroma < .12 || high < .18) continue;
      let hue = high === red ? (green - blue) / chroma
        : high === green ? (blue - red) / chroma + 2
        : (red - green) / chroma + 4;
      hue = (hue * 60 + 360) % 360;
      const bin = bins[Math.floor(hue / 15)], weight = chroma * Math.sqrt(high);
      bin.weight += weight;
      bin.x += Math.cos(hue * Math.PI / 180) * weight;
      bin.y += Math.sin(hue * Math.PI / 180) * weight;
    }

    const dominant = bins.reduce((best, bin) => bin.weight > best.weight ? bin : best);
    const hue = (Math.atan2(dominant.y, dominant.x) * 180 / Math.PI + 360) % 360;
    const accent = dominant.weight ? `hsl(${Math.round(hue)} 62% 78%)` : '#d0cbc3';
    accentsBySource.set(source, accent);
    return accent;
  } catch {
    // Cross-origin or unreadable artwork falls back to the paper outline.
    return null;
  }
}
