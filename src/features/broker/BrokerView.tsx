/**
 * Token Broker demo surface (admin) — a THIN test layer over the primitive
 * in src/lib/broker/. Nothing here is broker logic; it only exercises:
 *   1. Mint (any audience, explicit tier policy, optional ttl/model)
 *   2. The SW-owned cache (snapshot, refresh-ahead visibility, invalidate)
 *   3. A proxied round-trip (Anthropic Messages via the aidream gateway,
 *      executed in the SW so the token never reaches this context)
 *
 * Verify path: docs/feature-tests.md → "Token broker — demo surface".
 */

import { Badge } from '@/components/ui/badge';
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
import { Textarea } from '@/components/ui/textarea';
import { useBroker } from '@/hooks/use-broker';
import type { BrokerResult, BrokeredCredential, TierPolicy } from '@/lib/broker';
import { KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

// Demo convenience only — the primitive takes ANY audience string; new
// server-side audiences work here with zero client changes (type the name).
const KNOWN_AUDIENCES = ['anthropic', 'openai_realtime'];

const TIER_POLICIES: TierPolicy[] = ['none', 'guest', 'mid'];

function fmtCountdown(expiresAtSec: number, nowMs: number): string {
  const s = Math.round(expiresAtSec - nowMs / 1000);
  if (s <= 0) return 'expired';
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export default function BrokerView() {
  const { snapshot, refreshSnapshot, mint, invalidate, proxiedJson } = useBroker();

  const [audience, setAudience] = useState('anthropic');
  const [tier, setTier] = useState<TierPolicy | ''>('');
  const [ttl, setTtl] = useState('');
  const [model, setModel] = useState('');
  const [minting, setMinting] = useState(false);
  const [mintResult, setMintResult] = useState<BrokerResult<BrokeredCredential> | null>(null);

  const [prompt, setPrompt] = useState('Reply with exactly: broker gateway OK');
  const [proxyModel, setProxyModel] = useState('claude-haiku-4-5-20251001');
  const [proxyBusy, setProxyBusy] = useState(false);
  const [proxyOut, setProxyOut] = useState<string | null>(null);

  // 1s tick for expiry countdowns.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const doMint = async (forceFresh: boolean) => {
    if (!tier) return;
    setMinting(true);
    setMintResult(null);
    try {
      const ttlNum = Number.parseInt(ttl, 10);
      const result = await mint(audience.trim(), tier, {
        ...(Number.isFinite(ttlNum) && ttlNum > 0 ? { ttlSeconds: ttlNum } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(forceFresh ? { forceFresh: true } : {}),
      });
      setMintResult(result);
    } finally {
      setMinting(false);
    }
  };

  const doProxied = async () => {
    if (!tier) return;
    setProxyBusy(true);
    setProxyOut(null);
    try {
      const result = await proxiedJson({
        audience: 'anthropic',
        tierPolicy: tier,
        model: proxyModel.trim(),
        body: {
          model: proxyModel.trim(),
          max_tokens: 64,
          messages: [{ role: 'user', content: prompt }],
        },
      });
      setProxyOut(JSON.stringify(result, null, 2));
    } finally {
      setProxyBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-cyan-600 dark:text-cyan-400" />
        <span className="font-semibold">Token Broker</span>
        <span className="text-xs text-muted-foreground">
          scoped short-lived credentials — src/lib/broker
        </span>
      </div>

      {/* ── Mint ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Mint a credential</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Audience</Label>
              <Input
                list="broker-audiences"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="anthropic"
              />
              <datalist id="broker-audiences">
                {KNOWN_AUDIENCES.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">
                Tier policy <span className="text-red-500">(required, no default)</span>
              </Label>
              <Select value={tier} onValueChange={(v) => setTier(v as TierPolicy)}>
                <SelectTrigger>
                  <SelectValue placeholder="choose explicitly…" />
                </SelectTrigger>
                <SelectContent>
                  {TIER_POLICIES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">TTL seconds (optional)</Label>
              <Input value={ttl} onChange={(e) => setTtl(e.target.value)} placeholder="600" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Model (native audiences)</Label>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gpt-realtime"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!tier || !audience.trim() || minting}
              onClick={() => void doMint(false)}
            >
              {minting ? 'Minting…' : 'Mint (cached)'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!tier || !audience.trim() || minting}
              onClick={() => void doMint(true)}
            >
              Force fresh
            </Button>
          </div>
          {mintResult &&
            (mintResult.ok ? (
              <div className="rounded border border-emerald-300 bg-emerald-50 p-2 text-xs dark:border-emerald-800 dark:bg-emerald-950">
                <div className="flex flex-wrap items-center gap-1.5 pb-1">
                  <Badge variant="outline">{mintResult.data.credential_mode}</Badge>
                  <Badge variant="outline">{mintResult.data.protocol}</Badge>
                  <Badge variant="outline">tier: {mintResult.data.grant.tier_policy}</Badge>
                  {mintResult.data.model && (
                    <Badge variant="outline">{mintResult.data.model}</Badge>
                  )}
                  <Badge variant="outline">
                    expires in {fmtCountdown(mintResult.data.expires_at, now)}
                  </Badge>
                </div>
                <div className="break-all">
                  endpoint: <code>{mintResult.data.endpoint}</code>
                </div>
                <div>
                  token: <code>…{mintResult.data.token.slice(-6)}</code> (masked — full token stays
                  in memory)
                </div>
              </div>
            ) : (
              <div className="rounded border border-red-300 bg-red-50 p-2 text-xs dark:border-red-800 dark:bg-red-950">
                <b>Mint failed ({mintResult.status})</b>: {mintResult.error}
                {mintResult.status === 503 && (
                  <div className="pt-1">
                    Broker not configured on this server (signing key / public_url missing). This is
                    a deploy problem — do not retry.
                  </div>
                )}
              </div>
            ))}
        </CardContent>
      </Card>

      {/* ── Cache ────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm">SW credential cache (token-free view)</CardTitle>
          <Button size="sm" variant="ghost" onClick={() => void refreshSnapshot()}>
            <RefreshCw className="size-3.5" />
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {snapshot.length === 0 && (
            <div className="text-xs text-muted-foreground">Cache is empty.</div>
          )}
          {snapshot.map((e) => (
            <div
              key={e.cacheKey}
              className="flex items-center justify-between gap-2 rounded border p-1.5 text-xs"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1">
                  <b>{e.audience}</b>
                  <Badge variant="outline">{e.credentialMode}</Badge>
                  <Badge variant="outline">tier: {e.tierPolicy}</Badge>
                  {e.model && <Badge variant="outline">{e.model}</Badge>}
                  <span className="text-muted-foreground">…{e.tokenTail}</span>
                </div>
                <div className="truncate text-muted-foreground">{e.endpoint}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span
                  className={
                    e.expiresAt * 1000 - now < 60_000 ? 'text-amber-600' : 'text-muted-foreground'
                  }
                >
                  {fmtCountdown(e.expiresAt, now)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  title="Invalidate"
                  onClick={() => void invalidate(e.audience, e.tierPolicy, e.model ?? undefined)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Proxied round-trip ───────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Proxied test — Anthropic via gateway (runs in SW)
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Model (rewritten server-side per tier policy)</Label>
            <Input value={proxyModel} onChange={(e) => setProxyModel(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Prompt</Label>
            <Textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </div>
          <Button size="sm" disabled={!tier || proxyBusy} onClick={() => void doProxied()}>
            {proxyBusy
              ? 'Calling…'
              : tier
                ? `Send via gateway (tier: ${tier})`
                : 'Pick a tier policy above first'}
          </Button>
          {proxyOut && (
            <pre className="max-h-64 overflow-auto rounded border bg-muted p-2 text-[11px] leading-tight">
              {proxyOut}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
