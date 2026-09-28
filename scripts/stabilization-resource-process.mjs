import { basename } from 'node:path';

const GUARD = 'stabilization-resource.mjs';

// ps command is display text, not argv. Only the executable column is trusted
// for process kind; a Node command whose script operand cannot be established
// remains an ambiguity instead of being admitted over a possible old runner.
export function classifyLegacyRunner(executable, command) {
  if (basename(executable) !== 'node') return null;
  if (!command.startsWith(`${executable} `))
    return command.includes(GUARD) ? 'ambiguous-command' : null;
  const args = command.slice(executable.length).trimStart();
  const tokens = args.split(/\s+/);
  let first;
  let unknownOption = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (['-e', '--eval', '-p', '--print'].includes(token) ||
        /^(?:--eval|--print)=/.test(token)) return null;
    if (token === '--') { first = tokens[i + 1]; break; }
    if (['-r', '--require', '--import', '--loader', '--experimental-loader', '--env-file'].includes(token)) {
      i++;
      continue;
    }
    if (token.startsWith('-')) {
      if (!/^(?:--input-type=|--no-warnings$|--trace-warnings$|--inspect(?:-brk)?(?:=|$))/.test(token))
        unknownOption = true;
      continue;
    }
    first = token;
    break;
  }
  if (unknownOption && args.includes(GUARD)) return 'ambiguous-arguments';
  if (first && basename(first) === GUARD) return 'script-operand';
  if (first && /\.(?:[cm]?js|ts)$/.test(first)) return null;
  return args.includes(GUARD) ? 'ambiguous-arguments' : null;
}

export function parseProcessIdentity(line) {
  const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/);
  if (!match) throw new Error('RESOURCE_PROCESS_SNAPSHOT_AMBIGUOUS');
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    processStart: match[3].trim(),
    executable: match[4].trim(),
  };
}
