import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/**
 * The Windows taskbar icon comes from the icon compiled into the .exe by electron-builder, which
 * only happens if `win.icon` points at a real multi-resolution .ico. These guards exist because a
 * missing icon is invisible in every test and every screenshot, and only shows up as a generic
 * Electron logo on a real taskbar.
 */
describe('windows packaging carries the app icon', () => {
  it('points the Windows build and the installer at the icon', () => {
    expect(pkg.build.win.icon).toBe('assets/icon.ico');
    expect(pkg.build.nsis.installerIcon).toBe('assets/icon.ico');
    expect(pkg.build.nsis.uninstallerIcon).toBe('assets/icon.ico');
    expect(pkg.build.nsis.installerHeaderIcon).toBe('assets/icon.ico');
    expect(pkg.build.nsis.shortcutName).toBe('Board Tracker');
  });

  it('ships the icon files inside the package', () => {
    expect(pkg.build.files).toContain('assets/icon.ico');
    expect(pkg.build.extraResources.some((entry: { to: string }) => entry.to === 'icon.png')).toBe(true);
  });

  it('has an icon file that really exists and is a valid ICO', () => {
    const icon = fs.readFileSync(path.join(root, 'assets', 'icon.ico'));
    // ICONDIR: reserved 0, type 1 (icon), then the image count.
    expect(icon.readUInt16LE(0)).toBe(0);
    expect(icon.readUInt16LE(2)).toBe(1);
    expect(icon.readUInt16LE(4)).toBeGreaterThan(0);
  });

  it('includes the small sizes Windows actually draws in the taskbar', () => {
    const icon = fs.readFileSync(path.join(root, 'assets', 'icon.ico'));
    const count = icon.readUInt16LE(4);
    // Each ICONDIRENTRY is 16 bytes; a width or height byte of 0 means 256.
    const sizes = new Set(Array.from({ length: count }, (_, index) => icon.readUInt8(6 + index * 16) || 256));
    for (const size of [16, 24, 32, 48, 256]) expect(sizes.has(size)).toBe(true);
  });

  it('names the app so Windows attributes the taskbar button to it', () => {
    const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
    expect(main).toContain(`app.setAppUserModelId('${pkg.build.appId}')`);
    expect(main).toContain('icon: iconPath()');
  });
});
