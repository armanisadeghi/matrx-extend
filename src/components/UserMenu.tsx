import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/hooks/use-auth";
import { useDesktopBridge } from "@/hooks/use-desktop";
import {
  desktopStatusDotClass,
  formatDesktopConnectionLabel,
} from "@/lib/desktop/types";
import { cn } from "@/lib/utils";
import { useSidepanelTabStore } from "@/state/sidepanel-tab";
import { ChevronRight, LogOut, Settings, User } from "lucide-react";
import { useState } from "react";

/**
 * Avatar button → iOS-style identity sheet.
 *
 * The card-style header up top mirrors how iOS surfaces account identity
 * in System Settings: avatar + name + email, then a list of grouped
 * actions below it. Currently: Profile (form-fill PII) and Preferences
 * (Settings tab). The desktop-bridge presence dot lives on the avatar
 * itself so it stays visible whether the menu is open or closed.
 */
export function UserMenu() {
  const { user, signOut } = useAuth();
  const desktop = useDesktopBridge();
  const setTab = useSidepanelTabStore((s) => s.setTab);
  const [open, setOpen] = useState(false);

  const fullName = user?.full_name?.trim() || user?.email || "Guest";
  const initial = (fullName[0] ?? "?").toUpperCase();
  const dotClass = desktopStatusDotClass(desktop.transport, desktop.health);

  const goto = (tab: "profile" | "settings") => {
    setOpen(false);
    setTab(tab);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={user?.email ?? "Account"}
          className="relative inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent"
        >
          {user?.avatar_url ? (
            <img
              src={user.avatar_url}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            initial
          )}
          <span
            className={cn(
              "absolute -bottom-0 -right-0 size-2 rounded-full ring-2 ring-card",
              dotClass,
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-64 rounded-2xl border bg-popover/95 p-1.5 backdrop-blur"
      >
        {/* Identity header */}
        <div className="flex items-center gap-3 rounded-xl bg-gradient-to-b from-accent/40 to-transparent px-3 py-3">
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-sm font-medium text-secondary-foreground">
            {user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              initial
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{fullName}</div>
            {user?.email && user?.full_name && (
              <div className="truncate text-[11px] text-muted-foreground">
                {user.email}
              </div>
            )}
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", dotClass)} />
              <span>
                Desktop:{" "}
                {formatDesktopConnectionLabel(
                  desktop.transport,
                  desktop.health,
                )}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-1 space-y-0.5">
          <MenuItem
            icon={<User className="size-4" />}
            onClick={() => goto("profile")}
          >
            Profile
          </MenuItem>
          <MenuItem
            icon={<Settings className="size-4" />}
            onClick={() => goto("settings")}
          >
            Preferences
          </MenuItem>
        </div>

        <div className="my-1 h-px bg-border/60" />

        <MenuItem
          icon={<LogOut className="size-4" />}
          destructive
          onClick={() => {
            setOpen(false);
            void signOut();
          }}
        >
          Sign out
        </MenuItem>
      </PopoverContent>
    </Popover>
  );
}

function MenuItem({
  icon,
  destructive = false,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  destructive?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : "text-foreground hover:bg-accent",
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">{children}</span>
      {!destructive && <ChevronRight className="size-3.5 opacity-40" />}
    </button>
  );
}
