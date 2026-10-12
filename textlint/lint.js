import { writeFile } from 'node:fs/promises';
import { TextlintKernelDescriptor } from '@textlint/kernel';
import { createLinter, loadFixerFormatter, loadLinterFormatter, loadTextlintrc } from 'textlint';
import templateHoles from './filters/template-holes.js';
import htmlProse from './plugins/html-prose.js';
import tsStrings from './plugins/ts-strings.js';
import noPunctuationInHeadings from './rules/no-punctuation-in-headings.js';

// ローカルのプラグインとルールは .textlintrc からは読めないので、ここで登録して CLI の代わりにする。
// "html" は .textlintrc の textlint-plugin-html を、整形用の空白を落とす版で置き換える。
const FILES = ['index.html', 'src/**/*.ts'];

const args = process.argv.slice(2);
const fix = args.includes('--fix');
const files = args.filter((a) => !a.startsWith('--'));

const local = new TextlintKernelDescriptor({
  rules: [{ ruleId: 'no-punctuation-in-headings', rule: noPunctuationInHeadings }],
  filterRules: [{ ruleId: 'template-holes', rule: templateHoles }],
  plugins: [
    { pluginId: 'html', plugin: htmlProse },
    { pluginId: 'ts-strings', plugin: tsStrings },
  ],
});
const descriptor = local.concat(await loadTextlintrc());
const linter = createLinter({ descriptor });
const targets = files.length ? files : FILES;

if (fix) {
  // fixFiles は修正後の文字列を返すだけなので、ファイルへの書き戻しはここで行う
  const results = await linter.fixFiles(targets);
  for (const r of results) if (r.output !== undefined && r.applyingMessages.length) await writeFile(r.filePath, r.output);
  const formatter = await loadFixerFormatter({ formatterName: 'stylish' });
  console.log(formatter.format(results));
} else {
  const results = await linter.lintFiles(targets);
  const formatter = await loadLinterFormatter({ formatterName: 'stylish' });
  const output = formatter.format(results);
  if (output.trim()) console.log(output);
  const errors = results.reduce((n, r) => n + r.messages.filter((m) => m.severity === 2).length, 0);
  if (errors) process.exitCode = 1;
  else console.log(`textlint: ${results.length} files, no problems`);
}
