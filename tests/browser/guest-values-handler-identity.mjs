// Read-only CDP inspection of the mounted Values keydown function graph.
// This receipt is diagnostic: it never affects the Escape acceptance verdict.
const EXPECTED = { script: 'react-CIAGJaBG.js', line: 0, firstColumn: 20661, lastColumn: 20750 };
const LIMITS = { functions: 24, depth: 4, scopes: 8, bindings: 40 };

function locationOf(properties) {
  const location = properties?.internalProperties?.find(
    (item) => item.name === '[[FunctionLocation]]',
  )?.value?.value;
  if (
    !location ||
    typeof location.scriptId !== 'string' ||
    !Number.isInteger(location.lineNumber) ||
    !Number.isInteger(location.columnNumber)
  )
    return null;
  return { scriptId: location.scriptId, line: location.lineNumber, column: location.columnNumber };
}

function scopesOf(properties) {
  return (
    properties?.internalProperties?.find((item) => item.name === '[[Scopes]]')?.value?.objectId ??
    null
  );
}

function safeUnknown(reason, partial = {}) {
  return {
    status: 'unknown',
    reason,
    expected_compiled_match: false,
    nodes: [],
    edges: [],
    truncated: false,
    limits: { ...LIMITS },
    closure_function_count: 0,
    ...partial,
  };
}

export async function inspectGuestValuesHandlerIdentity(panel) {
  const scripts = new Map();
  const group = 'guest-values-identity';
  let enabled = false;
  let off = null;
  try {
    off = panel.on('Debugger.scriptParsed', ({ scriptId, url }) => {
      // Only the expected compiled asset is retained; URLs never enter the receipt.
      if (
        typeof scriptId === 'string' &&
        typeof url === 'string' &&
        url.endsWith(`/${EXPECTED.script}`)
      )
        scripts.set(scriptId, true);
    });
    await panel.send('Debugger.enable');
    enabled = true;
    const evaluated = await panel.send('Runtime.evaluate', {
      expression: `(() => {
        const dialogs = [...document.querySelectorAll('[role="dialog"][data-state="open"]')]
          .filter((dialog) => dialog.querySelector('[aria-label="Open full view"]'));
        if (dialogs.length !== 1) return null;
        const dialog = dialogs[0];
        const key = Object.keys(dialog).find((name) => name.startsWith('__reactProps$'));
        const handler = key ? dialog[key]?.onKeyDown : null;
        return typeof handler === 'function' ? handler : null;
      })()`,
      returnByValue: false,
      objectGroup: group,
      silent: true,
    });
    const rootId = evaluated?.result?.type === 'function' ? evaluated.result.objectId : null;
    if (!rootId) return safeUnknown('mounted_handler_unavailable');

    const queue = [{ objectId: rootId, parent: null, depth: 0 }];
    const seen = new Set();
    const nodes = [];
    const edges = [];
    let truncated = false;
    let closureFunctions = 0;
    while (queue.length) {
      if (nodes.length >= LIMITS.functions) {
        truncated = true;
        break;
      }
      const next = queue.shift();
      if (seen.has(next.objectId)) continue;
      seen.add(next.objectId);
      const id = nodes.length;
      if (next.parent !== null) edges.push({ from: next.parent, to: id });
      const properties = await panel.send('Runtime.getProperties', {
        objectId: next.objectId,
        ownProperties: true,
        accessorPropertiesOnly: false,
        generatePreview: false,
      });
      const location = locationOf(properties);
      const match = Boolean(
        location &&
          scripts.has(location.scriptId) &&
          location.line === EXPECTED.line &&
          location.column >= EXPECTED.firstColumn &&
          location.column <= EXPECTED.lastColumn,
      );
      nodes.push({
        id,
        depth: next.depth,
        location: location
          ? {
              expected_script: scripts.has(location.scriptId),
              line: location.line,
              column: location.column,
            }
          : null,
        expected_compiled_match: match,
      });
      const scopesId = scopesOf(properties);
      if (!scopesId) continue;
      const scopes = await panel.send('Runtime.getProperties', {
        objectId: scopesId,
        ownProperties: true,
        generatePreview: false,
      });
      const entries = (scopes?.result ?? []).filter((item) => /^\d+$/.test(item.name));
      if (entries.length > LIMITS.scopes) truncated = true;
      for (const scope of entries.slice(0, LIMITS.scopes)) {
        const kind = scope.value?.description?.split(' ')[0];
        if (kind !== 'Closure' && kind !== 'Block') continue;
        if (!scope.value?.objectId) continue;
        const bindings = await panel.send('Runtime.getProperties', {
          objectId: scope.value.objectId,
          ownProperties: true,
          generatePreview: false,
        });
        if (!Array.isArray(bindings?.result)) continue;
        if (bindings.result.length > LIMITS.bindings) truncated = true;
        for (const binding of bindings.result.slice(0, LIMITS.bindings)) {
          if (binding.value?.type !== 'function') continue;
          closureFunctions++;
          if (!binding.value.objectId) continue;
          if (next.depth >= LIMITS.depth) {
            truncated = true;
            continue;
          }
          queue.push({ objectId: binding.value.objectId, parent: id, depth: next.depth + 1 });
        }
      }
    }
    const found = nodes.some((node) => node.expected_compiled_match);
    // Function-valued bindings are a positive witness only: an object-valued
    // binding could retain the callback outside this deliberately narrow graph.
    const status = found ? 'present' : 'unknown';
    return {
      status,
      reason: found ? null : 'expected_callback_not_observed',
      expected_compiled_match: found,
      nodes,
      edges,
      truncated,
      limits: { ...LIMITS },
      closure_function_count: Math.min(closureFunctions, LIMITS.functions + 1),
    };
  } catch {
    return safeUnknown('cdp_inspection_unavailable');
  } finally {
    try {
      await panel.send('Runtime.releaseObjectGroup', { objectGroup: group });
    } catch {}
    if (enabled)
      try {
        await panel.send('Debugger.disable');
      } catch {}
    try {
      off?.();
    } catch {}
  }
}
