import { createCanvas } from '@napi-rs/canvas';

const escape = (text) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export async function renderPdfRulePage(page, textContent, pageNumber, pdfjs) {
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(1, 1200 / viewport.width);
  const canvas = createCanvas(Math.ceil(viewport.width * scale), Math.ceil(viewport.height * scale));
  const context = canvas.getContext('2d');
  const textOperators = [pdfjs.OPS.showText, pdfjs.OPS.showSpacedText, pdfjs.OPS.nextLineShowText, pdfjs.OPS.nextLineSetSpacingShowText];
  let paintedText = '';
  const colors = [];
  await page.render({
    canvas: null, canvasContext: context, viewport: page.getViewport({ scale }),
    operationsFilter: (index, operators) => {
      if (!textOperators.includes(operators.fnArray[index])) return true;
      const glyphs = operators.argsArray[index]?.[0];
      if (Array.isArray(glyphs)) for (const glyph of glyphs) {
        if (typeof glyph?.unicode !== 'string') continue;
        for (const char of glyph.unicode.replace(/\s/g, '').split('')) {
          paintedText += char;
          colors.push(context.fillStyle);
        }
      }
      return false;
    },
  }).promise;
  const background = canvas.toDataURL('image/png');
  let colorOffset = 0;
  const text = textContent.items.filter((item) => item.str?.trim()).map((item, index) => {
    const transform = pdfjs.Util.transform(viewport.transform, item.transform);
    const height = Math.hypot(transform[2], transform[3]);
    const style = textContent.styles[item.fontName];
    const ascent = Number.isFinite(style?.ascent) ? style.ascent : 0.88;
    let name = '';
    if (page.commonObjs.has(item.fontName)) name = page.commonObjs.get(item.fontName).name || '';
    const family = /SimHei|黑体/.test(name) ? 'SimHei' : /SimSun|宋体/.test(name) ? 'SimSun'
      : /FangSong|仿宋/.test(name) ? 'FangSong' : /KaiTi|楷体/.test(name) ? 'KaiTi'
      : /YaHei/.test(name) ? 'Microsoft YaHei' : /Times/.test(name) ? 'Times New Roman'
      : /CambriaMath/.test(name) ? 'Cambria Math' : /Arial/.test(name) ? 'Arial' : style?.fontFamily || 'serif';
    const weight = /Bold/i.test(name) ? 'bold' : 'normal';
    const compactText = item.str.replace(/\s/g, '');
    const colorIndex = paintedText.indexOf(compactText, colorOffset);
    const color = colorIndex >= 0 ? colors[colorIndex] : '#111';
    if (colorIndex >= 0) colorOffset = colorIndex + compactText.length;
    const angle = Math.atan2(transform[1], transform[0]) * 180 / Math.PI;
    const css = `left:${transform[4]}px;top:${transform[5] - height * ascent}px;font-size:${height}px;font-family:'${family.replace(/[^\w\s-]/g, '')}';font-weight:${weight};color:${color};min-width:${Math.max(item.width, 1)}px;transform:rotate(${angle}deg)`;
    return `<span class="pdf-rule-text" data-line-end="${item.hasEOL}" data-pdf-width="${item.width}" data-pdf-rotation="${angle}" data-pdf-original="${escape(item.str)}" contenteditable="plaintext-only" role="textbox" aria-label="第${pageNumber}页第${index + 1}处文字" style="${css}">${escape(item.str)}</span>`;
  }).join('');
  return `<section class="pdf-rule-page" aria-label="第${pageNumber}页" style="width:${viewport.width}px;height:${viewport.height}px;background-image:url(${background})">${text}</section>`;
}

export const pdfRuleCss = '.pdf-rule-page{position:relative;margin:12px auto;background-size:100% 100%;background-repeat:no-repeat;box-shadow:0 1px 6px #bbb}.pdf-rule-text{position:absolute;display:block;line-height:1;white-space:pre;transform-origin:0 0;color:#111;cursor:text}.pdf-rule-text:focus{outline:2px solid #398cdf;background:#e8f2ff}.pdf-rule-text:hover{outline:1px solid #abd0ff}';
