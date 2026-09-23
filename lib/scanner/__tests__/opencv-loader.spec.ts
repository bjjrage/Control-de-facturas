import { describe, expect, it } from 'vitest';
import { getOpenCvState, loadOpenCv } from '../opencv-loader';

describe('OpenCV loader', () => {
  it('fails closed when called outside a browser', async () => {
    await expect(loadOpenCv()).rejects.toThrow('solo puede cargarse en el navegador');
    expect(getOpenCvState().state).toBe('idle');
  });
});
