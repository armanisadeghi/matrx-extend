/**
 * Microphone Diagnostics
 *
 * Comprehensive diagnostics and troubleshooting for microphone access.
 * Ported verbatim from matrx-frontend/features/audio/utils/microphone-diagnostics.ts.
 */

export interface DiagnosticResult {
  hasMediaDevices: boolean;
  hasGetUserMedia: boolean;
  permissionState: 'granted' | 'denied' | 'prompt' | 'unknown';
  availableDevices: MediaDeviceInfo[];
  browserInfo: {
    name: string;
    version: string;
    isMobile: boolean;
    isIOS: boolean;
    isSafari: boolean;
  };
  isSecureContext: boolean;
  canRequestPermission: boolean;
  issues: DiagnosticIssue[];
  recommendations: string[];
}

export interface DiagnosticIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  solution: string;
}

export async function runMicrophoneDiagnostics(): Promise<DiagnosticResult> {
  const result: DiagnosticResult = {
    hasMediaDevices: false,
    hasGetUserMedia: false,
    permissionState: 'unknown',
    availableDevices: [],
    browserInfo: getBrowserInfo(),
    isSecureContext: window.isSecureContext,
    canRequestPermission: false,
    issues: [],
    recommendations: [],
  };

  result.hasMediaDevices = !!navigator.mediaDevices;
  if (!result.hasMediaDevices) {
    result.issues.push({
      severity: 'error',
      code: 'NO_MEDIA_DEVICES',
      message: 'MediaDevices API not available',
      solution: 'Your browser may not support audio recording. Try using Chrome, Firefox, or Safari.',
    });
    return result;
  }

  result.hasGetUserMedia = !!navigator.mediaDevices.getUserMedia;
  if (!result.hasGetUserMedia) {
    result.issues.push({
      severity: 'error',
      code: 'NO_GET_USER_MEDIA',
      message: 'getUserMedia not available',
      solution: 'Your browser version may be outdated. Please update your browser.',
    });
    return result;
  }

  if (!result.isSecureContext) {
    result.issues.push({
      severity: 'error',
      code: 'INSECURE_CONTEXT',
      message: 'Microphone access requires HTTPS',
      solution: 'This page must be served over HTTPS to access the microphone.',
    });
    return result;
  }

  try {
    if ('permissions' in navigator) {
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      result.permissionState = permissionStatus.state;

      if (permissionStatus.state === 'denied') {
        result.issues.push({
          severity: 'error',
          code: 'PERMISSION_DENIED',
          message: 'Microphone access is blocked',
          solution: 'You need to allow microphone access in your browser settings.',
        });
      }
    }
  } catch (err) {
    console.warn('Permission query failed:', err);
    result.permissionState = 'unknown';
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    result.availableDevices = devices.filter((d) => d.kind === 'audioinput');

    if (result.availableDevices.length === 0) {
      result.issues.push({
        severity: 'error',
        code: 'NO_MICROPHONE',
        message: 'No microphone detected',
        solution: 'Please connect a microphone and refresh the page.',
      });
    }
  } catch {
    result.issues.push({
      severity: 'warning',
      code: 'ENUMERATE_FAILED',
      message: 'Could not list audio devices',
      solution: 'Grant microphone permission and refresh the page.',
    });
  }

  if (result.permissionState === 'granted') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      result.canRequestPermission = true;
    } catch (err: unknown) {
      result.canRequestPermission = false;
      const name = err instanceof Error ? err.name : 'Microphone access test failed';
      result.issues.push({
        severity: 'error',
        code: 'ACCESS_TEST_FAILED',
        message: name,
        solution: 'Try refreshing the page or checking your browser settings.',
      });
    }
  } else if (result.permissionState === 'prompt') {
    result.canRequestPermission = true;
  }

  if (result.browserInfo.isSafari) {
    result.recommendations.push(
      'Safari may require additional permissions. Check System Preferences > Security & Privacy > Microphone.',
    );
  }

  if (result.browserInfo.isIOS) {
    result.recommendations.push(
      'iOS requires microphone permission at the system level. Check Settings > Safari > Microphone.',
    );
  }

  if (result.issues.length === 0 && result.permissionState === 'prompt') {
    result.recommendations.push('Click the microphone button to request permission.');
  }

  return result;
}

function getBrowserInfo() {
  const ua = navigator.userAgent;
  const info = {
    name: 'Unknown',
    version: 'Unknown',
    isMobile: /Mobile|Android|iPhone|iPad|iPod/.test(ua),
    isIOS: /iPhone|iPad|iPod/.test(ua),
    isSafari: /^((?!chrome|android).)*safari/i.test(ua),
  };

  if (/Chrome/.test(ua) && !/Edge|Edg/.test(ua)) {
    info.name = 'Chrome';
    const m = ua.match(/Chrome\/(\d+)/);
    info.version = m?.[1] ?? 'Unknown';
  } else if (/Firefox/.test(ua)) {
    info.name = 'Firefox';
    const m = ua.match(/Firefox\/(\d+)/);
    info.version = m?.[1] ?? 'Unknown';
  } else if (/Safari/.test(ua) && !/Chrome/.test(ua)) {
    info.name = 'Safari';
    const m = ua.match(/Version\/(\d+)/);
    info.version = m?.[1] ?? 'Unknown';
  } else if (/Edge|Edg/.test(ua)) {
    info.name = 'Edge';
    const m = ua.match(/Edg?\/(\d+)/);
    info.version = m?.[1] ?? 'Unknown';
  }

  return info;
}

export function getErrorSolution(error: unknown): { message: string; solution: string; code: string } {
  const errorName = error instanceof Error ? error.name : '';
  const errorMessage = error instanceof Error ? error.message : '';

  if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
    return {
      code: 'PERMISSION_DENIED',
      message: 'Microphone access was denied',
      solution: 'Click the microphone button above to grant permission, or check your browser settings.',
    };
  }

  if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
    return {
      code: 'NO_DEVICE',
      message: 'No microphone found',
      solution: 'Please connect a microphone and try again.',
    };
  }

  if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
    return {
      code: 'DEVICE_BUSY',
      message: 'Microphone is already in use',
      solution: 'Close other applications using the microphone and try again.',
    };
  }

  if (errorName === 'SecurityError') {
    return {
      code: 'SECURITY_ERROR',
      message: 'Microphone access requires HTTPS',
      solution: 'This feature only works on secure (HTTPS) pages.',
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: errorMessage || 'Failed to access microphone',
    solution: 'Try refreshing the page or check your browser settings.',
  };
}

export function canUserFixIssue(diagnostics: DiagnosticResult): boolean {
  if (!diagnostics.hasMediaDevices || !diagnostics.hasGetUserMedia || !diagnostics.isSecureContext) {
    return false;
  }
  return true;
}

export function getFixInstructions(diagnostics: DiagnosticResult): string[] {
  const instructions: string[] = [];
  const { browserInfo, permissionState, issues } = diagnostics;

  if (permissionState === 'denied') {
    instructions.push('**Reset Microphone Permission:**');

    if (browserInfo.name === 'Chrome' || browserInfo.name === 'Edge') {
      instructions.push('1. Click the lock icon in the address bar');
      instructions.push('2. Find "Microphone" and change it to "Allow"');
      instructions.push('3. Refresh this page');
    } else if (browserInfo.name === 'Firefox') {
      instructions.push('1. Click the microphone icon in the address bar');
      instructions.push('2. Remove the "Blocked" status');
      instructions.push('3. Refresh this page');
    } else if (browserInfo.name === 'Safari') {
      instructions.push('1. Go to Safari > Settings > Websites > Microphone');
      instructions.push('2. Find this website and change to "Allow"');
      instructions.push('3. Refresh this page');

      if (browserInfo.isMobile) {
        instructions.push('4. On iOS, also check Settings > Safari > Microphone');
      }
    }
  }

  if (issues.some((i) => i.code === 'NO_MICROPHONE')) {
    instructions.push('**Connect a Microphone:**');
    instructions.push('1. Plug in a microphone or headset');
    instructions.push('2. Refresh this page');
    instructions.push('3. Grant permission when prompted');
  }

  if (!diagnostics.hasMediaDevices || !diagnostics.hasGetUserMedia) {
    instructions.push('**Update Your Browser:**');
    instructions.push('1. Check for browser updates');
    instructions.push('2. Or try Chrome, Firefox, or Safari');
  }

  return instructions;
}
