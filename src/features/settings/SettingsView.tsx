import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { type BackendEnv, STORAGE_KEYS } from '@/config/env';
import { useAuth } from '@/hooks/use-auth';
import { useDesktopBridge } from '@/hooks/use-desktop';
import { clearApiBaseCache } from '@/lib/api/client';
import { clearPairToken, setPairToken } from '@/lib/desktop/http';
import { useSettingsStore } from '@/state/settings';
import { Cpu, LogOut, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

export function SettingsView() {
  const { user, signOut } = useAuth();
  const desktop = useDesktopBridge();
  const settings = useSettingsStore();
  const [pairToken, setPairTokenInput] = useState('');

  useEffect(() => {
    void chrome.storage.sync.get(
      [STORAGE_KEYS.BACKEND_ENV, STORAGE_KEYS.BACKEND_URL_OVERRIDE],
      (result) => {
        const env = (result[STORAGE_KEYS.BACKEND_ENV] as BackendEnv | undefined) ?? 'prod';
        const override = (result[STORAGE_KEYS.BACKEND_URL_OVERRIDE] as string | undefined) ?? '';
        settings.setBackendEnv(env);
        settings.setBackendOverride(override);
      },
    );
  }, [settings]);

  const onBackendChange = async (env: BackendEnv) => {
    settings.setBackendEnv(env);
    await chrome.storage.sync.set({ [STORAGE_KEYS.BACKEND_ENV]: env });
    clearApiBaseCache();
  };

  const onOverrideChange = async (val: string) => {
    settings.setBackendOverride(val);
    await chrome.storage.sync.set({ [STORAGE_KEYS.BACKEND_URL_OVERRIDE]: val });
    clearApiBaseCache();
  };

  return (
    <div className="space-y-3 p-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-xs">
            <div className="text-muted-foreground">Signed in as</div>
            <div className="font-medium">{user?.email ?? '—'}</div>
          </div>
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut /> Sign out
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Backend</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Environment</Label>
            <Select
              value={settings.backendEnv}
              onValueChange={(v) => void onBackendChange(v as BackendEnv)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="prod">Production</SelectItem>
                <SelectItem value="staging">Staging</SelectItem>
                <SelectItem value="dev">Dev</SelectItem>
                <SelectItem value="local">Local (localhost:8000)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">URL override (optional)</Label>
            <Input
              value={settings.backendOverride}
              onChange={(e) => void onOverrideChange(e.target.value)}
              placeholder="https://my.custom.backend"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            {desktop.transport === 'native' ? (
              <Cpu className="size-4" />
            ) : desktop.transport === 'http' ? (
              <Wifi className="size-4" />
            ) : (
              <WifiOff className="size-4" />
            )}
            Desktop bridge
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div>
            Status: <span className="font-medium">{desktop.transport}</span>
          </div>
          {desktop.health?.version && <div>matrx-local v{desktop.health.version}</div>}
          {desktop.transport !== 'native' && (
            <div className="space-y-2">
              <Label className="text-xs">Pair token</Label>
              <div className="flex gap-2">
                <Input
                  value={pairToken}
                  onChange={(e) => setPairTokenInput(e.target.value)}
                  placeholder="Paste from matrx-local"
                />
                <Button
                  size="sm"
                  onClick={async () => {
                    if (pairToken) {
                      await setPairToken(pairToken);
                      setPairTokenInput('');
                    }
                  }}
                >
                  Save
                </Button>
              </div>
              <Button size="sm" variant="ghost" onClick={() => void clearPairToken()}>
                Clear pair token
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Scrape defaults</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="deep-clean" className="text-xs">
              Deep clean (server-side AI)
            </Label>
            <Switch
              id="deep-clean"
              checked={settings.scrapeDeepClean}
              onCheckedChange={settings.setScrapeDeepClean}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
