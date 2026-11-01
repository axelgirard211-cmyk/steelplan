import { describe, expect, it } from 'vitest';
import type { Sheet } from '../../core/drawing/sheet';
import { sheetToSvg } from '../svgString';

describe('échappement SVG', () => {
  it('échappe aussi l’apostrophe, en plus de & < > "', () => {
    const feuille = { format: 'A4', titre: `l'atelier "A" <b> & co`, scene: { entities: [] } } as unknown as Sheet;
    const svg = sheetToSvg(feuille);
    expect(svg).toContain('aria-label="l&#39;atelier &quot;A&quot; &lt;b&gt; &amp; co"');
    expect(svg).not.toContain("l'atelier");
  });
});
