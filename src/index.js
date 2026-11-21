const LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;

// Index of the closing quote; backslash escapes apply only inside double quotes (dotenv semantics).
const closing = (s, q) => {
  for (let k = 0; k < s.length; k++) {
    if (q === '"' && s[k] === '\\') k++;
    else if (s[k] === q) return k;
  }
  return -1;
};
const unescape = (s) => s.replace(/\\([nrt"\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c);

export function parse(text) {
  const vars = new Map(), duplicates = [], invalid = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(LINE);
    if (!m) { invalid.push(i + 1); continue; }
    let [, key, val] = m;
    const start = i + 1, q = val[0];
    if (q === '"' || q === "'" || q === '`') {
      let body = val.slice(1), end = closing(body, q), j = i;
      while (end < 0 && j + 1 < lines.length) { body += '\n' + lines[++j]; end = closing(body, q); }
      if (end < 0) { invalid.push(start); val = val.slice(1); } // unclosed quote: don't swallow the rest of the file
      else { val = body.slice(0, end); i = j; if (q === '"') val = unescape(val); }
    } else val = val.replace(/\s+#.*$/, '').trim();
    if (vars.has(key)) duplicates.push({ key, lines: [vars.get(key).line, start] });
    vars.set(key, { value: val, line: start });
  }
  return { vars, duplicates, invalid };
}

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /github_pat_\w{20,}/, /\bsk-[A-Za-z0-9_-]{20,}/,
  /\b[sr]k_live_\w{10,}/, /\bxox[abprs]-[\w-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY/, /\bAIza[\w-]{35}/,
];
export const looksSecret = (v) => SECRET_PATTERNS.some((re) => re.test(v));
const isTemplate = (name) => /example|sample|template|dist/i.test(name);

// files: [{ name, text }] -> report with keys only; values never leave this function.
export function compare(files, { keysOnly = false } = {}) {
  const parsed = files.map((f) => ({ name: f.name, ...parse(f.text) }));
  const all = [...new Set(parsed.flatMap((p) => [...p.vars.keys()]))].sort();
  const missing = parsed.map((p) => ({ file: p.name, keys: all.filter((k) => !p.vars.has(k)) }));
  const different = keysOnly ? [] : all.filter((k) => {
    const vals = parsed.filter((p) => p.vars.has(k)).map((p) => p.vars.get(k).value);
    return vals.length > 1 && new Set(vals).size > 1;
  });
  const warnings = [], leaks = [];
  for (const p of parsed) {
    for (const d of p.duplicates) warnings.push({ file: p.name, key: d.key, type: 'duplicate', lines: d.lines });
    for (const line of p.invalid) warnings.push({ file: p.name, type: 'invalid-line', lines: [line] });
    for (const [key, { value, line }] of p.vars) {
      if (value === '' && !isTemplate(p.name)) warnings.push({ file: p.name, key, type: 'empty', lines: [line] });
      if (isTemplate(p.name) && looksSecret(value)) leaks.push({ file: p.name, key, type: 'secret-in-template', lines: [line] });
    }
  }
  const ok = missing.every((m) => !m.keys.length) && !different.length && !leaks.length;
  return { files: parsed.map((p) => p.name), missing, different, warnings, leaks, ok };
}
