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
  /\bglpat-[\w-]{20,}/, /\bnpm_[A-Za-z0-9]{36}\b/, /AccountKey=[A-Za-z0-9+/]{80,}={0,2}/,
  /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/,
];
export const looksSecret = (v) => SECRET_PATTERNS.some((re) => re.test(v));
const isTemplate = (name) => /example|sample|template|dist/i.test(name);

// files: [{ name, text }] -> report with keys only; values never leave this function.
// Glob patterns (only * is special) -> anchored regexes.
const toRegex = (glob) => new RegExp('^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

const distance = (a, b) => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};

// git: { tracked: [file names committed to git], unignored: [file names not covered by .gitignore] }
export function compare(files, { keysOnly = false, ignore = [], strict = false, git = {}, used = null } = {}) {
  const ignored = ignore.map(toRegex);
  const skip = (key) => ignored.some((re) => re.test(key));
  const parsed = files.map((f) => ({ name: f.name, ...parse(f.text) }));
  const all = [...new Set(parsed.flatMap((p) => [...p.vars.keys()]))].filter((k) => !skip(k)).sort();
  const missing = parsed.map((p) => ({ file: p.name, keys: all.filter((k) => !p.vars.has(k)) }));
  // "Did you mean": a missing key that looks like a typo of a key only this file has.
  const suggestions = [];
  for (const [i, m] of missing.entries()) {
    const own = [...parsed[i].vars.keys()].filter((k) => !skip(k) && parsed.some((p, j) => j !== i && !p.vars.has(k)));
    for (const key of m.keys) {
      const similar = own.find((k) => key.length > 3 && distance(key, k) <= (key.length >= 8 ? 2 : 1));
      if (similar) suggestions.push({ file: m.file, missing: key, similar });
    }
  }
  const different = keysOnly ? [] : all.filter((k) => {
    const vals = parsed.filter((p) => p.vars.has(k) && !isTemplate(p.name)).map((p) => p.vars.get(k).value);
    return vals.length > 1 && new Set(vals).size > 1;
  });
  const warnings = [], leaks = [];
  for (const p of parsed) {
    if (!isTemplate(p.name) && git.tracked?.includes(p.name)) leaks.push({ file: p.name, type: 'tracked-by-git' });
    else if (!isTemplate(p.name) && git.unignored?.includes(p.name)) warnings.push({ file: p.name, type: 'not-gitignored' });
    for (const d of p.duplicates) if (!skip(d.key)) warnings.push({ file: p.name, key: d.key, type: 'duplicate', lines: d.lines });
    for (const line of p.invalid) warnings.push({ file: p.name, type: 'invalid-line', lines: [line] });
    // Leak detection deliberately ignores --ignore: a real secret in a template is always reported.
    for (const [key, { value, line }] of p.vars) {
      if (value === '' && !isTemplate(p.name) && !skip(key)) warnings.push({ file: p.name, key, type: 'empty', lines: [line] });
      if (isTemplate(p.name) && looksSecret(value)) leaks.push({ file: p.name, key, type: 'secret-in-template', lines: [line] });
    }
  }
  // Per key, one cell per file: null = missing, otherwise a group number. Same number = same value.
  // Only equality is revealed (already implied by `different`), never the values.
  const table = all.map((key) => {
    const groups = [];
    const cells = parsed.map((p) => {
      if (!p.vars.has(key)) return null;
      if (keysOnly) return 0;
      if (isTemplate(p.name)) return -1; // template: present, value not compared (placeholders)
      const v = p.vars.get(key).value;
      if (!groups.includes(v)) groups.push(v);
      return groups.indexOf(v);
    });
    return { key, cells };
  });
  // used: Map<key, [{file, line}]> from scanCode(). Code needs a key no env file defines -> fail; defined but unused -> warn.
  const undefinedInCode = used ? [...used].filter(([k]) => !skip(k) && !parsed.some((p) => p.vars.has(k))).map(([key, refs]) => ({ key, refs })).sort((a, b) => a.key.localeCompare(b.key)) : [];
  if (used) for (const key of all) if (!used.has(key)) warnings.push({ file: parsed.find((p) => p.vars.has(key)).name, key, type: 'unused' });
  const ok = missing.every((m) => !m.keys.length) && !different.length && !leaks.length && !undefinedInCode.length && !(strict && warnings.length);
  return { files: parsed.map((p) => p.name), missing, suggestions, different, undefinedInCode, warnings, leaks, table, ok };
}
