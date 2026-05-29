import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requirePortalSession, getPortalBranding } from "@/lib/portal-server";
import { formatarData } from "@/lib/utils";
import { ClipboardList, CalendarCheck, FileText, AlertTriangle, Bell, Headset } from "lucide-react";

export const metadata: Metadata = { title: "Portal — Início" };
export const dynamic = "force-dynamic";

export default async function PortalDashboard() {
  const { user } = await requirePortalSession();
  const { clienteId, empresaId, permissoes } = user;
  const branding = await getPortalBranding(empresaId);
  const agora = new Date();
  const em7dias = new Date(agora.getTime() + 7 * 864e5);
  const em30dias = new Date(agora.getTime() + 30 * 864e5);

  const [osAbertas, proxima, totalDocs, medicoesPend, boletos, contratosVencendo] = await Promise.all([
    prisma.ordemServico.count({ where: { empresaId, clienteId, status: { in: ["ABERTA", "AGUARDANDO_ATENDIMENTO", "AGENDADA", "EM_ANDAMENTO", "PAUSADA"] } } }),
    prisma.ordemServico.findFirst({ where: { empresaId, clienteId, status: "AGENDADA", previsaoConclusao: { gte: agora } }, orderBy: { previsaoConclusao: "asc" }, select: { numero: true, previsaoConclusao: true } }),
    prisma.relatorioOs.count({ where: { empresaId, ordemServico: { clienteId } } }),
    prisma.medicao.count({ where: { empresaId, clienteId, status: "AGUARDANDO_APROVACAO" } }),
    prisma.contaReceber.findMany({ where: { empresaId, clienteId, status: { in: ["A_RECEBER", "PREVISTO", "ATRASADO"] }, dataVencimento: { lte: em7dias } }, select: { dataVencimento: true, status: true } }),
    prisma.contrato.findMany({ where: { empresaId, clienteId, status: "ATIVO", dataFim: { gte: agora, lte: em30dias } }, select: { numero: true, dataFim: true } }),
  ]);

  const alertas: { tipo: "info" | "warn" | "danger"; texto: string }[] = [];
  if (permissoes.verFinanceiro && medicoesPend > 0) alertas.push({ tipo: "warn", texto: `Você tem ${medicoesPend} medição(ões) aguardando aprovação.` });
  if (permissoes.verBoletos) {
    const vencidos = boletos.filter((b) => b.dataVencimento && b.dataVencimento < agora).length;
    const vencendo = boletos.length - vencidos;
    if (vencidos > 0) alertas.push({ tipo: "danger", texto: `${vencidos} boleto(s) vencido(s).` });
    if (vencendo > 0) alertas.push({ tipo: "warn", texto: `${vencendo} boleto(s) vencendo nos próximos 7 dias.` });
  }
  for (const c of contratosVencendo) {
    const dias = Math.max(0, Math.ceil(((c.dataFim as Date).getTime() - agora.getTime()) / 864e5));
    alertas.push({ tipo: "info", texto: `Contrato ${c.numero} vence em ${dias} dia(s).` });
  }

  const cards = [
    { label: "OS abertas / em andamento", valor: osAbertas, icone: ClipboardList, href: "/portal/chamados" },
    { label: "Próxima manutenção", valor: proxima ? formatarData(proxima.previsaoConclusao) : "—", icone: CalendarCheck, href: "/portal/agenda", texto: true },
    ...(permissoes.verDocumentos ? [{ label: "Documentos disponíveis", valor: totalDocs, icone: FileText, href: "/portal/documentos" }] : []),
    ...(permissoes.verFinanceiro ? [{ label: "Pendências", valor: medicoesPend + boletos.length, icone: AlertTriangle, href: "/portal/financeiro" }] : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Olá, {(user.name ?? "Cliente").split(" ")[0]}! 👋</h1>
        <p className="text-sm text-ink-muted mt-1">{branding.boasVindas || `Bem-vindo ao portal de ${branding.empresaNome}.`}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="bg-white rounded-xl border border-surface-border p-4 shadow-card hover:shadow-card-hover hover:border-primary-200 transition-all">
            <div className="p-2 rounded-lg bg-primary-50 w-fit mb-2"><c.icone className="w-5 h-5 text-primary-600" /></div>
            <p className={c.texto ? "text-base font-bold text-ink" : "text-2xl font-bold text-ink"}>{c.valor}</p>
            <p className="text-xs text-ink-muted mt-0.5">{c.label}</p>
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-surface-border p-5 shadow-card">
        <h2 className="text-sm font-bold text-ink flex items-center gap-2 mb-3"><Bell className="w-4 h-4 text-primary-600" /> Avisos</h2>
        {alertas.length === 0 ? (
          <p className="text-sm text-ink-muted">Nenhum aviso no momento. 🎉</p>
        ) : (
          <ul className="space-y-2">
            {alertas.map((a, i) => (
              <li key={i} className={
                "text-sm rounded-lg px-3 py-2 border " +
                (a.tipo === "danger" ? "bg-red-50 border-red-200 text-red-700" : a.tipo === "warn" ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-primary-50 border-primary-200 text-primary-700")
              }>{a.texto}</li>
            ))}
          </ul>
        )}
      </div>

      {permissoes.abrirChamados && (
        <Link href="/portal/chamados/novo" className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all">
          <Headset className="w-4 h-4" /> Abrir novo chamado
        </Link>
      )}
    </div>
  );
}
