import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BUCKET_LABELS,
  type BucketKey,
  CATEGORY_LABELS,
  type QueueFacets,
  STATUS_LABELS,
  type SortSpec,
  hasActiveFilters,
} from '@/features/tasks/queue-view';
import { cn } from '@/lib/utils';
import { useScrapeQueueView } from '@/state/scrape-queue-view';
import { Check, FolderTree, LayoutList, Search, SlidersHorizontal, X } from 'lucide-react';

const ALL = '__all__';

const SORT_OPTIONS: { value: string; label: string; sort: SortSpec }[] = [
  { value: 'topic:asc', label: 'Project A–Z', sort: { key: 'topic', dir: 'asc' } },
  { value: 'topic:desc', label: 'Project Z–A', sort: { key: 'topic', dir: 'desc' } },
  { value: 'domain:asc', label: 'Domain A–Z', sort: { key: 'domain', dir: 'asc' } },
  { value: 'recency:desc', label: 'Recently tried', sort: { key: 'recency', dir: 'desc' } },
  { value: 'recency:asc', label: 'Least recently tried', sort: { key: 'recency', dir: 'asc' } },
  { value: 'chars:desc', label: 'Most chars', sort: { key: 'chars', dir: 'desc' } },
  { value: 'chars:asc', label: 'Fewest chars', sort: { key: 'chars', dir: 'asc' } },
  { value: 'attempts:desc', label: 'Most attempts', sort: { key: 'attempts', dir: 'desc' } },
  { value: 'status:asc', label: 'Status', sort: { key: 'status', dir: 'asc' } },
];

export function QueueToolbar({
  facets,
  filteredCount,
  totalCount,
}: {
  facets: QueueFacets;
  filteredCount: number;
  totalCount: number;
}) {
  const {
    filters,
    sort,
    groupMode,
    setSearch,
    setTopicId,
    setDomain,
    toggleStatus,
    toggleCategory,
    toggleBucket,
    setSort,
    setGroupMode,
    clearFilters,
  } = useScrapeQueueView();

  const active = hasActiveFilters(filters);
  // Count of secondary (popover) filters active — shown as a badge on the button.
  const popoverActiveCount =
    filters.statuses.length +
    filters.categories.length +
    filters.buckets.length +
    (filters.domain ? 1 : 0);

  const sortValue = `${sort.key}:${sort.dir}`;

  return (
    <div className="shrink-0 space-y-1.5 border-b border-border/60 px-3 py-2">
      {/* Search + group-by */}
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 size-3.5 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search url, title, project, domain…"
            className="h-7 pl-7 text-xs"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="-translate-y-1/2 absolute top-1/2 right-1.5 text-muted-foreground hover:text-foreground"
              title="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
          <ToggleBtn
            active={groupMode === 'level'}
            onClick={() => setGroupMode('level')}
            title="Group by capture level"
          >
            <LayoutList className="size-3.5" />
          </ToggleBtn>
          <ToggleBtn
            active={groupMode === 'project'}
            onClick={() => setGroupMode('project')}
            title="Group by project"
          >
            <FolderTree className="size-3.5" />
          </ToggleBtn>
        </div>
      </div>

      {/* Project + sort + filters */}
      <div className="flex items-center gap-1.5">
        <Select
          value={filters.topicId ?? ALL}
          onValueChange={(v) => setTopicId(v === ALL ? null : v)}
        >
          <SelectTrigger className="h-7 min-w-0 flex-1 text-xs">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All projects ({totalCount})</SelectItem>
            {facets.topics.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name} ({t.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={sortValue}
          onValueChange={(v) => {
            const opt = SORT_OPTIONS.find((o) => o.value === v);
            if (opt) setSort(opt.sort);
          }}
        >
          <SelectTrigger className="h-7 w-[7.5rem] shrink-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="relative size-7 shrink-0"
              title="Filters"
            >
              <SlidersHorizontal className="size-3.5" />
              {popoverActiveCount > 0 && (
                <span className="-right-1 -top-1 absolute flex size-3.5 items-center justify-center rounded-full bg-primary text-[8px] text-primary-foreground">
                  {popoverActiveCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 space-y-3 p-3">
            <FilterGroup title="Domain">
              <Select
                value={filters.domain ?? ALL}
                onValueChange={(v) => setDomain(v === ALL ? null : v)}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="Any domain" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value={ALL}>Any domain</SelectItem>
                  {facets.domains.map((d) => (
                    <SelectItem key={d.domain} value={d.domain}>
                      {d.domain} ({d.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterGroup>

            {facets.statuses.length > 0 && (
              <FilterGroup title="Status">
                {facets.statuses.map((s) => (
                  <CheckRow
                    key={s.status}
                    checked={filters.statuses.includes(s.status)}
                    onToggle={() => toggleStatus(s.status)}
                    label={STATUS_LABELS[s.status]}
                    count={s.count}
                  />
                ))}
              </FilterGroup>
            )}

            {facets.categories.length > 1 && (
              <FilterGroup title="Category">
                {facets.categories.map((c) => (
                  <CheckRow
                    key={c.category}
                    checked={filters.categories.includes(c.category)}
                    onToggle={() => toggleCategory(c.category)}
                    label={CATEGORY_LABELS[c.category]}
                    count={c.count}
                  />
                ))}
              </FilterGroup>
            )}

            <FilterGroup title="Capture level">
              {(Object.keys(BUCKET_LABELS) as BucketKey[]).map((b) => (
                <CheckRow
                  key={b}
                  checked={filters.buckets.includes(b)}
                  onToggle={() => toggleBucket(b)}
                  label={BUCKET_LABELS[b]}
                />
              ))}
            </FilterGroup>
          </PopoverContent>
        </Popover>

        {active && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground"
            onClick={() => clearFilters()}
            title="Clear all filters"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      {active && (
        <div className="text-[11px] text-muted-foreground">
          {filteredCount} of {totalCount} shown
        </div>
      )}
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'flex size-7 items-center justify-center transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function CheckRow({
  checked,
  onToggle,
  label,
  count,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs transition-colors hover:bg-accent"
    >
      <span
        className={cn(
          'flex size-3.5 shrink-0 items-center justify-center rounded border',
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
        )}
      >
        {checked && <Check className="size-2.5" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && <span className="text-[10px] text-muted-foreground">{count}</span>}
    </button>
  );
}
