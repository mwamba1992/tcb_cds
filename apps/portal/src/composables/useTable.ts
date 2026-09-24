import { computed, reactive, ref, shallowRef, watch } from 'vue';
import { AccountError } from '../api/live/http';

export interface TablePage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TableParams {
  page: number;
  pageSize: number;
  q: string;
  sort: string;
  filters: Record<string, string>;
}

/**
 * State and loading for one server-paged DataTable.
 *
 *   const table = useTable(params => api.customers(params), { sort: 'registered:desc', filters: { status: '' } });
 *   <DataTable v-bind="table.bind" … />
 *
 * Changing the search, a filter, the sort or the page size goes back to page 1; a
 * response that arrives after a newer request was sent is dropped, so fast typing
 * never leaves an older result on screen.
 */
export function useTable<T>(
  fetch: (params: TableParams) => Promise<TablePage<T>>,
  initial: { sort?: string; pageSize?: number; filters?: Record<string, string> } = {},
) {
  const page = ref(1);
  const pageSize = ref(initial.pageSize ?? 25);
  const q = ref('');
  const sort = ref(initial.sort ?? '');
  const filters = reactive<Record<string, string>>({ ...(initial.filters ?? {}) });
  const rows = shallowRef<T[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let latest = 0;

  async function load() {
    const ticket = ++latest;
    loading.value = true;
    error.value = null;
    try {
      const result = await fetch({ page: page.value, pageSize: pageSize.value, q: q.value, sort: sort.value, filters: { ...filters } });
      if (ticket !== latest) return;
      rows.value = result.items;
      total.value = result.total;
      // The list shrank under us (someone acted on the last row of the last page).
      if (result.items.length === 0 && page.value > 1 && result.total > 0) {
        page.value = Math.ceil(result.total / pageSize.value);
      }
    } catch (caught) {
      if (ticket !== latest) return;
      error.value =
        caught instanceof AccountError ? caught.message : 'Could not load this list. Try again in a moment.';
    } finally {
      if (ticket === latest) loading.value = false;
    }
  }

  watch([q, sort, pageSize, () => ({ ...filters })], () => {
    if (page.value !== 1) page.value = 1;
    else void load();
  }, { deep: true });
  watch(page, () => void load());
  void load();

  const bind = computed(() => ({
    rows: rows.value as unknown as Record<string, unknown>[],
    total: total.value,
    page: page.value,
    pageSize: pageSize.value,
    sort: sort.value,
    q: q.value,
    loading: loading.value,
    error: error.value,
    'onUpdate:page': (v: number) => (page.value = v),
    'onUpdate:pageSize': (v: number) => (pageSize.value = v),
    'onUpdate:sort': (v: string) => (sort.value = v),
    'onUpdate:q': (v: string) => (q.value = v),
  }));

  return { page, pageSize, q, sort, filters, rows, total, loading, error, reload: load, bind };
}

/** Query string for a table request; empty values are left out. */
export function tableQuery(params: TableParams): string {
  const search = new URLSearchParams();
  search.set('page', String(params.page));
  search.set('pageSize', String(params.pageSize));
  if (params.q) search.set('q', params.q);
  if (params.sort) search.set('sort', params.sort);
  for (const [k, v] of Object.entries(params.filters)) if (v) search.set(k, v);
  return search.toString();
}

/**
 * The same DataTable binding for a list already in memory: search, sort and pages are
 * done here instead of by the server, so a local list looks and behaves exactly like
 * a server one.
 */
export function useLocalTable<T>(
  source: () => readonly T[],
  options: {
    search?: (row: T, q: string) => boolean;
    sorters?: Record<string, (row: T) => string | number>;
    sort?: string;
    pageSize?: number;
    loading?: () => boolean;
  } = {},
) {
  const page = ref(1);
  const pageSize = ref(options.pageSize ?? 25);
  const q = ref('');
  const sort = ref(options.sort ?? '');

  const filtered = computed(() => {
    const needle = q.value.toLowerCase();
    let rows = [...source()];
    if (needle && options.search) rows = rows.filter((row) => options.search?.(row, needle));
    const [field, dir] = sort.value.split(':');
    const key = field ? options.sorters?.[field] : undefined;
    if (key) {
      rows.sort((a, b) => {
        const x = key(a);
        const y = key(b);
        return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'asc' ? 1 : -1);
      });
    }
    return rows;
  });
  watch([q, sort, pageSize], () => (page.value = 1));
  watch(
    () => filtered.value.length,
    (n) => {
      const last = Math.max(1, Math.ceil(n / pageSize.value));
      if (page.value > last) page.value = last;
    },
  );

  const bind = computed(() => ({
    rows: filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value) as unknown as Record<
      string,
      unknown
    >[],
    total: filtered.value.length,
    page: page.value,
    pageSize: pageSize.value,
    sort: sort.value,
    q: q.value,
    loading: options.loading?.() ?? false,
    'onUpdate:page': (v: number) => (page.value = v),
    'onUpdate:pageSize': (v: number) => (pageSize.value = v),
    'onUpdate:sort': (v: string) => (sort.value = v),
    'onUpdate:q': (v: string) => (q.value = v),
  }));

  return { page, pageSize, q, sort, bind };
}
