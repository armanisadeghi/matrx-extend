/**
 * Tier: READ — Admin-only diagnostic tools.
 *
 * Two tools live here, both grouped under the `debug` category:
 *
 *   - `get_system_info` — CPU / memory / display info via chrome.system.*.
 *     Useful for the agent to reason about the device it's running on
 *     (e.g., parallel-task fan-out scaled to core count, screenshot
 *     resolution decisions based on display DPR, memory-pressure aware
 *     pagination on long extractions).
 *
 *   - `list_network_blocking_rules` — current dynamic + session
 *     declarativeNetRequest rules. Useful for diagnosing "why is this
 *     request being blocked?" when the user has installed other
 *     extensions or when our own future privacy-respecting blocking
 *     rules are in play.
 *
 * Both are admin-only and read-only. No mutations, no optional
 * permissions, no host scope. Each call is a one-shot snapshot.
 */

import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

const NoArgs = z.object({}).default({});
type NoArgs = z.infer<typeof NoArgs>;

interface SystemInfoResult {
  ok: true;
  cpu: chrome.system.cpu.CpuInfo | null;
  memory: chrome.system.memory.MemoryInfo | null;
  displays: chrome.system.display.DisplayUnitInfo[] | null;
  unavailable: string[];
}

export const get_system_info: ToolHandler<NoArgs, SystemInfoResult> = {
  name: 'get_system_info',
  tier: 'read',
  admin_only: true,
  supportedBrowsers: ['chrome'],
  argsSchema: NoArgs,
  run: async () => {
    const unavailable: string[] = [];
    const cpu = await readCpu().catch((err) => {
      unavailable.push(`cpu: ${(err as Error).message ?? 'unavailable'}`);
      return null;
    });
    const memory = await readMemory().catch((err) => {
      unavailable.push(`memory: ${(err as Error).message ?? 'unavailable'}`);
      return null;
    });
    const displays = await readDisplays().catch((err) => {
      unavailable.push(`displays: ${(err as Error).message ?? 'unavailable'}`);
      return null;
    });
    return { ok: true, cpu, memory, displays, unavailable };
  },
};

interface DnrRulesResult {
  ok: true;
  dynamic: chrome.declarativeNetRequest.Rule[];
  session: chrome.declarativeNetRequest.Rule[];
  total: number;
}

export const list_network_blocking_rules: ToolHandler<NoArgs, DnrRulesResult | { ok: false; reason: string }> = {
  name: 'list_network_blocking_rules',
  tier: 'read',
  admin_only: true,
  supportedBrowsers: ['chrome'],
  argsSchema: NoArgs,
  run: async () => {
    if (!chrome.declarativeNetRequest) {
      return { ok: false, reason: 'chrome.declarativeNetRequest unavailable' };
    }
    const dynamic = await chrome.declarativeNetRequest
      .getDynamicRules()
      .catch(() => [] as chrome.declarativeNetRequest.Rule[]);
    const session = chrome.declarativeNetRequest.getSessionRules
      ? await chrome.declarativeNetRequest
          .getSessionRules()
          .catch(() => [] as chrome.declarativeNetRequest.Rule[])
      : [];
    return {
      ok: true,
      dynamic,
      session,
      total: dynamic.length + session.length,
    };
  },
};

async function readCpu(): Promise<chrome.system.cpu.CpuInfo | null> {
  if (!chrome.system?.cpu?.getInfo) return null;
  return new Promise((resolve, reject) => {
    chrome.system.cpu.getInfo((info) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message ?? 'cpu.getInfo failed'));
      else resolve(info);
    });
  });
}

async function readMemory(): Promise<chrome.system.memory.MemoryInfo | null> {
  if (!chrome.system?.memory?.getInfo) return null;
  return new Promise((resolve, reject) => {
    chrome.system.memory.getInfo((info) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message ?? 'memory.getInfo failed'));
      else resolve(info);
    });
  });
}

async function readDisplays(): Promise<chrome.system.display.DisplayUnitInfo[] | null> {
  if (!chrome.system?.display?.getInfo) return null;
  return new Promise((resolve, reject) => {
    chrome.system.display.getInfo((info) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message ?? 'display.getInfo failed'));
      else resolve(info);
    });
  });
}

export const system_info_handlers = [get_system_info, list_network_blocking_rules];
