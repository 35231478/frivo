import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requirePortalSession, exigePermissao } from "@/lib/portal-server";
import { SemAcesso } from "@/components/portal/sem-acesso";
import { formatarData, nomeMes, LABELS_TIPO_RELATORIO } from "@/lib/utils";
import { FileText, ScrollText, FileSignature, ExternalLink, AlertTriangle } from "lucide-react";

export const metadata: Metadata = { title: "Portal — Documentos" };
export const dynamic = "force-dynamic";

export default async function PortalDocumentos() {
  const sessao = await requirePortalSession();
  if (!exigePermissao(sessao, "verDocumentos")) return <SemAcesso />;
  const { user } = sessao;
  const agora = new Date();
  const em30 = new Date(agora.getTime() + 30 * 864e5);

  const [relatorios, contratos] = await Promise.all([
    prisma.relatorioOs.findMany({
      where: { empresaId: user.empresaId, ordemServico: { clienteId: user.clienteId }, escopo: { in: ["GERAL", "MEDICAO_COMPLETA"] } },
      select: { id: true, numero: true, tipo: true, mesReferencia: true, anoReferencia: true, tokenPublico: true, criadoEm: true },
      orderBy: { criadoEm: "desc" }, take: 100,
    }),
    prisma.contrato.findMany({
      where: { empresaId: user.empresaId, clienteId: user.clienteId },
      select: { id: true, numero: true, tipo: true, artNumero: true, dataInicio: true, dataFim: true, documento: true, responsavelTecnico: { select: { nome: true, crea: true } } },
      orderBy: { criadoEm: "desc" },
    }),
  ]);

  const arts = contratos.filter((c) => c.artNumero);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><FileText className="w-6 h-6 text-primary-600" /> Documentos</h1>

      {/* Alertas de vencimento */}
      {contratos.filter((c) => c.dataFim && c.dataFim >= agora && c.dataFim <= em30).map((c) => {
        const dias = Math.ceil(((c.dataFim as Date).getTime() - agora.getTime()) / 864e5);
        return <div key={c.id} className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg px-3 py-2 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Contrato {c.numero} vence em {dias} dia(s).</div>;
      })}

      <Secao titulo="PMOC e Relatórios" icone={FileText}>
        {relatorios.length === 0 ? <Vazio /> : relatorios.map((r) => (
          <Linha key={r.id} principal={`${r.numero} · ${LABELS_TIPO_RELATORIO[r.tipo] ?? r.tipo}`} sec={`${nomeMes(r.mesReferencia)}/${r.anoReferencia} · ${formatarData(r.criadoEm)}`} href={`/relatorio/os/${r.tokenPublico}`} />
        ))}
      </Secao>

      <Secao titulo="ARTs" icone={ScrollText}>
        {arts.length === 0 ? <Vazio /> : arts.map((c) => (
          <Linha key={c.id} principal={`ART ${c.artNumero}`} sec={`Contrato ${c.numero}${c.responsavelTecnico ? ` · ${c.responsavelTecnico.nome}${c.responsavelTecnico.crea ? ` (CREA ${c.responsavelTecnico.crea})` : ""}` : ""}`} />
        ))}
      </Secao>

      <Secao titulo="Contratos" icone={FileSignature}>
        {contratos.length === 0 ? <Vazio /> : contratos.map((c) => (
          <Linha key={c.id} principal={`Contrato ${c.numero}`} sec={`Vigência: ${formatarData(c.dataInicio)} → ${c.dataFim ? formatarData(c.dataFim) : "indeterminado"}`} href={c.documento || undefined} />
        ))}
      </Secao>
    </div>
  );
}

function Secao({ titulo, icone: Icone, children }: { titulo: string; icone: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
      <div className="px-4 py-3 border-b border-surface-border flex items-center gap-2"><Icone className="w-4 h-4 text-primary-600" /> <span className="text-sm font-bold text-ink">{titulo}</span></div>
      <div className="divide-y divide-surface-border">{children}</div>
    </div>
  );
}
function Linha({ principal, sec, href }: { principal: string; sec: string; href?: string }) {
  const body = (
    <div className="flex items-center justify-between px-4 py-3 hover:bg-surface-alt/50 transition-colors">
      <div className="min-w-0"><p className="text-sm font-medium text-ink truncate">{principal}</p><p className="text-xs text-ink-muted">{sec}</p></div>
      {href && <ExternalLink className="w-4 h-4 text-primary-600 shrink-0" />}
    </div>
  );
  return href ? <a href={href} target="_blank" rel="noopener">{body}</a> : body;
}
function Vazio() { return <p className="px-4 py-6 text-sm text-ink-subtle text-center">Nenhum documento disponível.</p>; }
