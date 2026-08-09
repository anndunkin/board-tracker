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

  it('restores the original overflow rather than assuming it was unset', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/const overflow = body\.style\.overflow/);
    expect(app).toMatch(/body\.style\.overflow = overflow/);
  });

  it('pads the scrollbar gutter so the page does not jump sideways as a dialog opens', () => {
    expect(read('App.tsx')).toMatch(/window\.innerWidth - documentElement\.clientWidth/);
  });

  it('contains overscroll inside the dialog so a wheel at its end does not chain outward', () => {
    const css = read('styles.css');
    const modalRule = css.match(/\.modal\{[^}]*\}/)?.[0] ?? '';
    expect(modalRule).toContain('overscroll-behavior:contain');
    const backdropRule = css.match(/\.modal-backdrop\{[^}]*\}/)?.[0] ?? '';
    expect(backdropRule).toContain('overscroll-behavior:contain');
  });
});
