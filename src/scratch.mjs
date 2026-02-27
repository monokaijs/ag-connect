import { Workspace } from './models/workspace.mjs';
import { connectDB } from './db.mjs';
import { cdpEvalOnPort } from './workspace-cdp.mjs';

async function run() {
  await connectDB();
  const ws = await Workspace.findOne({ status: 'running' });

  const expr = `(async () => {
    let input = document.querySelector('input[placeholder="Select a conversation"]');
    if (!input) {
      const btn = document.querySelector('[data-tooltip-id="history-tooltip"]');
      if (!btn) return { ok: false, error: 'no_history_btn' };
      btn.click();
      await new Promise(r => setTimeout(r, 100));
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 100));
        input = document.querySelector('input[placeholder="Select a conversation"]');
        if (input) break;
      }
      if (!input) return { ok: false, error: 'dialog_timeout' };
    }
    const root = input.closest('div[tabindex]');
    if (!root) return { ok: false, error: 'no_root' };
    const allDivs = root.querySelectorAll('div');
    for (const el of allDivs) {
      const t = (el.textContent || '').trim();
      if (t.startsWith('Show ') && t.includes('more')) el.click();
    }
    await new Promise(r => setTimeout(r, 500));
    const groups = [];
    let currentGroup = null;
    const seenTitles = new Set();
    const walk = (el) => {
      for (const child of el.children) {
        const cls = child.className || '';
        const text = (child.textContent || '').trim();

        if (cls.includes('text-xs') && cls.includes('pt-4') && cls.includes('opacity-50') && text.length < 80) {
          currentGroup = { label: text, items: [] };
          groups.push(currentGroup);
          continue;
        }
        if (cls.includes('cursor-pointer') && cls.includes('justify-between') && cls.includes('rounded-md')) {
          const titleSpan = child.querySelector('.text-sm span');
          const title = titleSpan ? titleSpan.textContent.trim() : '';
          if (!title) continue;
          const timeEl = child.querySelector('.ml-4');
          const time = timeEl ? timeEl.textContent.trim() : '';
          const active = cls.includes('focusBackground');
          if (!currentGroup) {
            currentGroup = { label: '', items: [] };
            groups.push(currentGroup);
          }
          if (!seenTitles.has(title)) {
            seenTitles.add(title);
            currentGroup.items.push({ title, time, active });
          }
          continue;
        }
        if (child.children.length > 0) walk(child);
      }
    };
    walk(root);
    const btn = document.querySelector('[data-tooltip-id="history-tooltip"]');
    if (btn) btn.click();
    return { ok: true, groups: groups.filter(g => g.items.length > 0) };
  })()`;

  const res = await cdpEvalOnPort(ws.ports.debug, expr, { target: 'workbench' });
  console.log("History probe:", JSON.stringify(res?.results?.[0]?.value || null, null, 2));
  process.exit(0);
}
run().catch(console.error);
