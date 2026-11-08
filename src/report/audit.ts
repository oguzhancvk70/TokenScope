import Table from 'cli-table3';
import pc from 'picocolors';
import { fmtTokens } from '../analyzers/util.js';
import type { Finding, RuleAuditResult, RuleStatus } from '../model/types.js';
import { homeRel } from '../util/redact.js';

const STATUS: Record<RuleStatus, (s: string) => string> = {
  violated: (s) => pc.yellow(s),
  stale: (s) => pc.red(s),
  followed: (s) => pc.green(s),
  untested: (s) => pc.dim(s),
  unclassified: (s) => pc.dim(s),
};

const LABEL: Record<RuleStatus, string> = {
  violated: 'olası ihlal',
  stale: 'bayat',
  followed: 'uyuluyor',
  untested: 'tetiklenmedi',
  unclassified: 'sınıflanamadı',
};

const short = (t: string, n = 50) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export function renderAudit(
  audit: RuleAuditResult[],
  findings: Finding[],
  opts: { all: boolean } = { all: false },
): string {
  if (!audit.length) return 'Talimat dosyası (CLAUDE.md / AGENTS.md) bulunamadı.';
  const count = (s: RuleStatus) => audit.filter((r) => r.status === s).length;
  const files = new Set(audit.map((r) => r.rule.source.path));
  const unclassified = audit.filter((r) => r.status === 'unclassified');
  const out = [
    pc.bold(`Kural uyum denetimi · ${audit.length} satır, ${files.size} dosya`),
    `Denetlenebilir ${audit.length - unclassified.length} · ${pc.yellow(`olası ihlal ${count('violated')}`)} · ${pc.red(`bayat ${count('stale')}`)} · uyuluyor ${count('followed')} · tetiklenmedi ${count('untested')} · sınıflanamadı ${unclassified.length}`,
    '',
  ];
  const isRef = (r: RuleAuditResult) =>
    r.rule.kind === 'path-reference' || r.rule.kind === 'script-reference';
  // güncel referanslar varsayılan olarak tabloyu doldurmasın
  const hidden = opts.all ? [] : audit.filter((r) => r.status === 'followed' && isRef(r));
  const checked = audit.filter((r) => r.status !== 'unclassified' && !hidden.includes(r));
  if (checked.length) {
    const t = new Table({
      head: ['Konum', 'Tip', 'Kural', 'Durum', 'Oturum', 'İhlal', 'Not'].map((h) => pc.bold(h)),
      style: { head: [], border: ['grey'] },
    });
    const order: RuleStatus[] = ['violated', 'stale', 'followed', 'untested'];
    for (const r of [...checked].sort(
      (a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.violations - a.violations,
    )) {
      t.push([
        `${homeRel(r.rule.source.path)}:${r.rule.source.line}`,
        r.rule.kind,
        short(r.rule.text),
        STATUS[r.status](r.status === 'followed' && isRef(r) ? 'güncel' : LABEL[r.status]),
        r.applicableSessions,
        r.violations || '-',
        r.note ?? (r.evidence[0] ? pc.dim(r.evidence[0]) : ''),
      ]);
    }
    out.push(t.toString());
  }
  if (hidden.length)
    out.push(pc.dim(`  +${hidden.length} güncel yol/script referansı (--all-rules)`));
  const extra = findings.filter((f) => ['conflicting-rules', 'dead-rules'].includes(f.ruleId));
  if (extra.length) {
    out.push('', pc.bold('Çelişki, tekrar ve ölü kurallar'));
    for (const f of extra) out.push(`  · ${f.title}`, pc.dim(`    ${f.suggestion}`));
  }
  if (unclassified.length) {
    const tokens = unclassified.reduce((n, r) => n + r.rule.estimatedTokens, 0);
    out.push(
      '',
      pc.bold(
        `Denetlenemeyen kurallar (${unclassified.length}, ~${fmtTokens(tokens)} token/oturum)`,
      ),
      pc.dim('  Bu satırlar sadece token maliyeti olarak sayılır; uyumları ölçülemez.'),
    );
    const limit = opts.all ? unclassified.length : 15;
    for (const r of unclassified.slice(0, limit))
      out.push(
        pc.dim(`  ${homeRel(r.rule.source.path)}:${r.rule.source.line} ${short(r.rule.text, 70)}`),
      );
    if (unclassified.length > limit)
      out.push(pc.dim(`  +${unclassified.length - limit} satır daha (--all-rules veya --json)`));
  }
  out.push(
    '',
    pc.dim(
      '"Olası ihlal": kullanıcı ajana kuralı çiğnemesini açıkça söylemiş olabilir; kesin hüküm değildir.',
    ),
  );
  return out.join('\n');
}
