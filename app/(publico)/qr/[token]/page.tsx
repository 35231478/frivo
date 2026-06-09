import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPortalBranding } from "@/lib/portal-server";
import { getPortalSession } from "@/lib/auth-portal";
import { mesclarQrConfig } from "@/lib/qr-config";
import { LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";
import { QrPublicoClient } from "@/components/public/qr-publico-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "QR Code", robots: { index: false, follow: false } };

const STATUS_LABEL: Record<string, { label: string; cor: string }> = {
  ABERTA: { label: "Aberta", cor: "#0EA5E9" },
  AGUARDANDO_ATENDIMENTO: { label: "Aguardando atendimento", cor: "#F59E0B" },
  AGENDADA: { label: "Agendada", cor: "#6366F1" },
  EM_ANDAMENTO: { label: "Em andamento", cor: "#0EA5E9" },
  PAUSADA: { label: "Pausada", cor: "#94A3B8" },
  AGUARDANDO_PECA: { label: "Aguardando peça", cor: "#F59E0B" },
  CONCLUIDA: { label: "Concluída", cor: "#10B981" },
  CANCELADA: { label: "Cancelada", cor: "#EF4444" },
};

function soDigitos(v: string) {
  return (v || "").replace(/\D/g, "");
}
function dataBR(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default async function QrPublicoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const qrcode = await prisma.qrcode.findUnique({
    where: { tokenPublico: token },
    include: {
      equipamento: { include: { unidade: { select: { nome: true } } } },
    },
  });
  if (!qrcode) notFound();

  const empresaId = qrcode.empresaId;
  const [branding, configRow] = await Promise.all([
    getPortalBranding(empresaId),
    prisma.configuracao.findUnique({ where: { empresaId }, select: { qrConfig: true } }),
  ]);
  const cfg = mesclarQrConfig(configRow?.qrConfig);
  const sessao = await getPortalSession();
  const logado = !!sessao?.user;

  // ── Página pública desativada → acesso restrito ──
  if (!cfg.paginaPublicaAtiva) {
    const wpp = soDigitos(cfg.whatsappNumero);
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        {branding.logo ? (
          <img src={branding.logo} alt={branding.empresaNome} className="h-14 object-contain mb-4" />
        ) : (
          <h1 className="text-xl font-bold text-ink mb-4">{branding.empresaNome}</h1>
        )}
        <p className="text-ink-muted">Acesso restrito.</p>
        {wpp && (
          <a href={`https://wa.me/55${wpp}`} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-green-500 text-white px-4 py-2.5 text-sm font-medium">
            Entre em contato pelo WhatsApp
          </a>
        )}
      </div>
    );
  }

  const equip = qrcode.equipamento;

  // ── QR ainda não vinculado a um equipamento ──
  if (!equip) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        {branding.logo ? <img src={branding.logo} alt={branding.empresaNome} className="h-14 object-contain mb-4" /> : <h1 className="text-xl font-bold text-ink mb-4">{branding.empresaNome}</h1>}
        <p className="text-ink-muted">Este QR Code ({qrcode.codigo}) ainda não foi vinculado a um equipamento.</p>
      </div>
    );
  }

  // ── Histórico (últimas 5 OS concluídas) ──
  const mostrarHistorico = cfg.mostrarHistorico && (!cfg.historicoSomenteLogado || logado);
  const historico = mostrarHistorico
    ? await prisma.ordemServico.findMany({
        where: { empresaId, equipamentoId: equip.id, status: "CONCLUIDA" },
        orderBy: [{ dataConclusao: "desc" }, { criadoEm: "desc" }],
        take: 5,
        select: {
          id: true, numero: true, status: true, dataConclusao: true, criadoEm: true,
          atividades: { select: { tipoOs: { select: { nome: true } }, tecnico: { select: { nome: true } } }, take: 1 },
        },
      })
    : [];

  // ── Próxima manutenção agendada ──
  const proxima = cfg.mostrarProximaManutencao
    ? await prisma.atividadeOs.findFirst({
        where: { empresaId, ordemServico: { equipamentoId: equip.id }, status: "AGENDADA", dataAgendada: { gte: new Date() } },
        orderBy: { dataAgendada: "asc" },
        select: { dataAgendada: true, titulo: true, tipoOs: { select: { nome: true } } },
      })
    : null;

  const dados = {
    token,
    empresaNome: branding.empresaNome,
    logo: branding.logo,
    boasVindas: cfg.mensagemBoasVindas || branding.boasVindas || "",
    cor: branding.cor,
    equipamento: cfg.mostrarDadosEquipamento
      ? {
          nome: `${equip.marca} ${equip.modelo}`,
          tipo: LABELS_TIPO_EQUIPAMENTO[equip.tipo as keyof typeof LABELS_TIPO_EQUIPAMENTO] ?? equip.tipo,
          marca: equip.marca,
          modelo: equip.modelo,
          numeroSerie: equip.numeroSerie ?? null,
        }
      : null,
    localizacao: cfg.mostrarLocalizacao
      ? { unidade: equip.unidade?.nome ?? null, local: equip.localizacao ?? null }
      : null,
    historico: historico.map((o) => ({
      id: o.id,
      numero: o.numero,
      data: dataBR(o.dataConclusao ?? o.criadoEm),
      tipo: o.atividades[0]?.tipoOs?.nome ?? "Manutenção",
      tecnico: o.atividades[0]?.tecnico?.nome ?? null,
      status: STATUS_LABEL[o.status] ?? { label: o.status, cor: "#94A3B8" },
    })),
    historicoOculto: cfg.mostrarHistorico && cfg.historicoSomenteLogado && !logado,
    proxima: proxima
      ? { data: dataBR(proxima.dataAgendada), tipo: proxima.tipoOs?.nome ?? proxima.titulo }
      : null,
    botoes: {
      whatsapp: cfg.botaoWhatsapp && soDigitos(cfg.whatsappNumero) ? `https://wa.me/55${soDigitos(cfg.whatsappNumero)}` : null,
      site: cfg.linkSite || null,
      chamado: (cfg.botaoChamado ? (cfg.chamadoSomenteLogado && !logado ? "login" : "form") : null) as "login" | "form" | null,
      orcamento: (cfg.botaoOrcamento ? (cfg.orcamentoSomenteLogado && !logado ? "login" : "form") : null) as "login" | "form" | null,
    },
  };

  return <QrPublicoClient dados={dados} />;
}
