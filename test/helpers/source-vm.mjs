// Execute trusted package source with actual Pi TUI primitives and a synthetic host.
// Not a security sandbox; no model, global settings or live user dialog.
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import * as tui from '@earendil-works/pi-tui';
import { Type } from 'typebox';
export const theme = { fg: (_c, x) => x, bg: (_c, x) => x, bold: x => x, strikethrough: x => x };
export async function loadSource(entry, configEnv) {
  const context = createContext({ console, Intl, AbortController, process: { env: configEnv ?? {} } });
  const cache = new Map();
  const host = {
    'node:fs': configEnv ? { existsSync, readFileSync } : {
      existsSync: () => false,
      readFileSync: () => { throw new Error('No config fixture'); },
    },
    'node:os': { homedir: () => configEnv?.HOME ?? '' },
    'node:path': { isAbsolute, join },
    '@earendil-works/pi-tui': tui,
    'typebox': { Type },
    '@earendil-works/pi-ai': { StringEnum: values => Type.Union(values.map(x => Type.Literal(x))) },
    '@earendil-works/pi-coding-agent': { DynamicBorder: class { render(w) { return ['─'.repeat(w)]; } invalidate() {} } },
  };
  async function get(url) {
    const key = url.href; if (cache.has(key)) return cache.get(key);
    const pending = (async () => {
    const m = new SourceTextModule(stripTypeScriptTypes(await readFile(url, 'utf8')), { context, identifier: key });
    await m.link(async (specifier, ref) => {
      if (specifier.startsWith('.')) return get(new URL(specifier.replace(/\.js$/, '.ts'), ref.identifier));
      const values = host[specifier]; if (!values) throw new Error(`Unexpected fixture import ${specifier}`);
      return new SyntheticModule(Object.keys(values), function () {
        for (const [k,v] of Object.entries(values)) this.setExport(k,v);
      }, { context });
    });
    return m;
    })();
    // Publish the in-flight module before async IO: diamond imports must share one state instance.
    cache.set(key, pending);
    return pending;
  }
  const m = await get(entry); await m.evaluate(); return m.namespace;
}
