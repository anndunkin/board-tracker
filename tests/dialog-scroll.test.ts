import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(join(__dirname, '..', 'src', 'renderer', file), 'utf8');

/**
 * A dialog that lets the page scroll underneath it is not just untidy. On Windows the scroll
 * dismisses an open native select or date picker, so the field reads as if it ignored the click —
 * the "dropdowns are unclickable" report from v0.3.0. These are source-level guards because the
 * suite runs in node with no DOM; they exist so a third dialog cannot be added without the lock.
 */
describe('dialogs hold the page still underneath them', () => {
  it('locks the background scroll in every dialog that renders a backdrop', () => {
    const app = read('App.tsx');
    const backdrops = app.split('\n').filter((line) => line.includes('className="modal-backdrop"'));
    expect(backdrops.length).toBeGreaterThan(0);
    // Each backdrop is returned by a component that must call the lock hook first.
    const locks = app.split('\n').filter((line) => line.trim() === 'useBackgroundScrollLock();');
    expect(locks).toHaveLength(backdrops.length);
  });

  it('keeps hit-test data fresh for as long as a dialog is open', () => {
    const app = read('App.tsx');
    // Windows kept routing clicks from data captured before the dialog opened, so a visible field
    // would not take focus. A capture-phase pointer handler that performs a real hit test is what
    // was observed to end it, so the app installs one itself while a dialog is open.
    expect(app).toMatch(/function useDialogHitTestRefresh\(/);
    expect(app).toMatch(/document\.elementFromPoint\(x, y\)/);
    expect(app).toMatch(/document\.addEventListener\('pointerdown', onPointerDown, true\)/);
    expect(app).toMatch(/document\.removeEventListener\('pointerdown', onPointerDown, true\)/);
    expect(app).toMatch(/requestAnimationFrame/);
    // Every dialog gets it, on the same footing as the scroll lock.
    const backdrops = app.split('\n').filter((line) => line.includes('className="modal-backdrop"'));
    const refreshes = app.split('\n').filter((line) => line.trim() === 'useDialogHitTestRefresh();');
    expect(refreshes).toHaveLength(backdrops.length);
  });

  it('restores the original overflow rather than assuming it was unset', () => {
    const app = read('App.tsx');
    // Captured off body.style before anything is written, and written back verbatim on close.
    expect(app).toMatch(/const \{ overflow, position, top, width, paddingRight \} = body\.style/);
    for (const prop of ['overflow = overflow', 'position = position', 'top = top', 'width = width', 'paddingRight = paddingRight']) {
      expect(app).toContain(`body.style.${prop}`);
    }
  });

  it('pads the scrollbar gutter so the page does not jump sideways as a dialog opens', () => {
    expect(read('App.tsx')).toMatch(/window\.innerWidth - documentElement\.clientWidth/);
  });

  it('renders dialogs into a body-level layer, not inside the sticky-sidebar grid', () => {
    const app = read('App.tsx');
    // Nested inside .app-shell, Chromium kept stale hit-test regions on Windows: the dialog painted
    // but clicks landed where the pre-scroll layout had been, intermittently, until a relayout.
    expect(app).toMatch(/import \{ createPortal \} from 'react-dom'/);
    expect(app).toMatch(/function DialogLayer\(/);
    expect(app).toMatch(/createPortal\(children, host\)/);
    expect(app).toMatch(/document\.body\.append\(node\)/);
    // Every backdrop-rendering component must go through the layer.
    const shell = app.slice(app.indexOf('return <div className="app-shell">'), app.indexOf('</div>;'));
    const rendered = shell.split('\n').filter((line) => /<(ResearchModal|ModalForm) /.test(line));
    expect(rendered.length).toBeGreaterThan(0);
    const layer = app.slice(app.indexOf('<DialogLayer>'), app.indexOf('</DialogLayer>'));
    for (const line of rendered) expect(layer).toContain(line.trim());
  });

  it('reads layout back after locking so hit-test regions are rebuilt', () => {
    expect(read('App.tsx')).toMatch(/void body\.offsetHeight/);
  });

  it('holds the page at its scroll offset instead of letting it snap to the top', () => {
    const app = read('App.tsx');
    // Hiding the body overflow propagates to the viewport and resets it, so the body is pinned at a
    // negative offset and the offset is put back on close.
    expect(app).toMatch(/body\.style\.position = 'fixed'/);
    expect(app).toMatch(/body\.style\.top = `-\$\{scrollTop\}px`/);
    expect(app).toMatch(/scroller\.scrollTop = scrollTop/);
    // The offset is tracked continuously, because by lock time it has sometimes already gone.
    expect(app).toMatch(/function useTrackBackgroundScroll\(/);
    expect(app).toMatch(/scroller\.scrollTop \|\| backgroundScrollTop/);
    expect(app).toContain('useTrackBackgroundScroll();');
  });

  it('keeps zoom controls in the menu so an accidental Ctrl+wheel zoom can be undone', () => {
    const main = readFileSync(join(__dirname, '..', 'src', 'main', 'main.ts'), 'utf8');
    for (const role of ['resetZoom', 'zoomIn', 'zoomOut']) expect(main).toContain(`role: '${role}'`);
  });

  it('contains overscroll inside the dialog so a wheel at its end does not chain outward', () => {
    const css = read('styles.css');
    const modalRule = css.match(/\.modal\{[^}]*\}/)?.[0] ?? '';
    expect(modalRule).toContain('overscroll-behavior:contain');
    const backdropRule = css.match(/\.modal-backdrop\{[^}]*\}/)?.[0] ?? '';
    expect(backdropRule).toContain('overscroll-behavior:contain');
  });
});
