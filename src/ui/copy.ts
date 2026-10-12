export type Params = Record<string, string | number>;

export interface Copy {
  title(key: string, params?: Params): string;
  body(key: string, params?: Params): string;
  step(key: string, params?: Params): { title: string; body: string };
}

export interface Entry {
  title?: string;
  body: string;
  line: number;
}

// src/copy/*.md を読む。`<!-- key -->` の行で項目が始まり、直後の `## ` 行がラベル、続く行が本文。
// key をコメントにしているのは、Markdown のプレビューに出さないため。
export function parseCopy(markdown: string): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  let current: Entry | undefined;
  markdown.split('\n').forEach((line, i) => {
    const key = line.match(/^<!--\s*([\w.-]+)\s*-->$/);
    if (key) {
      current = { body: '', line: i + 1 };
      entries.set(key[1], current);
      return;
    }
    if (!current || line.startsWith('<!--')) return;
    if (line.startsWith('## ') && current.title === undefined && !current.body.trim()) {
      current.title = line.slice(3).trim();
      return;
    }
    current.body += `${line}\n`;
  });
  for (const e of entries.values()) e.body = e.body.trim();
  return entries;
}

// {name} は params の値で埋める
export function loadCopy(markdown: string, name: string): Copy {
  const entries = parseCopy(markdown);

  const entry = (key: string): Entry => {
    const found = entries.get(key);
    if (!found) throw new Error(`${name}.md: ${key} がありません`);
    return found;
  };
  const fill = (key: string, text: string, params: Params): string =>
    text.replace(/\{(\w+)\}/g, (_, p: string) => {
      if (!(p in params)) throw new Error(`${name}.md: ${key} の {${p}} に値がありません`);
      return String(params[p]);
    });

  const copy: Copy = {
    title(key, params = {}) {
      const { title } = entry(key);
      if (title === undefined) throw new Error(`${name}.md: ${key} にラベルがありません`);
      return fill(key, title, params);
    },
    body(key, params = {}) {
      return fill(key, entry(key).body, params);
    },
    step(key, params = {}) {
      return { title: copy.title(key, params), body: copy.body(key, params) };
    },
  };
  return copy;
}
