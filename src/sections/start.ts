import { hex } from '../classfile/describe';
import type { ClassFile } from '../classfile/types';
import copyText from '../copy/start.md?raw';
import { loadCopy } from '../ui/copy';
import { h, reducedMotion } from '../ui/dom';
import { onceVisible } from '../ui/reveal';
import { tokenize } from './source';

const copy = loadCopy(copyText, 'start');

const PREVIEW_ROWS = 4;

export function mountStart(root: HTMLElement, cf: ClassFile, source: string): void {
  const lines = source.replace(/\n$/, '').split('\n');
  const size = cf.bytes.length;
  const repeated = lines.flatMap((text, i) => (text.includes('System.out.println(') ? [i + 1] : []));

  const code = h(
    'pre',
    { class: 'code start-code', 'aria-label': 'Greeter.java' },
    lines.map((text, i) => {
      const classes = tokenize(text);
      const tx = h('span', { class: 'tx' });
      let k = 0;
      while (k < text.length) {
        let e = k;
        while (e < text.length && classes[e] === classes[k]) e++;
        tx.append(h('span', { class: classes[k] }, text.slice(k, e)));
        k = e;
      }
      return h('span', { class: 'code-line' }, h('span', { class: 'ln' }, String(i + 1)), tx);
    }),
  );

  const step = (delay: number, ...children: (Node | string)[]) =>
    h('span', { class: 'tline', style: `--d:${delay}ms` }, ...children);
  const prompt = () => h('span', { class: 'prompt' }, '$ ');

  const rows: HTMLElement[] = [];
  for (let r = 0; r < PREVIEW_ROWS; r++) {
    const offset = r * 16;
    const cells: HTMLElement[] = [];
    for (let b = offset; b < Math.min(size, offset + 16); b++) {
      cells.push(h('span', { class: `hb${b < 4 ? ' magic' : ''}`, style: `--d:${1900 + b * 18}ms` }, hex(cf.bytes[b])));
    }
    rows.push(h('div', { class: 'hrow' }, h('span', { class: 'hoff' }, hex(offset, 4)), h('span', { class: 'hbytes' }, cells)));
  }

  const terminal = h(
    'pre',
    { class: 'term' },
    step(0, prompt(), 'javac --release 21 Greeter.java'),
    step(500, prompt(), 'wc -c Greeter.class'),
    step(800, h('span', { class: 'out' }, `${size} Greeter.class`)),
    step(1200, prompt(), 'java Greeter'),
    step(1500, h('span', { class: 'out' }, 'Hello, JVM!')),
    step(1600, h('span', { class: 'out' }, 'Hello, JVM!')),
  );

  const dump = h(
    'div',
    { class: 'start-dump' },
    h('p', { class: 'panel-title' }, `Greeter.class の先頭 ${PREVIEW_ROWS * 16} バイト`, h('span', { class: 'aside mono' }, `全 ${size.toLocaleString('en-US')} バイト`)),
    h('div', { class: 'hexdump' }, rows),
    h(
      'p',
      { class: 'start-note' },
      copy.body('dump-note'),
    ),
  );

  const card = h(
    'div',
    { class: 'card start' },
    h(
      'div',
      { class: 'panel start-source' },
      h('h3', { class: 'panel-title' }, 'Greeter.java', h('span', { class: 'aside' }, `${lines.length} 行`)),
      code,
      repeated.length === 2
        ? h(
            'p',
            { class: 'start-code-note' },
            copy.body('repeat-note', { first: repeated[0], second: repeated[1] }),
          )
        : null,
    ),
    h('div', { class: 'start-right' }, h('div', { class: 'panel' }, h('h3', { class: 'panel-title' }, 'ターミナル'), terminal), h('div', { class: 'panel' }, dump)),
  );
  root.append(card);

  if (reducedMotion()) card.classList.add('play');
  else onceVisible(card, () => card.classList.add('play'), '0px 0px -15% 0px');
}
