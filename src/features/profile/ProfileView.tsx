/**
 * Profile — user-controlled PII used by form-fill agents.
 *
 * iOS-style: grouped cards, single-row controls, soft separators. Each
 * Collapsible section maps to one logical chunk of the user_form_profile
 * row.
 *
 * Reachable from the avatar dropdown. Not advertised in the tab strip
 * because it's a once-in-a-while destination, not a workflow tab.
 */

import { Button } from '@/components/ui/button';
import { Collapsible } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { useUserProfile } from '@/hooks/use-user-profile';
import type {
  EmailEntry,
  EmergencyContact,
  Phone,
  SocialHandle,
  UserFormProfile,
} from '@/lib/supabase/user-profile';
import { cn } from '@/lib/utils';
import { useSidepanelTabStore } from '@/state/sidepanel-tab';
import { Check, ChevronLeft, Loader2, Plus, Star, Trash2 } from 'lucide-react';

export function ProfileView() {
  const { user } = useAuth();
  const setTab = useSidepanelTabStore((s) => s.setTab);
  const profile = useUserProfile();

  const fullName =
    [profile.draft.legal_first_name, profile.draft.legal_last_name]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    user?.full_name ||
    user?.email ||
    'Your profile';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center gap-1 px-1.5">
        <button
          type="button"
          onClick={() => setTab('chat')}
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Back"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-sm font-medium">Profile</span>
        <div className="ml-auto flex items-center gap-1">
          {profile.dirty && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
              onClick={profile.resetDraft}
              disabled={profile.saving}
            >
              Discard
            </Button>
          )}
          <Button
            size="sm"
            className="h-7 rounded-full px-3 text-xs"
            disabled={!profile.dirty || profile.saving}
            onClick={() => {
              void profile.save();
            }}
          >
            {profile.saving ? (
              <Loader2 className="size-3 animate-spin" />
            ) : profile.dirty ? (
              'Save'
            ) : (
              <Check className="size-3" />
            )}
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {profile.loading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : (
          <div className="space-y-3 px-3 pb-3">
            {/* Identity card */}
            <IdentityCard fullName={fullName} email={user?.email ?? null} />

            <Collapsible label="Identity">
              <Card>
                <FormRow label="First name">
                  <TextField
                    value={profile.draft.legal_first_name ?? ''}
                    onChange={(v) => profile.setField('legal_first_name', v || null)}
                  />
                </FormRow>
                <FormRow label="Middle">
                  <TextField
                    value={profile.draft.legal_middle_name ?? ''}
                    onChange={(v) => profile.setField('legal_middle_name', v || null)}
                  />
                </FormRow>
                <FormRow label="Last name">
                  <TextField
                    value={profile.draft.legal_last_name ?? ''}
                    onChange={(v) => profile.setField('legal_last_name', v || null)}
                  />
                </FormRow>
                <FormRow label="Preferred">
                  <TextField
                    value={profile.draft.preferred_name ?? ''}
                    onChange={(v) => profile.setField('preferred_name', v || null)}
                  />
                </FormRow>
                <FormRow label="Suffix">
                  <TextField
                    value={profile.draft.name_suffix ?? ''}
                    placeholder="Jr., III, PhD"
                    onChange={(v) => profile.setField('name_suffix', v || null)}
                  />
                </FormRow>
                <FormRow label="Pronouns">
                  <TextField
                    value={profile.draft.pronouns ?? ''}
                    placeholder="they/them"
                    onChange={(v) => profile.setField('pronouns', v || null)}
                  />
                </FormRow>
                <FormRow label="Birthday">
                  <TextField
                    value={profile.draft.date_of_birth ?? ''}
                    type="date"
                    onChange={(v) => profile.setField('date_of_birth', v || null)}
                  />
                </FormRow>
              </Card>
            </Collapsible>

            <Collapsible label="Phones">
              <PhonesEditor
                phones={profile.draft.phones}
                onChange={(next) => profile.setField('phones', next)}
              />
            </Collapsible>

            <Collapsible label="Emails">
              <EmailsEditor
                emails={profile.draft.emails}
                onChange={(next) => profile.setField('emails', next)}
              />
            </Collapsible>

            <Collapsible label="Web" defaultOpen={false}>
              <Card>
                <FormRow label="Website">
                  <TextField
                    value={profile.draft.website_url ?? ''}
                    placeholder="https://"
                    onChange={(v) => profile.setField('website_url', v || null)}
                  />
                </FormRow>
              </Card>
              <div className="h-2" />
              <SocialHandlesEditor
                handles={profile.draft.social_handles}
                onChange={(next) => profile.setField('social_handles', next)}
              />
            </Collapsible>

            <Collapsible label="Shipping address" defaultOpen={false}>
              <AddressCard prefix="shipping" profile={profile.draft} setField={profile.setField} />
            </Collapsible>

            <Collapsible label="Billing address" defaultOpen={false}>
              <Card>
                <FormRow label="Same as shipping">
                  <Switch
                    checked={profile.draft.billing_same_as_shipping}
                    onCheckedChange={(v) => profile.setField('billing_same_as_shipping', v)}
                  />
                </FormRow>
              </Card>
              {!profile.draft.billing_same_as_shipping && (
                <>
                  <div className="h-2" />
                  <AddressCard
                    prefix="billing"
                    profile={profile.draft}
                    setField={profile.setField}
                  />
                </>
              )}
            </Collapsible>

            <Collapsible label="Employment" defaultOpen={false}>
              <Card>
                <FormRow label="Company">
                  <TextField
                    value={profile.draft.company_name ?? ''}
                    onChange={(v) => profile.setField('company_name', v || null)}
                  />
                </FormRow>
                <FormRow label="Title">
                  <TextField
                    value={profile.draft.job_title ?? ''}
                    onChange={(v) => profile.setField('job_title', v || null)}
                  />
                </FormRow>
              </Card>
            </Collapsible>

            <Collapsible label="Emergency contacts" defaultOpen={false}>
              <EmergencyContactsEditor
                contacts={profile.draft.emergency_contacts}
                onChange={(next) => profile.setField('emergency_contacts', next)}
              />
            </Collapsible>

            {profile.error && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2 text-xs text-destructive">
                {profile.error}
              </div>
            )}
          </div>
        )}
      </div>

      {profile.dirty && (
        <div className="shrink-0 border-t bg-card/80 px-3 py-2 backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 rounded-full px-3"
                onClick={profile.resetDraft}
                disabled={profile.saving}
              >
                Discard
              </Button>
              <Button
                size="sm"
                className="h-8 rounded-full px-4"
                onClick={() => {
                  void profile.save();
                }}
                disabled={profile.saving}
              >
                {profile.saving ? <Loader2 className="size-3.5 animate-spin" /> : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Identity card (avatar header) ──────────────────────────────────────────
function IdentityCard({
  fullName,
  email,
}: {
  fullName: string;
  email: string | null;
}) {
  const { user } = useAuth();
  return (
    <div className="rounded-2xl border bg-gradient-to-b from-accent/40 to-card px-4 py-4">
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center overflow-hidden rounded-full bg-secondary text-base font-medium text-secondary-foreground">
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt="" className="size-full object-cover" />
          ) : (
            (fullName[0] ?? '?').toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{fullName}</div>
          {email && <div className="truncate text-xs text-muted-foreground">{email}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Address sub-card ───────────────────────────────────────────────────────
function AddressCard({
  prefix,
  profile,
  setField,
}: {
  prefix: 'shipping' | 'billing';
  profile: UserFormProfile;
  setField: ReturnType<typeof useUserProfile>['setField'];
}) {
  const k = (key: string) => `${prefix}_${key}` as keyof UserFormProfile;
  const get = (key: string) => (profile[k(key)] as string | null | undefined) ?? '';
  return (
    <Card>
      <FormRow label="Line 1">
        <TextField
          value={get('line1')}
          onChange={(v) => setField(k('line1'), (v || null) as never)}
        />
      </FormRow>
      <FormRow label="Line 2">
        <TextField
          value={get('line2')}
          onChange={(v) => setField(k('line2'), (v || null) as never)}
        />
      </FormRow>
      <FormRow label="City">
        <TextField
          value={get('city')}
          onChange={(v) => setField(k('city'), (v || null) as never)}
        />
      </FormRow>
      <FormRow label="State / region">
        <TextField
          value={get('region')}
          onChange={(v) => setField(k('region'), (v || null) as never)}
        />
      </FormRow>
      <FormRow label="Postal code">
        <TextField
          value={get('postal_code')}
          onChange={(v) => setField(k('postal_code'), (v || null) as never)}
        />
      </FormRow>
      <FormRow label="Country">
        <TextField
          value={get('country')}
          placeholder="US"
          onChange={(v) => setField(k('country'), (v || null) as never)}
        />
      </FormRow>
    </Card>
  );
}

// ─── Phones editor ──────────────────────────────────────────────────────────
function PhonesEditor({
  phones,
  onChange,
}: {
  phones: Phone[];
  onChange: (next: Phone[]) => void;
}) {
  const update = (idx: number, patch: Partial<Phone>) =>
    onChange(phones.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  const remove = (idx: number) => onChange(phones.filter((_, i) => i !== idx));
  const setPrimary = (idx: number) =>
    onChange(phones.map((p, i) => ({ ...p, is_primary: i === idx })));

  return (
    <ListSection
      empty="No phones added"
      onAdd={() => onChange([...phones, { value: '', label: 'Mobile' }])}
    >
      {phones.map((p, idx) => (
        <ListItemCard key={idx}>
          <div className="flex items-center gap-2 px-3 pt-2">
            <Input
              value={p.label ?? ''}
              placeholder="Mobile"
              className="h-7 max-w-[120px] rounded-full border-0 bg-secondary text-xs focus-visible:ring-1"
              onChange={(e) => update(idx, { label: e.target.value || null })}
            />
            <PrimaryStar active={!!p.is_primary} onClick={() => setPrimary(idx)} />
            <button
              type="button"
              onClick={() => remove(idx)}
              className="ml-auto flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <div className="divide-y divide-border/60">
            <FormRow label="Number">
              <TextField
                value={p.value}
                placeholder="+1 555 555 5555"
                onChange={(v) => update(idx, { value: v })}
              />
            </FormRow>
            <FormRow label="Country code">
              <TextField
                value={p.country_code ?? ''}
                placeholder="US"
                onChange={(v) => update(idx, { country_code: v || null })}
              />
            </FormRow>
            <FormRow label="SMS">
              <Switch
                checked={!!p.sms_capable}
                onCheckedChange={(v) => update(idx, { sms_capable: v })}
              />
            </FormRow>
          </div>
        </ListItemCard>
      ))}
    </ListSection>
  );
}

// ─── Emails editor ──────────────────────────────────────────────────────────
function EmailsEditor({
  emails,
  onChange,
}: {
  emails: EmailEntry[];
  onChange: (next: EmailEntry[]) => void;
}) {
  const update = (idx: number, patch: Partial<EmailEntry>) =>
    onChange(emails.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  const remove = (idx: number) => onChange(emails.filter((_, i) => i !== idx));
  const setPrimary = (idx: number) =>
    onChange(emails.map((e, i) => ({ ...e, is_primary: i === idx })));

  return (
    <ListSection
      empty="No additional emails"
      onAdd={() => onChange([...emails, { value: '', label: 'Personal' }])}
    >
      {emails.map((e, idx) => (
        <ListItemCard key={idx}>
          <div className="flex items-center gap-2 px-3 pt-2">
            <Input
              value={e.label ?? ''}
              placeholder="Personal"
              className="h-7 max-w-[120px] rounded-full border-0 bg-secondary text-xs focus-visible:ring-1"
              onChange={(ev) => update(idx, { label: ev.target.value || null })}
            />
            <PrimaryStar active={!!e.is_primary} onClick={() => setPrimary(idx)} />
            <button
              type="button"
              onClick={() => remove(idx)}
              className="ml-auto flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <div className="divide-y divide-border/60">
            <FormRow label="Email">
              <TextField
                value={e.value}
                type="email"
                placeholder="you@example.com"
                onChange={(v) => update(idx, { value: v })}
              />
            </FormRow>
          </div>
        </ListItemCard>
      ))}
    </ListSection>
  );
}

// ─── Social handles editor ──────────────────────────────────────────────────
function SocialHandlesEditor({
  handles,
  onChange,
}: {
  handles: SocialHandle[];
  onChange: (next: SocialHandle[]) => void;
}) {
  const update = (idx: number, patch: Partial<SocialHandle>) =>
    onChange(handles.map((h, i) => (i === idx ? { ...h, ...patch } : h)));
  const remove = (idx: number) => onChange(handles.filter((_, i) => i !== idx));

  return (
    <ListSection
      empty="No social handles"
      onAdd={() => onChange([...handles, { platform: '', handle: '' }])}
    >
      {handles.map((h, idx) => (
        <ListItemCard key={idx}>
          <div className="flex items-center gap-2 px-3 pt-2">
            <span className="text-xs font-medium text-muted-foreground">
              {h.platform || 'New handle'}
            </span>
            <button
              type="button"
              onClick={() => remove(idx)}
              className="ml-auto flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <div className="divide-y divide-border/60">
            <FormRow label="Platform">
              <TextField
                value={h.platform}
                placeholder="LinkedIn, GitHub, X…"
                onChange={(v) => update(idx, { platform: v })}
              />
            </FormRow>
            <FormRow label="Handle">
              <TextField
                value={h.handle ?? ''}
                placeholder="@you"
                onChange={(v) => update(idx, { handle: v || null })}
              />
            </FormRow>
            <FormRow label="URL">
              <TextField
                value={h.url ?? ''}
                placeholder="https://"
                onChange={(v) => update(idx, { url: v || null })}
              />
            </FormRow>
            <FormRow label="Public">
              <Switch
                checked={!!h.is_public}
                onCheckedChange={(v) => update(idx, { is_public: v })}
              />
            </FormRow>
          </div>
        </ListItemCard>
      ))}
    </ListSection>
  );
}

// ─── Emergency contacts editor ──────────────────────────────────────────────
function EmergencyContactsEditor({
  contacts,
  onChange,
}: {
  contacts: EmergencyContact[];
  onChange: (next: EmergencyContact[]) => void;
}) {
  const update = (idx: number, patch: Partial<EmergencyContact>) =>
    onChange(contacts.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  const remove = (idx: number) => onChange(contacts.filter((_, i) => i !== idx));

  return (
    <ListSection empty="No emergency contacts" onAdd={() => onChange([...contacts, { name: '' }])}>
      {contacts.map((c, idx) => (
        <ListItemCard key={idx}>
          <div className="flex items-center gap-2 px-3 pt-2">
            <span className="text-xs font-medium text-muted-foreground">
              {c.name || 'New contact'}
            </span>
            <button
              type="button"
              onClick={() => remove(idx)}
              className="ml-auto flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <div className="divide-y divide-border/60">
            <FormRow label="Name">
              <TextField value={c.name} onChange={(v) => update(idx, { name: v })} />
            </FormRow>
            <FormRow label="Relationship">
              <TextField
                value={c.relationship ?? ''}
                placeholder="Spouse, parent…"
                onChange={(v) => update(idx, { relationship: v || null })}
              />
            </FormRow>
            <FormRow label="Phone">
              <TextField
                value={c.phone ?? ''}
                onChange={(v) => update(idx, { phone: v || null })}
              />
            </FormRow>
            <FormRow label="Email">
              <TextField
                value={c.email ?? ''}
                type="email"
                onChange={(v) => update(idx, { email: v || null })}
              />
            </FormRow>
            <FormRow label="Notes">
              <TextField
                value={c.notes ?? ''}
                onChange={(v) => update(idx, { notes: v || null })}
              />
            </FormRow>
          </div>
        </ListItemCard>
      ))}
    </ListSection>
  );
}

// ─── Reusable building blocks ───────────────────────────────────────────────
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="divide-y divide-border/60">{children}</div>
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 px-3.5 py-1.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 justify-end">{children}</div>
    </div>
  );
}

function TextField({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'email' | 'tel' | 'date' | 'url';
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-7 w-full max-w-[58%] rounded-md bg-transparent px-2 text-right text-sm outline-none',
        'placeholder:text-muted-foreground/50',
        'focus:bg-accent/50',
      )}
    />
  );
}

function ListSection({
  empty,
  children,
  onAdd,
}: {
  empty: string;
  children: React.ReactNode;
  onAdd: () => void;
}) {
  const items = Array.isArray(children) ? children : [children];
  const hasItems = items.length > 0 && items.some(Boolean);
  return (
    <div className="space-y-2">
      {hasItems ? (
        items
      ) : (
        <div className="rounded-xl border border-dashed bg-card/50 px-3.5 py-3 text-center text-xs italic text-muted-foreground/70">
          {empty}
        </div>
      )}
      <button
        type="button"
        onClick={onAdd}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed bg-card/50 px-3.5 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
      >
        <Plus className="size-3.5" /> Add
      </button>
    </div>
  );
}

function ListItemCard({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-xl border bg-card">{children}</div>;
}

function PrimaryStar({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex size-6 items-center justify-center rounded-full transition-colors',
        active
          ? 'text-amber-500 hover:bg-amber-500/10'
          : 'text-muted-foreground/40 hover:bg-accent hover:text-foreground',
      )}
      title={active ? 'Primary' : 'Mark as primary'}
    >
      <Star className={cn('size-3.5', active && 'fill-current')} />
    </button>
  );
}
