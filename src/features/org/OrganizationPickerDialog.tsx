/**
 * "Which organization are you working in?" — the one screen that answers a
 * held request.
 *
 * ## Why this exists
 *
 * Every authenticated request this extension sends must say which
 * organization it acts in, and this device is the only thing allowed to
 * answer: a saved preference on the person's account is a display
 * preference, never a request-builder (Arman, 2026-09-19 — `src/lib/org/
 * active-org.ts` carries the ruling and the reason). So when nothing has been
 * set here, the request is HELD rather than failed, and this dialog is what
 * the person sees. The moment they choose, the waiting request continues with
 * the organization they picked.
 *
 * ## Why it listens to TWO things
 *
 * The service worker is where most held requests live, and it cannot draw
 * anything. It sets a durable flag AND broadcasts. This dialog opens on the
 * broadcast when the panel is already open, and on the flag when the panel
 * opens later — a question asked while nobody was looking is still a question.
 *
 * The rows are `OrganizationPicker` from `@ai-matrx/design-system`: the same
 * rows, order and identity tiles as every other Matrx surface. `onSetDefault`
 * is deliberately NOT passed — there is no such thing to set here, and the
 * package hides the control rather than rendering a dead one.
 */

import {
  type MemberOrganization,
  clearOrganizationPickerRequest,
  isOrganizationPickerPending,
  listMemberOrganizations,
  onActiveOrganizationChange,
  onOrganizationPickerRequest,
  setActiveOrganization,
} from '@/lib/org/active-org';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  OrganizationPicker,
} from '@ai-matrx/design-system';
import { useCallback, useEffect, useState } from 'react';

export function OrganizationPickerDialog() {
  const [open, setOpen] = useState(false);
  const [organizations, setOrganizations] = useState<MemberOrganization[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [chooseError, setChooseError] = useState<string | null>(null);

  // The flag covers a panel that was closed when the request was held; the
  // broadcast covers a panel that was already open.
  useEffect(() => {
    void isOrganizationPickerPending().then((pending) => {
      if (pending) setOpen(true);
    });
    return onOrganizationPickerRequest(() => setOpen(true));
  }, []);

  // Someone else answered — Settings, the frontend bridge, a second panel.
  useEffect(
    () =>
      onActiveOrganizationChange((organizationId) => {
        if (organizationId) setOpen(false);
      }),
    [],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    void listMemberOrganizations()
      .then((rows) => {
        if (!cancelled) setOrganizations(rows);
      })
      .catch(() => {
        // A read that failed is NOT "you have no organizations". Saying so
        // would send the person hunting for an invitation they already have.
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const choose = useCallback((organizationId: string) => {
    setChoosing(true);
    setChooseError(null);
    void setActiveOrganization(organizationId)
      .then(() => setOpen(false))
      .catch((err: unknown) => {
        setChooseError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setChoosing(false));
  }, []);

  const dismiss = useCallback(() => {
    void clearOrganizationPickerRequest();
    setOpen(false);
  }, []);

  if (!open) return null;

  // Nothing to choose from: the honest state. A picker with no rows and no
  // sentence is a dead screen; this one says what happened and what fixes it.
  const nothingToChoose = !loading && !loadFailed && organizations.length === 0;

  return (
    <Dialog open onOpenChange={(next) => !next && dismiss()}>
      <DialogContent
        className="max-w-sm"
        showCloseButton={nothingToChoose || loadFailed}
        // While there is something to choose, choosing IS the way out: a
        // request is waiting on the answer, and a dismissed question that
        // silently times out two minutes later is the "dead control" this
        // codebase outlaws.
        onEscapeKeyDown={(event) => {
          if (!nothingToChoose && !loadFailed) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (!nothingToChoose && !loadFailed) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (!nothingToChoose && !loadFailed) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Which organization are you working in?</DialogTitle>
          <DialogDescription>
            Everything AI Matrx does for you happens inside one organization, and this browser has
            not been told which one to use. Pick it once — you can switch any time in Settings.
          </DialogDescription>
        </DialogHeader>
        {nothingToChoose ? (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              You are not a member of any organization yet, so there is nothing to pick. Ask whoever
              runs your workspace to add you, then reopen this panel.
            </p>
            <Button size="sm" variant="outline" onClick={dismiss}>
              Close
            </Button>
          </div>
        ) : (
          <OrganizationPicker
            organizations={organizations}
            activeOrganizationId={null}
            loading={loading || choosing}
            loadFailed={loadFailed}
            hideHeading
            onSelect={(organization) => choose(organization.id)}
          />
        )}
        {chooseError && <p className="text-sm text-destructive">{chooseError}</p>}
      </DialogContent>
    </Dialog>
  );
}
