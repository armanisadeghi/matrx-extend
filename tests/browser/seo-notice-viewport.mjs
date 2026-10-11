import assert from 'node:assert/strict';

export const NARROW_NOTICE_WIDTH = 360;
// The hosted native side panel may itself be 360px. A wider CDP override
// exercises layout but remains emulated evidence, never a native-width pass.
export const WIDE_NOTICE_WIDTH = 480;

export function planNoticeViewports(nativeViewport) {
  assert.ok(
    Number.isSafeInteger(nativeViewport?.width) &&
      nativeViewport.width > 0 &&
      Number.isSafeInteger(nativeViewport?.height) &&
      nativeViewport.height > 0,
    'notice native panel viewport must have positive integer dimensions',
  );
  return {
    native: nativeViewport,
    wideWidth:
      nativeViewport.width > NARROW_NOTICE_WIDTH ? nativeViewport.width : WIDE_NOTICE_WIDTH,
    wideSource: nativeViewport.width > NARROW_NOTICE_WIDTH ? 'native' : 'emulated',
  };
}

export async function setNoticeViewport(panel, plan, variant, readWidth) {
  if (variant === 'narrow' && plan.native.width === NARROW_NOTICE_WIDTH) {
    await panel.send('Emulation.clearDeviceMetricsOverride');
  } else if (variant === 'narrow') {
    await panel.send('Emulation.setDeviceMetricsOverride', {
      width: NARROW_NOTICE_WIDTH,
      height: plan.native.height,
      deviceScaleFactor: 0,
      mobile: false,
    });
  } else if (variant === 'wide') {
    if (plan.wideSource === 'native') {
      await panel.send('Emulation.clearDeviceMetricsOverride');
    } else {
      await panel.send('Emulation.setDeviceMetricsOverride', {
        width: plan.wideWidth,
        height: plan.native.height,
        deviceScaleFactor: 0,
        mobile: false,
      });
    }
  } else {
    throw new Error(`unknown notice viewport variant: ${variant}`);
  }
  const width = await readWidth();
  assert.equal(width, variant === 'narrow' ? NARROW_NOTICE_WIDTH : plan.wideWidth);
  return {
    width,
    source:
      variant === 'narrow'
        ? plan.native.width === NARROW_NOTICE_WIDTH
          ? 'native'
          : 'emulated'
        : plan.wideSource,
  };
}

export async function restoreNativeNoticeViewport(panel, plan, readWidth) {
  await panel.send('Emulation.clearDeviceMetricsOverride');
  const width = await readWidth();
  assert.equal(width, plan.native.width, 'notice native panel width restored after emulation');
  return { width, source: 'native' };
}
