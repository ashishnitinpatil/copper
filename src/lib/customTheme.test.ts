import { describe, expect, it } from 'vitest';
import { accentWarning, buildTheme, contrast, isHexColor, modeOf } from './customTheme';

const lum = (triplet: string) => triplet.split(' ').map(Number).reduce((s, v) => s + v, 0);

describe('custom themes', () => {
  it('reads light or dark from the background', () => {
    expect(modeOf('#FBF7F2')).toBe('light');
    expect(modeOf('#17120F')).toBe('dark');
    expect(modeOf('#1E3A5F')).toBe('dark');
  });

  it('makes every token the built-in themes have', () => {
    const { vars } = buildTheme({ background: '#17120F', accent: '#E6A532' });
    for (const s of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) expect(vars[`--s-${s}`]).toMatch(/^\d+ \d+ \d+$/);
    for (const b of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) expect(vars[`--b-${b}`]).toMatch(/^\d+ \d+ \d+$/);
    for (const k of ['--mint-400', '--clay-400', '--ok', '--warn', '--danger', '--info']) expect(vars[k]).toBeTruthy();
  });

  it('keeps the page as the background and the accent as the main button colour', () => {
    const { vars } = buildTheme({ background: '#102030', accent: '#FF8800' });
    expect(vars['--s-950']).toBe('16 32 48');
    expect(vars['--b-500']).toBe('255 136 0');
  });

  it('runs text from dim to bright on dark, and cards lighter than the page on light', () => {
    const dark = buildTheme({ background: '#17120F', accent: '#E6A532' }).vars;
    expect(lum(dark['--s-50'])).toBeGreaterThan(lum(dark['--s-400']));
    expect(lum(dark['--s-400'])).toBeGreaterThan(lum(dark['--s-900']));
    const light = buildTheme({ background: '#F4EEE3', accent: '#B4682F' }).vars;
    expect(lum(light['--s-900'])).toBeGreaterThan(lum(light['--s-950']));
    expect(lum(light['--s-50'])).toBeLessThan(lum(light['--s-500']));
  });

  it('warns when the accent would be hard to see', () => {
    expect(accentWarning({ background: '#FFFFFF', accent: '#FFF3C4' })).not.toBeNull();
    expect(accentWarning({ background: '#FFFFFF', accent: '#2563EB' })).toBeNull();
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21);
  });

  it('accepts only full hex colours', () => {
    expect(isHexColor('#a1b2c3')).toBe(true);
    expect(isHexColor('#abc')).toBe(false);
    expect(isHexColor('red')).toBe(false);
  });
});
