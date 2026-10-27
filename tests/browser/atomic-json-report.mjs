import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

export function publishAtomicJsonReport(
  report,
  destination,
  temporaryPrefix = `.${basename(destination)}-`,
) {
  const outputDir = dirname(destination);
  mkdirSync(outputDir, { recursive: true });
  const temporary = join(outputDir, `${temporaryPrefix}${randomUUID()}.json`);
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(report, null, 2)}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, destination);
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}
