import assert from 'node:assert/strict';
import { evaluate } from './settings-panel-driver.mjs';

export function toolsTab() {
  return [...document.querySelectorAll('button[role="tab"]')].filter(
    (el) => (el.getAttribute('title') ?? el.getAttribute('data-matrx-title')) === 'Tools',
  );
}

export async function pointerTarget(panel, selectorName, selector) {
  const body = `(() => {
    const visible = (el) => { const r=el.getBoundingClientRect(),s=getComputedStyle(el); return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!el.closest('[inert]'); };
    const candidates = (${selector.toString()})();
    const shown = candidates.filter(visible);
    if (candidates.length !== 1 || shown.length !== 1) return { matched:candidates.length, visible:shown.length, point:null, hit:false };
    shown[0].scrollIntoView({block:'center',inline:'center',behavior:'instant'});
    const r=shown[0].getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2, hit=document.elementFromPoint(x,y);
    return { matched:1, visible:1, point:{x,y}, hit:Boolean(hit&&(hit===shown[0]||shown[0].contains(hit))) };
  })()`;
  const initial = await evaluate(panel, body);
  assert.equal(initial?.matched, 1, `tab_groups_${selectorName}_unique_match_required`);
  assert.equal(initial?.visible, 1, `tab_groups_${selectorName}_visible_required`);
  assert.equal(initial?.hit, true, `tab_groups_${selectorName}_hit_target_required`);
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: initial.point.x,
    y: initial.point.y,
  });
  const stable = await evaluate(panel, body);
  assert.equal(stable?.hit, true, `tab_groups_${selectorName}_stable_hit_required`);
  assert.ok(
    Math.abs(stable.point.x - initial.point.x) < 1 &&
      Math.abs(stable.point.y - initial.point.y) < 1,
    `tab_groups_${selectorName}_stable_target_required`,
  );
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: stable.point.x,
    y: stable.point.y,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: stable.point.x,
    y: stable.point.y,
    button: 'left',
    clickCount: 1,
  });
}
