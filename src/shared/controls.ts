import './styles/controls.css';

/**
 * Controls placed next to what they change. A page has one `Controls` hub; `ui.group(el)` puts a group of controls into
 * a panel's side column or a toolbar. `refresh()` re-reads the bound values and sends `change` for every value that
 * differs from what is shown, as after a Reset, and `change` bubbles from a binding to its folders, group and the hub.
 */

export interface ChangeEvent<V = unknown> {
  value: V;
}

export interface AxisOptions {
  min: number;
  max: number;
  step?: number;
}

export interface BindingOptions {
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
  /** Labels to values; the values are not checked against the bound type, as in most option tables built at run time. */
  options?: Record<string, unknown>;
  /** For `options`: a select or a row of segments. By default, short lists become segments. */
  view?: 'select' | 'segmented';
  disabled?: boolean;
  x?: AxisOptions;
  y?: AxisOptions;
  z?: AxisOptions;
  /** A small icon button next to a select, e.g. for opening a file. */
  action?: { title: string; onClick: () => void };
}

export type ButtonIcon = 'play' | 'stop' | 'next' | 'reset';

export interface ButtonOptions {
  title: string;
  primary?: boolean;
  icon?: ButtonIcon;
}

export interface FolderOptions {
  title: string;
  /** Given: the folder can be collapsed, and starts open if true. */
  expanded?: boolean;
}

/* Pure helpers */

/** Digits after the decimal point of a step, e.g. 0.05 → 2. */
export function decimalsForStep(step: number | undefined): number {
  if (!step) return 2;
  const s = String(step);
  const e = s.match(/e-(\d+)$/);
  if (e) return Number(e[1]);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Clamps to [min, max] and rounds to the grid min + k·step, without floating-point residue. */
export function snap(value: number, min: number, max: number, step?: number): number {
  let v = Math.min(max, Math.max(min, value));
  if (step) {
    v = min + Math.round((v - min) / step) * step;
    v = Math.min(max, Number(v.toFixed(decimalsForStep(step))));
  }
  return v;
}

export function formatNumber(value: number, step?: number): string {
  return value.toFixed(decimalsForStep(step)).replace('-', '−');
}

/** Reads a typed number; accepts the minus sign and a decimal comma. */
export function parseNumber(text: string): number | null {
  const v = Number(text.trim().replace(/^[−–]/, '-').replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(v) ? v : null;
}

/** Short option lists fit side by side as segments. */
export function prefersSegments(labels: string[]): boolean {
  return labels.length >= 2 && labels.length <= 4 && labels.join('').length <= 16;
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.is((a as never)[k], (b as never)[k]));
}

const copy = <V>(v: V): V => (typeof v === 'object' && v !== null ? ({ ...v } as V) : v);

/* DOM */

let nextId = 0;
const uid = () => `ctl-${++nextId}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

const svg = (body: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${body}</svg>`;
const BUTTON_ICONS: Record<ButtonIcon, string> = {
  play: svg('<path fill="currentColor" d="M4.5 2.6v10.8a.6.6 0 0 0 .9.5l8.6-5.4a.6.6 0 0 0 0-1L5.4 2.1a.6.6 0 0 0-.9.5Z"/>'),
  stop: svg('<rect fill="currentColor" x="3.5" y="3.5" width="9" height="9" rx="1.2"/>'),
  next: svg('<path fill="currentColor" d="M3 3.1v9.8a.55.55 0 0 0 .85.46l7.3-4.9a.55.55 0 0 0 0-.92l-7.3-4.9A.55.55 0 0 0 3 3.1Z"/><rect fill="currentColor" x="11.5" y="3" width="1.8" height="10" rx=".6"/>'),
  reset: svg('<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M2.8 8a5.2 5.2 0 1 0 1.6-3.75M2.8 2.6v3h3"/>'),
};

const OPEN_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10"/></svg>';

/** A slider with an editable number next to its label. */
class Slider {
  readonly element = el('div', 'ctl ctl-slider');
  private readonly range = el('input', 'ctl-range');
  private readonly field = el('input', 'ctl-number');
  private value = 0;

  constructor(
    label: string,
    private readonly opts: { min: number; max: number; step?: number; format?: (v: number) => string },
    private readonly commit: (v: number) => void,
  ) {
    const id = uid();
    const name = el('label', 'ctl-label', label);
    name.htmlFor = id;
    this.range.type = 'range';
    this.range.id = id;
    this.range.min = String(opts.min);
    this.range.max = String(opts.max);
    this.range.step = opts.step ? String(opts.step) : 'any';
    this.field.type = 'text';
    this.field.inputMode = 'decimal';
    this.field.spellcheck = false;
    this.field.setAttribute('aria-label', label);
    this.element.append(name, this.field, this.range);

    this.range.addEventListener('input', () => this.set(this.snap(Number(this.range.value)), true));
    const fromField = () => {
      const v = parseNumber(this.field.value);
      if (v === null) this.show();
      else this.set(this.snap(v), true);
    };
    this.field.addEventListener('change', fromField);
    this.field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') fromField();
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const step = (opts.step ?? (opts.max - opts.min) / 100) * (e.shiftKey ? 10 : 1);
      this.set(this.snap(this.value + (e.key === 'ArrowUp' ? step : -step)), true);
    });
  }

  private snap(v: number): number {
    return snap(v, this.opts.min, this.opts.max, this.opts.step);
  }

  set(v: number, fromUser = false): void {
    if (fromUser && v === this.value) return this.show();
    this.value = v;
    this.show();
    if (fromUser) this.commit(v);
  }

  private show(): void {
    const { min, max } = this.opts;
    this.range.value = String(this.value);
    this.field.value = this.opts.format ? this.opts.format(this.value) : formatNumber(this.value, this.opts.step);
    const t = max > min ? (Math.min(max, Math.max(min, this.value)) - min) / (max - min) : 0;
    this.range.style.setProperty('--fill', `${(t * 100).toFixed(2)}%`);
  }

  set disabled(d: boolean) {
    this.range.disabled = this.field.disabled = d;
    this.element.classList.toggle('is-disabled', d);
  }
}

interface Widget<V> {
  element: HTMLElement;
  show(v: V): void;
  setDisabled(d: boolean): void;
}

function numberWidget(label: string, opts: BindingOptions, commit: (v: number) => void): Widget<number> {
  if (opts.min !== undefined && opts.max !== undefined) {
    const s = new Slider(label, { min: opts.min, max: opts.max, step: opts.step, format: opts.format }, commit);
    return { element: s.element, show: (v) => s.set(v), setDisabled: (d) => (s.disabled = d) };
  }
  const element = el('div', 'ctl ctl-field');
  const id = uid();
  const name = el('label', 'ctl-label', label);
  name.htmlFor = id;
  const field = el('input', 'ctl-number');
  field.id = id;
  field.inputMode = 'decimal';
  let value = 0;
  const show = (v: number) => {
    value = v;
    field.value = opts.format ? opts.format(v) : formatNumber(v, opts.step);
  };
  field.addEventListener('change', () => {
    const v = parseNumber(field.value);
    if (v === null || v === value) return show(value);
    show(v);
    commit(v);
  });
  element.append(name, field);
  return { element, show, setDisabled: (d) => (field.disabled = d) };
}

function toggleWidget(label: string, commit: (v: boolean) => void): Widget<boolean> {
  const element = el('label', 'ctl ctl-toggle');
  const box = el('input');
  box.type = 'checkbox';
  box.setAttribute('role', 'switch');
  element.append(box, el('span', 'ctl-label', label));
  box.addEventListener('change', () => commit(box.checked));
  return {
    element,
    show: (v) => (box.checked = v),
    setDisabled: (d) => {
      box.disabled = d;
      element.classList.toggle('is-disabled', d);
    },
  };
}

function colorWidget(label: string, commit: (v: string) => void): Widget<string> {
  const element = el('div', 'ctl ctl-color');
  const id = uid();
  const name = el('label', 'ctl-label', label);
  name.htmlFor = id;
  const swatch = el('input', 'ctl-swatch');
  swatch.type = 'color';
  swatch.id = id;
  const field = el('input', 'ctl-number ctl-hex');
  field.spellcheck = false;
  field.setAttribute('aria-label', `${label} hex`);
  let value = '';
  const show = (v: string) => {
    value = v;
    swatch.value = v;
    field.value = v;
  };
  const set = (v: string) => {
    if (v.toLowerCase() === value.toLowerCase()) return show(value);
    show(v);
    commit(v);
  };
  swatch.addEventListener('input', () => set(swatch.value));
  field.addEventListener('change', () => {
    const v = field.value.trim().replace(/^#?/, '#');
    if (/^#[0-9a-f]{6}$/i.test(v)) set(v.toLowerCase());
    else show(value);
  });
  element.append(name, field, swatch);
  return {
    element,
    show,
    setDisabled: (d) => (swatch.disabled = field.disabled = d),
  };
}

function choiceWidget<V>(label: string, opts: BindingOptions, commit: (v: V) => void): Widget<V> {
  const entries = Object.entries(opts.options!) as [string, V][];
  const indexOf = (v: V) => entries.findIndex(([, x]) => sameValue(x, v));
  const segmented = (opts.view ?? (prefersSegments(entries.map(([l]) => l)) ? 'segmented' : 'select')) === 'segmented';

  if (segmented) {
    const element = el('div', 'ctl ctl-choice');
    const id = uid();
    const name = el('span', 'ctl-label', label);
    name.id = id;
    const group = el('div', 'ctl-segments');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', id);
    const radios = entries.map(([text, value]) => {
      const seg = el('label', 'ctl-segment');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = id;
      radio.addEventListener('change', () => radio.checked && commit(value));
      seg.append(radio, el('span', '', text));
      group.append(seg);
      return radio;
    });
    element.append(name, group);
    return {
      element,
      show: (v) => radios.forEach((r, i) => (r.checked = i === indexOf(v))),
      setDisabled: (d) => radios.forEach((r) => (r.disabled = d)),
    };
  }

  const element = el('div', 'ctl ctl-choice');
  const id = uid();
  const name = el('label', 'ctl-label', label);
  name.htmlFor = id;
  const row = el('div', 'ctl-select-row');
  const wrap = el('div', 'ctl-select');
  const select = el('select');
  select.id = id;
  entries.forEach(([text], i) => select.append(new Option(text, String(i))));
  select.addEventListener('change', () => commit(entries[Number(select.value)][1]));
  wrap.append(select);
  row.append(wrap);
  if (opts.action) {
    const action = opts.action;
    const button = el('button', 'ctl-icon-button');
    button.type = 'button';
    button.title = action.title;
    button.setAttribute('aria-label', action.title);
    button.innerHTML = OPEN_ICON;
    button.addEventListener('click', action.onClick);
    row.append(button);
  }
  element.append(name, row);
  return {
    element,
    show: (v) => (select.selectedIndex = indexOf(v)),
    setDisabled: (d) => (select.disabled = d),
  };
}

function pointWidget(label: string, opts: BindingOptions, value: Record<string, number>, commit: (v: Record<string, number>) => void): Widget<Record<string, number>> {
  const element = el('fieldset', 'ctl ctl-point');
  element.append(el('legend', 'ctl-label', label));
  let current = { ...value };
  const axes = (['x', 'y', 'z'] as const).filter((a) => a in value);
  const sliders = axes.map((axis) => {
    const range = opts[axis] ?? { min: -10, max: 10 };
    const s = new Slider(axis, range, (v) => {
      current = { ...current, [axis]: v };
      commit(current);
    });
    element.append(s.element);
    return s;
  });
  return {
    element,
    show: (v) => {
      current = { ...v };
      axes.forEach((a, i) => sliders[i].set(v[a]));
    },
    setDisabled: (d) => sliders.forEach((s) => (s.disabled = d)),
  };
}

/* Blades */

type Listener<E> = (e: E) => void;

export class Binding<V> {
  readonly element: HTMLElement;
  private readonly widget: Widget<V>;
  private readonly listeners: Listener<ChangeEvent<V>>[] = [];
  private shown: V;
  private isDisabled = false;

  constructor(
    private readonly parent: Container,
    private readonly obj: Record<string, unknown>,
    private readonly key: string,
    opts: BindingOptions,
  ) {
    const label = opts.label ?? key;
    const value = obj[key] as V;
    const commit = (v: V) => {
      const target = this.obj[this.key];
      if (typeof target === 'object' && target !== null) Object.assign(target, v);
      else this.obj[this.key] = v;
      this.shown = copy(v);
      this.emit(v);
    };
    if (opts.options) this.widget = choiceWidget(label, opts, commit);
    else if (typeof value === 'boolean') this.widget = toggleWidget(label, commit as never) as never;
    else if (typeof value === 'string') this.widget = colorWidget(label, commit as never) as never;
    else if (typeof value === 'number') this.widget = numberWidget(label, opts as never, commit as never) as never;
    else this.widget = pointWidget(label, opts as never, value as never, commit as never) as never;
    this.element = this.widget.element;
    this.shown = copy(value);
    this.widget.show(value);
    this.disabled = opts.disabled ?? false;
  }

  on(_event: 'change', fn: Listener<ChangeEvent<V>>): this {
    this.listeners.push(fn);
    return this;
  }

  private emit(value: V): void {
    const e = { value };
    for (const fn of this.listeners) fn(e);
    this.parent.emit(e);
  }

  /** Shows the bound value again; sends `change` if it differs from what was shown. */
  refresh(): void {
    const value = this.obj[this.key] as V;
    if (sameValue(value, this.shown)) return;
    this.shown = copy(value);
    this.widget.show(value);
    this.emit(value);
  }

  get hidden(): boolean {
    return this.element.hidden === true;
  }
  set hidden(h: boolean) {
    this.element.hidden = h;
  }
  get disabled(): boolean {
    return this.isDisabled;
  }
  set disabled(d: boolean) {
    this.isDisabled = d;
    this.widget.setDisabled(d);
  }
}

export class Button {
  readonly element = el('button', 'ctl-button');
  private readonly iconEl = el('span', 'ctl-button-icon');
  private readonly label = el('span', 'ctl-button-label');

  constructor(opts: ButtonOptions) {
    this.element.type = 'button';
    this.label.textContent = opts.title;
    this.element.append(this.iconEl, this.label);
    if (opts.primary) this.element.classList.add('is-primary');
    this.icon = opts.icon;
  }

  set icon(icon: ButtonIcon | undefined) {
    this.iconEl.innerHTML = icon ? BUTTON_ICONS[icon] : '';
    this.iconEl.hidden = !icon;
  }

  on(_event: 'click', fn: () => void): this {
    this.element.addEventListener('click', () => fn());
    return this;
  }

  get title(): string {
    return this.label.textContent ?? '';
  }
  set title(t: string) {
    this.label.textContent = t;
  }
  get disabled(): boolean {
    return this.element.disabled;
  }
  set disabled(d: boolean) {
    this.element.disabled = d;
  }
  get hidden(): boolean {
    return this.element.hidden === true;
  }
  set hidden(h: boolean) {
    this.element.hidden = h;
  }
}

export class Container {
  private readonly children: { refresh(): void }[] = [];
  private readonly listeners: Listener<ChangeEvent>[] = [];

  constructor(
    private readonly parent: Container | null,
    protected readonly body: HTMLElement | null,
  ) {}

  private place(element: HTMLElement): void {
    if (!this.body) throw new Error('Controls: add controls to a group, not to the hub');
    this.body.append(element);
  }

  addBinding<T extends object, K extends keyof T & string>(obj: T, key: K, opts: BindingOptions = {}): Binding<T[K]> {
    const b = new Binding<T[K]>(this, obj as Record<string, unknown>, key, opts);
    this.children.push(b);
    this.place(b.element);
    return b;
  }

  /** Consecutive buttons share a wrapping row. */
  addButton(opts: ButtonOptions): Button {
    const b = new Button(opts);
    let row = this.body?.lastElementChild;
    if (!row?.classList.contains('ctl-buttons')) {
      row = el('div', 'ctl-buttons');
      this.place(row as HTMLElement);
    }
    row.append(b.element);
    return b;
  }

  /** A "Reset" button set apart from the other controls (at the end of a toolbar). */
  addResetButton(onClick: () => void, title = 'Reset'): Button {
    const b = new Button({ title, icon: 'reset' });
    b.element.classList.add('ctl-reset');
    b.on('click', onClick);
    this.place(b.element);
    return b;
  }

  addFolder(opts: FolderOptions): Folder {
    const f = new Folder(this, opts);
    this.children.push(f);
    this.place(f.element);
    return f;
  }

  on(_event: 'change', fn: Listener<ChangeEvent>): this {
    this.listeners.push(fn);
    return this;
  }

  /** @internal Called by child bindings. */
  emit(e: ChangeEvent): void {
    for (const fn of this.listeners) fn(e);
    this.parent?.emit(e);
  }

  refresh(): void {
    for (const c of this.children) c.refresh();
  }

  /** @internal */
  adopt(child: { refresh(): void }): void {
    this.children.push(child);
  }
}

export class Folder extends Container {
  readonly element: HTMLElement;

  constructor(parent: Container, opts: FolderOptions) {
    const body = el('div', 'ctl-folder-body');
    let element: HTMLElement;
    if (opts.expanded === undefined) {
      element = el('section', 'ctl-folder');
      element.append(el('h4', 'ctl-folder-title', opts.title), body);
    } else {
      const details = el('details', 'ctl-folder is-collapsible');
      details.open = opts.expanded;
      details.append(el('summary', 'ctl-folder-title', opts.title), body);
      element = details;
    }
    super(parent, body);
    this.element = element;
  }

  get hidden(): boolean {
    return this.element.hidden === true;
  }
  set hidden(h: boolean) {
    this.element.hidden = h;
  }
}

/** The controls of one page. */
export class Controls extends Container {
  constructor() {
    super(null, null);
  }

  /** A group of controls inside `container` (a panel's `.panel-controls`, a `.toolbar`, ...). */
  group(container: HTMLElement | string): Container {
    const parent = typeof container === 'string' ? document.getElementById(container) : container;
    if (!parent) throw new Error(`Controls: no element #${container}`);
    const body = el('div', 'ctl-group');
    parent.append(body);
    const g = new Container(this, body);
    this.adopt(g);
    return g;
  }

  /** Controls in the side column of the panel (`.view` or `.values` card) that contains the element `#id`. */
  panel(id: string): Container {
    const body = document.getElementById(id)?.closest('.view, .values')?.querySelector<HTMLElement>(':scope > .view-body');
    if (!body) throw new Error(`Controls: #${id} is not inside a panel with a .view-body`);
    let column = body.querySelector<HTMLElement>(':scope > .panel-controls');
    if (!column) {
      column = el('div', 'panel-controls');
      body.append(column);
    }
    return this.group(column);
  }

  /** Controls for the whole demo, or for the section containing `#within`: a bar above the panels. */
  toolbar(within?: string): Container {
    const scope = within ? document.getElementById(within)?.closest('.workspace') : document.querySelector('.workspace');
    if (!scope) throw new Error('Controls: no .workspace for the toolbar');
    let bar = scope.querySelector<HTMLElement>(':scope > .toolbar');
    if (!bar) {
      bar = el('div', 'toolbar card');
      scope.prepend(bar);
      this.toolbars.push(bar);
    }
    return this.group(bar);
  }

  private readonly toolbars: HTMLElement[] = [];

  /**
   * Marks an animation as running or stopped. While it runs, the toolbar (with Stop) stays at the top of the screen
   * on wide layouts. `reveal` scrolls the panel containing `#reveal` into view below the header and the toolbar, unless
   * it is fully visible already.
   */
  playing(on: boolean, reveal?: string): void {
    for (const bar of this.toolbars) bar.classList.toggle('is-playing', on);
    const panel = reveal ? document.getElementById(reveal)?.closest<HTMLElement>('.view, .values') : null;
    if (!on || !panel) return;
    let top = (document.querySelector<HTMLElement>('.site-header')?.offsetHeight ?? 0) + 12;
    const bar = this.toolbars.find((b) => getComputedStyle(b).position === 'sticky');
    if (bar) top += bar.offsetHeight + 12;
    const rect = panel.getBoundingClientRect();
    if (rect.top >= top && rect.bottom <= window.innerHeight) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: window.scrollY + rect.top - top, behavior: smooth ? 'smooth' : 'auto' });
  }
}
