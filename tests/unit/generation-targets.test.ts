import { credentialDomSource } from '@/lib/credentials/fill-primitive';
import {
  GENERATED_SECRET_TTL_MS,
  mountGenerationTargetRegistry,
} from '@/lib/credentials/generation-targets';
import { afterEach, describe, expect, it } from 'vitest';

// Execute the exact closure-free source Chrome receives. The registry is the
// only persistent isolated-world dependency, mounted exactly as bridge.ts does.
const dispatcher = new Function(`return (${credentialDomSource.toString()});`)() as typeof credentialDomSource;
const documentId = 'document-primitive-test';
const expiresAt = () => Date.now() + GENERATED_SECRET_TTL_MS;

function visible(input: HTMLInputElement): void {
  Object.defineProperty(input, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 120, height: 24, top: 0, left: 0, bottom: 24, right: 120 }),
  });
}
function mount(html: string): HTMLFormElement {
  document.body.innerHTML = html;
  const form = document.querySelector('form') as HTMLFormElement;
  for (const input of Array.from(document.querySelectorAll('input'))) visible(input);
  return form;
}
function discover(expiry = expiresAt()) {
  return dispatcher({ operation: 'discover_new_password_groups', documentId, expiresAt: expiry });
}

afterEach(() => {
  document.body.innerHTML = '';
  window.__matrx_generation_target_registry__?.invalidate();
});

describe('generated password DOM primitive', () => {
  it('offers only a new-password field and its unambiguous confirmation without reading values', () => {
    mount(`
      <form><input id=current type=password autocomplete=current-password value=old>
      <input id=new type=password autocomplete=new-password minlength=12 maxlength=32 pattern="[A-Za-z0-9]+">
      <input id=confirm type=password autocomplete=new-password aria-label="Confirm new password"></form>
    `);
    mountGenerationTargetRegistry();
    const offer = discover();
    expect(offer.reason).toBeUndefined();
    expect(offer.groups).toHaveLength(1);
    expect(offer.groups[0]?.targets.map((target) => target.constraint.roleEvidence)).toEqual([
      'new_password',
      'confirmation',
    ]);
    expect(offer.groups[0]?.targets[0]?.constraint).toMatchObject({
      minLength: 12,
      maxLength: 32,
      autocomplete: 'new-password',
    });
    expect(JSON.stringify(offer)).not.toContain('old');
  });

  it('refuses current-password, OTP, and contradictory password groups', () => {
    mount(`
      <form><input type=password autocomplete=current-password>
      <input type=password autocomplete=one-time-code>
      <input type=password autocomplete=new-password>
      <input type=password aria-label="mystery password"></form>
    `);
    mountGenerationTargetRegistry();
    expect(discover().groups).toEqual([]);
  });

  it('keeps open-shadow targets as original weak identities across dispatcher calls', () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<fieldset><input id=new type=password autocomplete=new-password></fieldset>';
    document.body.append(host);
    const input = root.querySelector('input') as HTMLInputElement;
    visible(input);
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const offer = discover(expiry);
    const target = offer.groups[0]?.targets[0];
    expect(target?.openShadowPath).toHaveLength(1);
    expect(target).toBeDefined();
    input.replaceWith(Object.assign(document.createElement('input'), { type: 'password', autocomplete: 'new-password' }));
    expect(
      dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets: [target!], value: 'abcdEFGH1234' }),
    ).toMatchObject({ status: 'refused_unchanged' });
  });

  it('prevalidates native constraints and does not truncate a generated value', () => {
    mount('<form><input id=new type=password autocomplete=new-password maxlength=8></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const target = discover(expiry).groups[0]?.targets[0];
    const input = document.querySelector('#new') as HTMLInputElement;
    expect(
      dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets: [target!], value: 'abcdEFGH1234' }),
    ).toEqual({ status: 'refused_unchanged', reason: 'constraint_changed' });
    expect(input.value).toBe('');
  });

  it('treats an empty native pattern as a constraint instead of silently ignoring it', () => {
    mount('<form><input id=new type=password autocomplete=new-password pattern=""></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const target = discover(expiry).groups[0]?.targets[0];
    expect(
      dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets: [target!], value: 'abcdEFGH1234' }),
    ).toEqual({ status: 'refused_unchanged', reason: 'constraint_changed' });
  });

  it('rolls back only its own write when an event changes constraints before the next target', () => {
    mount('<form><input id=new type=password autocomplete=new-password><input id=confirm type=password autocomplete=new-password aria-label="confirm password"></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const targets = discover(expiry).groups[0]?.targets ?? [];
    const first = document.querySelector('#new') as HTMLInputElement;
    first.addEventListener('input', () => first.setAttribute('maxlength', '4'), { once: true });
    expect(
      dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets, value: 'abcdEFGH1234' }),
    ).toEqual({ status: 'rolled_back' });
    expect(first.value).toBe('');
    expect((document.querySelector('#confirm') as HTMLInputElement).value).toBe('');
  });

  it('does not erase a reentrant replacement value during rollback', () => {
    mount('<form><input id=new type=password autocomplete=new-password><input id=confirm type=password autocomplete=new-password aria-label="confirm password"></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const targets = discover(expiry).groups[0]?.targets ?? [];
    const first = document.querySelector('#new') as HTMLInputElement;
    first.addEventListener('input', () => {
      first.value = 'site-owned-value';
      document.querySelector('#confirm')?.replaceWith(document.createElement('input'));
    }, { once: true });
    expect(
      dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets, value: 'abcdEFGH1234' }),
    ).toEqual({ status: 'partial_manual_check' });
    expect(first.value).toBe('site-owned-value');
  });

  it('refuses a moved original node and a changed confirmation role after synchronous events', () => {
    const form = mount('<form><fieldset id=group><input id=new type=password autocomplete=new-password><input id=confirm type=password autocomplete=new-password aria-label="confirm password"></fieldset></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const targets = discover(expiry).groups[0]?.targets ?? [];
    const first = document.querySelector('#new') as HTMLInputElement;
    first.addEventListener('change', () => {
      const confirmation = document.querySelector('#confirm') as HTMLInputElement;
      confirmation.autocomplete = 'current-password';
      form.append(confirmation);
    }, { once: true });
    expect(
      dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets, value: 'abcdEFGH1234' }),
    ).toEqual({ status: 'rolled_back' });
    expect(first.value).toBe('');
  });

  it('claims target identities before the first write so a replay cannot fill', () => {
    mount('<form><input id=new type=password autocomplete=new-password></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const targets = discover(expiry).groups[0]?.targets ?? [];
    const first = dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets, value: 'abcdEFGH1234' });
    const replay = dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets, value: 'abcdEFGH1234' });
    expect(first).toEqual({ status: 'filled' });
    expect(replay).toEqual({ status: 'refused_unchanged', reason: 'already_used_or_changed' });
  });

  it('refuses a caller-supplied subset of an offered confirmation group', () => {
    mount('<form><input type=password autocomplete=new-password><input type=password autocomplete=new-password aria-label="confirm password"></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const targets = discover(expiry).groups[0]?.targets ?? [];
    expect(dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets: targets.slice(0, 1), value: 'abcdEFGH1234' }))
      .toEqual({ status: 'refused_unchanged', reason: 'already_used_or_changed' });
  });

  it('offers explicit password groups separately and refuses an added member after discovery', () => {
    mount('<form><fieldset><input type=password autocomplete=new-password></fieldset><fieldset><input type=password autocomplete=new-password></fieldset></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const groups = discover(expiry).groups;
    expect(groups).toHaveLength(2);
    const added = document.createElement('input'); added.type = 'password'; added.autocomplete = 'new-password'; visible(added);
    document.querySelector('fieldset')?.append(added);
    expect(dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets: groups[0]?.targets ?? [], value: 'abcdEFGH1234' }))
      .toEqual({ status: 'refused_unchanged', reason: 'ambiguous_group' });
  });

  it('does not read a password value while discovering metadata', () => {
    mount('<form><input id=new type=password autocomplete=new-password></form>');
    const input = document.querySelector('#new') as HTMLInputElement;
    Object.defineProperty(input, 'value', { configurable: true, get: () => { throw new Error('forbidden_value_read'); }, set: () => undefined });
    mountGenerationTargetRegistry();
    expect(discover().groups).toHaveLength(1);
  });

  it('refuses an expiry beyond the generator TTL ceiling', () => {
    mount('<form><input type=password autocomplete=new-password></form>');
    mountGenerationTargetRegistry();
    expect(discover(Date.now() + GENERATED_SECRET_TTL_MS + 1)).toMatchObject({ groups: [], reason: 'registry_unavailable' });
  });

  it('refuses expiry before any write', () => {
    mount('<form><input id=new type=password autocomplete=new-password></form>');
    mountGenerationTargetRegistry();
    const target = discover(expiresAt()).groups[0]?.targets[0];
    expect(
      dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: Date.now() - 1, targets: [target!], value: 'abcdEFGH1234' }),
    ).toEqual({ status: 'refused_unchanged', reason: 'expired_or_unavailable' });
    expect((document.querySelector('#new') as HTMLInputElement).value).toBe('');
  });
});
