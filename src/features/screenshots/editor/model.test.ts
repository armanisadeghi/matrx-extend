import { describe, expect, it } from 'vitest';
import {
  type Shape,
  clampRect,
  handlesOf,
  hitTest,
  isDegenerate,
  nextStepNumber,
  setHandle,
  shapeAt,
  strokeFor,
  translateShape,
  viewRect,
} from './model';

const base = { color: '#ef4444', size: 4 };
const arrow: Shape = { id: 'a', kind: 'arrow', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, ...base };
const box: Shape = { id: 'b', kind: 'rect', a: { x: 50, y: 50 }, b: { x: 10, y: 10 }, ...base };
const pen: Shape = {
  id: 'p',
  kind: 'pen',
  points: [
    { x: 0, y: 100 },
    { x: 50, y: 100 },
  ],
  ...base,
};
const step: Shape = { id: 's', kind: 'step', at: { x: 200, y: 200 }, n: 3, ...base };

describe('screenshot editor model', () => {
  it('hits an arrow near its line and misses far from it', () => {
    expect(hitTest(arrow, { x: 50, y: 5 }, 3)).toBe(true);
    expect(hitTest(arrow, { x: 50, y: 40 }, 3)).toBe(false);
  });

  it('hits a box anywhere inside, even when drawn right-to-left', () => {
    expect(hitTest(box, { x: 30, y: 30 }, 0)).toBe(true);
    expect(hitTest(box, { x: 80, y: 80 }, 0)).toBe(false);
  });

  it('hits freehand strokes along their path', () => {
    expect(hitTest(pen, { x: 25, y: 102 }, 2)).toBe(true);
    expect(hitTest(pen, { x: 25, y: 140 }, 2)).toBe(false);
  });

  it('picks the topmost shape', () => {
    const over: Shape = { ...box, id: 'top' };
    expect(shapeAt([box, over], { x: 30, y: 30 }, 0)?.id).toBe('top');
    expect(shapeAt([box], { x: 500, y: 500 }, 0)).toBeNull();
  });

  it('moves every kind of shape by the same delta', () => {
    expect(translateShape(arrow, 5, 7)).toMatchObject({ a: { x: 5, y: 7 }, b: { x: 105, y: 7 } });
    expect(translateShape(pen, 1, 1)).toMatchObject({
      points: [
        { x: 1, y: 101 },
        { x: 51, y: 101 },
      ],
    });
    expect(translateShape(step, -10, 0)).toMatchObject({ at: { x: 190, y: 200 } });
  });

  it('resizes two-point shapes by their handles only', () => {
    expect(handlesOf(arrow)).toHaveLength(2);
    expect(handlesOf(step)).toHaveLength(0);
    expect(setHandle(arrow, 1, { x: 9, y: 9 })).toMatchObject({ b: { x: 9, y: 9 } });
  });

  it('numbers steps after the highest existing one', () => {
    expect(nextStepNumber([])).toBe(1);
    expect(nextStepNumber([arrow, step])).toBe(4);
  });

  it('drops stray clicks and empty text', () => {
    expect(isDegenerate({ ...arrow, b: { x: 1, y: 1 } })).toBe(true);
    expect(isDegenerate(arrow)).toBe(false);
    expect(isDegenerate({ id: 't', kind: 'text', at: { x: 0, y: 0 }, text: '  ', ...base })).toBe(
      true,
    );
  });

  it('exports the crop when set, the whole image otherwise', () => {
    expect(viewRect({ shapes: [], crop: null }, 800, 600)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    const crop = { x: 10, y: 20, w: 100, h: 50 };
    expect(viewRect({ shapes: [], crop }, 800, 600)).toEqual(crop);
  });

  it('keeps a crop inside the image', () => {
    expect(clampRect({ x: -10, y: 590, w: 100, h: 50 }, 800, 600)).toEqual({
      x: 0,
      y: 590,
      w: 90,
      h: 10,
    });
  });

  it('scales stroke width with the image so big captures still read', () => {
    expect(strokeFor('m', 4000, 3000)).toBeGreaterThan(strokeFor('m', 1280, 800));
    expect(strokeFor('l', 1280, 800)).toBeGreaterThan(strokeFor('s', 1280, 800));
  });
});
