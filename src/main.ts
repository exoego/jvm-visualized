import './style.css';
import classUrl from '../samples/Greeter.class?url';
import barNewUrl from '../samples/linkage/classes/bar-v2/bar/Bar.class?url';
import barOldUrl from '../samples/linkage/classes/bar-v1/bar/Bar.class?url';
import fooUrl from '../samples/linkage/classes/foo/foo/Foo.class?url';
import javaSource from '../samples/Greeter.java?raw';
import { hexBytes } from './classfile/describe';
import { ClassFormatError, parseClassFile } from './classfile/parse';
import { mountLinkage } from './sections/linkage';
import { mountPool } from './sections/pool';
import { mountRuntime } from './sections/runtime';
import { mountSource } from './sections/source';
import { mountStart } from './sections/start';
import { mountStructure } from './sections/structure';
import { h, mount } from './ui/dom';
import { initReveal, trackNav } from './ui/reveal';

async function load(url: string) {
  const response = await fetch(url);
  return parseClassFile(new Uint8Array(await response.arrayBuffer()));
}

async function main(): Promise<void> {
  const response = await fetch(classUrl);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const cf = parseClassFile(bytes);
  const size = bytes.length.toLocaleString('en-US');

  document.querySelectorAll('[data-bind="size"]').forEach((el) => (el.textContent = size));
  const lineCount = String(javaSource.replace(/\n$/, '').split('\n').length);
  document.querySelectorAll('[data-bind="lines"]').forEach((el) => (el.textContent = lineCount));

  const dump = mount('dump');
  if (dump) {
    const text = hexBytes(bytes, 0, bytes.length);
    dump.append(h('span', { class: 'magic' }, text.slice(0, 11)), h('span', { class: 'lit' }, text.slice(11, 240)), text.slice(240));
  }

  mount('meta')?.append(
    h('span', { class: 'meta-pill' }, 'Greeter.java'),
    h('span', { class: 'meta-pill' }, 'javac 21 · --release 21'),
  );
  mount('footer-meta')?.append(`javac 21.0.2 --release 21 でコンパイルした ${size} バイト`);

  mountStart(mount('start')!, cf, javaSource);
  mountStructure(mount('structure')!, cf);
  const pool = mountPool(mount('pool')!, cf);
  mountSource(mount('source')!, cf, javaSource, (index) => {
    pool.select(index);
    document.getElementById('pool')?.scrollIntoView({ behavior: 'smooth' });
  });
  mountRuntime(mount('runtime')!, cf);
  const [foo, barOld, barNew] = await Promise.all([load(fooUrl), load(barOldUrl), load(barNewUrl)]);
  mountLinkage(mount('linkage')!, foo, barOld, barNew);

  initReveal();
  trackNav();
}

main().catch((error: unknown) => {
  console.error(error);
  const message =
    error instanceof ClassFormatError
      ? `class ファイルを読めませんでした (${error.offset} バイト目): ${error.message}`
      : `読み込みに失敗しました: ${String(error)}`;
  document.querySelector('main')?.prepend(h('div', { class: 'error' }, message));
});
