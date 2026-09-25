import { Pane } from 'tweakpane';
import { initPage } from '../../src/shared/page';
import { perFrame } from '../../src/shared/pixelView';
import { Plot, ticks } from '../../src/shared/plot';
import { eq, fmt } from '../../src/shared/tex';
import { type Term, type Wave, energyFraction, harmonics, partialSum, peak, rmsError, target, term } from './series';
import '../../src/shared/styles/demo.css';

initPage({ title: 'Fourier series', chapterId: 'frequency' });

const MAX_TERMS = 60;

function defaults() {
  return { wave: 'square' as Wave, n: 3, showTerms: true };
}
const state = defaults();

const pane = new Pane({ container: document.getElementById('controls')!, title: 'Fourier series' });
pane.addBinding(state, 'wave', { label: 'target', options: { 'square wave': 'square', sawtooth: 'sawtooth', triangle: 'triangle' } });
pane.addBinding(state, 'n', { label: 'terms n', min: 1, max: MAX_TERMS, step: 1 });
pane.addButton({ title: 'Add term' }).on('click', () => {
  state.n = Math.min(MAX_TERMS, state.n + 1);
  pane.refresh();
});
pane.addButton({ title: 'Remove term' }).on('click', () => {
  state.n = Math.max(1, state.n - 1);
  pane.refresh();
});
pane.addBinding(state, 'showTerms', { label: 'show terms' });
pane.addButton({ title: 'Reset' }).on('click', () => {
  Object.assign(state, defaults());
  pane.refresh();
});

const sumPlot = new Plot(document.getElementById('sum-plot')!, 300);
const coefficientPlot = new Plot(document.getElementById('coefficient-plot')!, 190);
const values = document.getElementById('values')!;

function update(): void {
  const terms = harmonics(state.wave, state.n);
  const newest = terms[terms.length - 1];

  sumPlot.render({ x: [0, 1], y: [-1.5, 1.5] }, (p) => {
    p.grid([0, 0.25, 0.5, 0.75, 1], [-1, -0.5, 0, 0.5, 1], { x: (t) => ['0', 'T/4', 'T/2', '3T/4', 'T'][t * 4] });
    p.line((t) => target(state.wave, t), '--fg-muted', { width: 1.5, alpha: 0.8 });
    if (state.showTerms) for (const tk of terms.slice(0, -1)) p.line((t) => term(tk, t), '--viz-object', { width: 1, alpha: 0.35 });
    p.line((t) => term(newest, t), '--viz-highlight', { width: 1.5 });
    p.line((t) => partialSum(terms, t), '--accent', { width: 2.5 });
  });

  const shown = harmonics(state.wave, Math.min(MAX_TERMS, Math.max(state.n + 6, 10)));
  const kMax = shown[shown.length - 1].k;
  const bMax = Math.max(...shown.map((t) => t.b));
  const bMin = Math.min(0, ...shown.map((t) => t.b));
  const bar = (list: Term[]) => list.map(({ k, b }) => [k, b] as const);
  coefficientPlot.render({ x: [0, kMax + 1], y: [bMin * 1.15 - (bMin < 0 ? 0.05 : 0), bMax * 1.15] }, (p) => {
    p.grid(ticks(0, kMax, 10).filter((k) => k > 0 && Number.isInteger(k)), ticks(bMin, bMax, 4), { y: (v) => fmt(v, 1) });
    p.bars(bar(shown.slice(state.n)), 0.6, '--fg-faint', 0.45);
    p.bars(bar(terms.slice(0, -1)), 0.6, '--accent');
    p.bars(bar([newest]), 0.6, '--viz-highlight');
  });
  renderValues(terms);
}
const schedule = perFrame(update);

const SERIES: Record<Wave, string> = {
  square: 'f(t) = \\frac{4}{\\pi} \\sum_{k = 1, 3, 5, \\dots} \\frac{\\sin(2\\pi k t)}{k}',
  sawtooth: 'f(t) = \\frac{2}{\\pi} \\sum_{k = 1}^{\\infty} (-1)^{k + 1} \\frac{\\sin(2\\pi k t)}{k}',
  triangle: 'f(t) = \\frac{8}{\\pi^2} \\sum_{k = 1, 3, 5, \\dots} (-1)^{\\frac{k - 1}{2}} \\frac{\\sin(2\\pi k t)}{k^2}',
};

function texTerm({ k, b }: Term, first: boolean): string {
  const sign = b < 0 ? '-' : first ? '' : '+';
  return `${sign} ${fmt(Math.abs(b), 3)} \\sin(2\\pi ${k === 1 ? '' : `\\cdot ${k}`} t)`;
}

function renderValues(terms: Term[]): void {
  const { wave, n } = state;
  const newest = terms[terms.length - 1];
  const written =
    terms.length <= 4
      ? terms.map((t, i) => texTerm(t, i === 0)).join(' ')
      : `${terms
          .slice(0, 3)
          .map((t, i) => texTerm(t, i === 0))
          .join(' ')} + \\cdots ${texTerm(newest, false)}`;
  const jump = wave !== 'triangle';
  const max = peak(wave, n);

  values.innerHTML = `
    <div class="value-grid">
      <div class="value-block">
        <h3>Series</h3>
        ${eq(`\\displaystyle ${SERIES[wave]}`)}
        ${eq(`S_{${n}}(t) = ${written}`)}
        ${eq(`\\text{newest term: } k = ${newest.k}, \\quad b_{${newest.k}} = \\htmlClass{result}{${fmt(newest.b, 4)}}`)}
      </div>
      <div class="value-block">
        <h3>Approximation with ${n} term${n > 1 ? 's' : ''}</h3>
        ${eq(
          jump && max > 1
            ? `\\max_t S_{${n}}(t) = ${fmt(max, 3)}, \\quad \\text{overshoot } \\frac{${fmt(max - 1, 3)}}{2} = \\htmlClass{result}{${fmt(50 * (max - 1), 1)}\\,\\%} \\text{ of the jump}`
            : `\\max_t S_{${n}}(t) = ${fmt(max, 3)} \\quad \\text{(${jump ? 'below the maximum 1' : 'no jump, no overshoot'})}`,
        )}
        ${eq(`\\text{RMS error } \\sqrt{\\overline{(f - S_{${n}})^2}} = ${fmt(rmsError(wave, n), 4)}`)}
        ${eq(`\\text{energy } \\frac{\\sum b_k^2 / 2}{\\overline{f^2}} = ${fmt(100 * energyFraction(wave, n), 2)}\\,\\%`)}
      </div>
    </div>`;
}

pane.on('change', schedule);
update();
