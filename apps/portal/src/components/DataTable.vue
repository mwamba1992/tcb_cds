<script setup lang="ts" generic="Row extends Record<string, unknown>">
import { computed, ref, watch } from 'vue';

/**
 * The one table for the back office.
 *
 * Every staff list has the same parts in the same places: search and filters above,
 * sortable headers, a loading line, an empty state, an error line, and a footer with
 * "Showing 26–50 of 312", page size and page numbers. Pages come from the server's
 * `{ items, total, page, pageSize }` (see useTable); a small local list can pass its
 * rows without `total` and gets no footer.
 */
export interface Column {
  key: string;
  label: string;
  /** Server sort field; the header becomes a sort button. */
  sort?: string;
  align?: 'right';
  nowrap?: boolean;
  /** Screen-reader-only header, e.g. for an actions column. */
  hiddenLabel?: boolean;
}

const props = withDefaults(
  defineProps<{
    columns: Column[];
    rows: Row[];
    rowKey: keyof Row & string;
    total?: number;
    page?: number;
    pageSize?: number;
    sort?: string;
    q?: string;
    searchPlaceholder?: string;
    loading?: boolean;
    error?: string | null;
    empty?: string;
    clickable?: boolean;
  }>(),
  {
    total: undefined,
    page: 1,
    pageSize: 25,
    sort: undefined,
    q: undefined,
    searchPlaceholder: undefined,
    loading: false,
    error: null,
    empty: 'Nothing to show.',
    clickable: false,
  },
);

const emit = defineEmits<{
  'update:q': [value: string];
  'update:page': [value: number];
  'update:pageSize': [value: number];
  'update:sort': [value: string];
  rowClick: [row: Row];
}>();

const PAGE_SIZES = [25, 50, 100];

// Search is typed freely and sent after a pause, not on every key.
const typed = ref(props.q ?? '');
watch(
  () => props.q,
  (value) => {
    if ((value ?? '') !== typed.value) typed.value = value ?? '';
  },
);
let timer: ReturnType<typeof setTimeout> | null = null;
function onSearch(value: string) {
  typed.value = value;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => emit('update:q', value.trim()), 300);
}

const paged = computed(() => props.total !== undefined);
const pages = computed(() => Math.max(1, Math.ceil((props.total ?? 0) / props.pageSize)));
const from = computed(() => (props.total ? (props.page - 1) * props.pageSize + 1 : 0));
const to = computed(() => Math.min(props.page * props.pageSize, props.total ?? 0));

/** 1 … 4 5 [6] 7 8 … 20 */
const pageList = computed<(number | '…')[]>(() => {
  const n = pages.value;
  const p = props.page;
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
  const list: (number | '…')[] = [1];
  const start = Math.max(2, p - 1);
  const end = Math.min(n - 1, p + 1);
  if (start > 2) list.push('…');
  for (let i = start; i <= end; i += 1) list.push(i);
  if (end < n - 1) list.push('…');
  list.push(n);
  return list;
});

const [sortField, sortDir] = [
  computed(() => props.sort?.split(':')[0]),
  computed(() => props.sort?.split(':')[1] as 'asc' | 'desc' | undefined),
];
function toggleSort(column: Column) {
  if (!column.sort) return;
  const next = sortField.value === column.sort && sortDir.value === 'desc' ? 'asc' : 'desc';
  emit('update:sort', `${column.sort}:${next}`);
}
function ariaSort(column: Column) {
  if (!column.sort || sortField.value !== column.sort) return undefined;
  return sortDir.value === 'asc' ? 'ascending' : 'descending';
}

function cell(row: Row, key: string): string {
  const value = row[key];
  return value === null || value === undefined || value === '' ? '—' : String(value);
}
</script>

<template>
  <div class="dt">
    <div v-if="searchPlaceholder !== undefined || $slots.filters || $slots.actions" class="dt-bar">
      <input
        v-if="searchPlaceholder !== undefined"
        :value="typed"
        type="search"
        class="input input--text dt-search"
        :placeholder="searchPlaceholder"
        :aria-label="searchPlaceholder"
        @input="onSearch(($event.target as HTMLInputElement).value)"
      />
      <div v-if="$slots.filters" class="dt-filters"><slot name="filters" /></div>
      <div v-if="$slots.actions" class="dt-actions"><slot name="actions" /></div>
    </div>

    <p v-if="error" class="notice notice--error dt-notice" role="alert">{{ error }}</p>

    <div class="scroll-x dt-scroll" :class="{ 'dt-scroll--loading': loading }" :aria-busy="loading">
      <table class="table">
        <thead>
          <tr>
            <th
              v-for="c in columns"
              :key="c.key"
              :class="{ right: c.align === 'right' }"
              :aria-sort="ariaSort(c)"
              scope="col"
            >
              <span v-if="c.hiddenLabel" class="visually-hidden">{{ c.label }}</span>
              <button v-else-if="c.sort" type="button" class="dt-sort" @click="toggleSort(c)">
                {{ c.label }}
                <span class="dt-arrow" :class="{ 'dt-arrow--on': sortField === c.sort }" aria-hidden="true">{{
                  sortField === c.sort && sortDir === 'asc' ? '▲' : '▼'
                }}</span>
              </button>
              <template v-else>{{ c.label }}</template>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="String(row[rowKey])"
            :class="{ 'dt-row--click': clickable }"
            :tabindex="clickable ? 0 : undefined"
            @click="clickable && emit('rowClick', row)"
            @keydown.enter="clickable && emit('rowClick', row)"
          >
            <td v-for="c in columns" :key="c.key" :class="{ right: c.align === 'right', nowrap: c.nowrap }">
              <slot :name="`cell-${c.key}`" :row="row">{{ cell(row, c.key) }}</slot>
            </td>
          </tr>
          <tr v-if="!loading && rows.length === 0">
            <td :colspan="columns.length" class="dt-empty">{{ empty }}</td>
          </tr>
          <tr v-if="loading && rows.length === 0">
            <td :colspan="columns.length" class="dt-empty" role="status">Loading…</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer v-if="paged && (total ?? 0) > 0" class="dt-foot">
      <span class="dt-count">
        Showing <strong>{{ from }}–{{ to }}</strong> of <strong>{{ total?.toLocaleString('en-US') }}</strong>
      </span>
      <label class="dt-size">
        Rows
        <select :value="pageSize" class="dt-select" @change="emit('update:pageSize', Number(($event.target as HTMLSelectElement).value))">
          <option v-for="s in PAGE_SIZES" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>
      <nav class="dt-pages" aria-label="Pages">
        <button type="button" class="dt-page" :disabled="page <= 1" @click="emit('update:page', page - 1)">‹ Prev</button>
        <template v-for="(p, i) in pageList" :key="`${p}-${i}`">
          <span v-if="p === '…'" class="dt-gap">…</span>
          <button
            v-else
            type="button"
            class="dt-page"
            :class="{ 'dt-page--on': p === page }"
            :aria-current="p === page ? 'page' : undefined"
            @click="emit('update:page', p)"
          >
            {{ p }}
          </button>
        </template>
        <button type="button" class="dt-page" :disabled="page >= pages" @click="emit('update:page', page + 1)">Next ›</button>
      </nav>
    </footer>
  </div>
</template>

<style scoped>
.dt-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.dt-search {
  flex: 1 1 260px;
  max-width: 420px;
  font-size: 14px;
  padding: 8px 12px;
}
.dt-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.dt-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.dt-notice {
  margin: 12px 20px 0;
}
.dt-scroll {
  transition: opacity 0.15s;
}
.dt-scroll--loading {
  opacity: 0.55;
}
.dt-sort {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  text-transform: inherit;
  letter-spacing: inherit;
}
.dt-arrow {
  font-size: 9px;
  opacity: 0.3;
}
.dt-arrow--on {
  opacity: 1;
}
.dt-row--click {
  cursor: pointer;
}
.dt-row--click:focus-visible {
  outline: 2px solid var(--navy);
  outline-offset: -2px;
}
.dt-empty {
  text-align: center;
  color: var(--muted);
  padding: 32px 16px;
}
.dt-foot {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  font-size: 13px;
  color: var(--muted);
}
.dt-count strong {
  color: var(--ink);
  font-weight: 600;
}
.dt-size {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dt-select {
  border: 1px solid var(--control-border);
  border-radius: var(--radius-control);
  padding: 3px 6px;
  font: inherit;
  color: var(--ink);
  background: #fff;
}
.dt-pages {
  margin-left: auto;
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
}
.dt-page {
  min-width: 32px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: #fff;
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}
.dt-page:hover:not(:disabled) {
  border-color: var(--navy);
}
.dt-page:disabled {
  color: var(--disabled);
  cursor: not-allowed;
}
.dt-page--on {
  background: var(--navy);
  border-color: var(--navy);
  color: #fff;
  font-weight: 600;
}
.dt-gap {
  padding: 0 4px;
}
@media (max-width: 700px) {
  .dt-pages {
    margin-left: 0;
  }
}
</style>
