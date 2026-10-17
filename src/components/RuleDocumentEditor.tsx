import { useEffect, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import type { RuleLayout } from '@shared/rule-document-contract';

export function cleanRuleHtml(html: string) {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'style', 'link', 'meta', 'base', 'svg', 'math'],
    FORBID_ATTR: ['href', 'srcset'],
    ADD_ATTR: ['contenteditable'],
  });
}

export default function RuleDocumentEditor({ document, onChange, disabled = false }: {
  document: RuleLayout;
  onChange: (html: string, text: string) => void;
  disabled?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const source = useMemo(() => {
    const nonce = crypto.randomUUID();
    let html = cleanRuleHtml(document.html);
    if (document.format === 'docx') {
      const container = window.document.createElement('div');
      container.innerHTML = html;
      container.querySelectorAll<HTMLElement>('td, th, p').forEach((node) => {
        if (node.tagName === 'P' && node.closest('td, th')) return;
        node.contentEditable = 'true';
        node.tabIndex = 0;
      });
      html = container.innerHTML;
    }
    const css = document.css.replace(/</g, '\\3c ');
    const editable = document.format === 'docx' ? ' contenteditable="true" role="textbox" aria-label="规则内容" aria-multiline="true"' : '';
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>body{margin:0;padding:8px;background:#f3f4f6;color:#111}#document{min-height:180px;outline:none}td:focus-within{outline:2px solid #398cdf}img{max-width:100%}${css}</style></head><body><div id="document"${editable}>${html}</div><script nonce="${nonce}">
      const root=document.getElementById('document');
      document.fonts.ready.then(()=>{
        const measure=document.createElement('canvas').getContext('2d');
        root.querySelectorAll('.pdf-rule-text').forEach(node=>{
          const style=getComputedStyle(node);
          measure.font=style.fontStyle+' '+style.fontWeight+' '+style.fontSize+' '+style.fontFamily;
          const width=measure.measureText(node.dataset.pdfOriginal).width;
          const stretch=width>0?Number(node.dataset.pdfWidth)/width:1;
          node.style.minWidth=Math.max(width,1)+'px';
          node.style.transform='rotate('+node.dataset.pdfRotation+'deg) scaleX('+stretch+')';
        });
      });
      function report(){
        const text=${document.format === 'pdf' ? "Array.from(root.querySelectorAll('.pdf-rule-page')).map(page=>Array.from(page.querySelectorAll('.pdf-rule-text')).map(node=>node.textContent+(node.dataset.lineEnd==='true'?'\\n':' ')).join('').trim()).join('\\n\\n')" : 'root.innerText'};
        parent.postMessage({type:'RULE_LAYOUT_CHANGE',html:root.innerHTML,text},'*');
      }
      root.addEventListener('input',report);
      window.addEventListener('message',event=>{
        if(event.source===parent&&event.data?.type==='RULE_EDITOR_LOCK')root.inert=!!event.data.disabled;
      });
      root.addEventListener('paste',event=>{
        event.preventDefault();
        const selection=window.getSelection();
        if(!selection.rangeCount)return;
        const range=selection.getRangeAt(0);
        range.deleteContents();
        const text=document.createTextNode(event.clipboardData.getData('text/plain'));
        range.insertNode(text);range.setStartAfter(text);range.collapse(true);
        selection.removeAllRanges();selection.addRange(range);report();
      });
    </script></body></html>`;
  }, [document]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== 'RULE_LAYOUT_CHANGE') return;
      if (typeof event.data.html === 'string' && typeof event.data.text === 'string') {
        onChange(cleanRuleHtml(event.data.html), event.data.text);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onChange]);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: 'RULE_EDITOR_LOCK', disabled }, '*');
  }, [disabled]);

  return <iframe ref={frame} title="规则内容（保留排版）" sandbox="allow-scripts" srcDoc={source}
    onLoad={() => frame.current?.contentWindow?.postMessage({ type: 'RULE_EDITOR_LOCK', disabled }, '*')}
    className="h-[60vh] min-h-[280px] w-full max-w-full rounded-md border border-border bg-white" />;
}
