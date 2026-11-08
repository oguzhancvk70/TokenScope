// SKILL.md / agent .md başlığından name + description (minimal YAML)
export function parseFrontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m?.[1]) return {};
  const out: Record<string, string> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i] ?? '');
    if (!kv?.[1]) continue;
    let value = (kv[2] ?? '').trim();
    if (value === '|' || value === '>' || value === '|-' || value === '>-') {
      const block: string[] = [];
      while (i + 1 < lines.length && /^(\s+|$)/.test(lines[i + 1] ?? ''))
        block.push((lines[++i] ?? '').trim());
      value = block.join(' ').trim();
    } else if (/^["'].*["']$/.test(value)) {
      value = value.slice(1, -1);
    }
    out[kv[1]] = value;
  }
  return out;
}
