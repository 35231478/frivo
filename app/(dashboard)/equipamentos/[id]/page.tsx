import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";
import { EquipamentoPerfil } from "@/components/equipamentos/equipamento-perfil";
import { carregarHistoricoEquipamento } from "@/lib/equipamento-historico";
import { proximaManutencaoPorContrato } from "@/lib/equipamento-indicadores";

export const metadata: Metadata = { title: "Equipamento" };

export default async function EquipamentoPerfilPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string }> }) {
  const { id } = await params;
  const { aba } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const equipamento = await prisma.equipamento.findFirst({
    where: { id, empresaId },
    include: {
      tipoEquipamento: { select: { id: true, nome: true } },
      unidade: { include: { cliente: { select: { id: true, nome: true, nomeFantasia: true } } } },
      qrcode: { select: { id: true, codigo: true, ativo: true } },
    },
  });
  if (!equipamento) notFound();

  // Histórico de formulários respondidos (por equipamento), agrupado por preenchimento (atividade + formulário)
  const respostas = await prisma.respostaFormularioEquipamento.findMany({
    where: { equipamentoId: id, empresaId },
    orderBy: { respondidoEm: "desc" },
    select: {
      atividadeId: true,
      formularioId: true,
      resposta: true,
      arquivoUrl: true,
      respondidoEm: true,
      campo: { select: { id: true, label: true, tipo: true, ordem: true } },
      formulario: { select: { nome: true } },
      respondidoPor: { select: { nome: true } },
      atividade: {
        select: {
          id: true, titulo: true,
          tipoOs: { select: { nome: true, cor: true } },
          ordemServico: { select: { id: true, numero: true } },
        },
      },
    },
  });

  // Agrupa por (atividade + formulário)
  const mapa = new Map<string, any>();
  for (const r of respostas) {
    const chave = `${r.atividadeId}|${r.formularioId}`;
    if (!mapa.has(chave)) {
      mapa.set(chave, {
        chave,
        formularioNome: r.formulario.nome,
        osId: r.atividade.ordemServico.id,
        osNumero: r.atividade.ordemServico.numero,
        atividadeTitulo: r.atividade.titulo,
        tipoOs: r.atividade.tipoOs,
        respondidoEm: r.respondidoEm,
        respondidoPor: r.respondidoPor?.nome ?? null,
        campos: [] as any[],
      });
    }
    const g = mapa.get(chave);
    g.campos.push({ label: r.campo.label, tipo: r.campo.tipo, ordem: r.campo.ordem, resposta: r.resposta, arquivoUrl: r.arquivoUrl });
    if (r.respondidoEm > g.respondidoEm) g.respondidoEm = r.respondidoEm;
  }
  const historico = [...mapa.values()].map((g) => ({
    ...g,
    campos: g.campos.sort((a: any, b: any) => a.ordem - b.ordem),
  }));

  const tipoNome = equipamento.tipoEquipamento?.nome
    ?? LABELS_TIPO_EQUIPAMENTO[equipamento.tipo as keyof typeof LABELS_TIPO_EQUIPAMENTO]
    ?? equipamento.tipo;

  // Linha do tempo de atendimentos (OS diretas + atividades com vários equipamentos)
  const linhaDoTempo = await carregarHistoricoEquipamento(empresaId, id);

  // Visão rápida — derivada dos atendimentos; a "próxima" usa a atividade agendada mais
  // próxima e, na falta dela, a recorrência de contrato do local (sem campos novos no banco).
  const agora = Date.now();
  const concluidos = linhaDoTempo.filter((ev) => ev.status === "CONCLUIDA");
  const agendada = linhaDoTempo
    .filter((ev) => ev.status === "AGENDADA" && new Date(ev.data).getTime() >= agora)
    .sort((a, b) => a.data.localeCompare(b.data))[0];
  const porContrato = agendada ? null : await proximaManutencaoPorContrato(empresaId, equipamento.unidadeId);
  const indicadores = {
    ultimoAtendimento: concluidos[0]?.data ?? null,
    proxima: agendada
      ? { data: agendada.data, origem: agendada.tipoServico?.nome ?? agendada.titulo, osId: agendada.os.id }
      : porContrato
        ? { data: porContrato.data.toISOString(), origem: porContrato.origem, osId: null }
        : null,
    totalAtendimentos: concluidos.length,
  };

  return (
    <EquipamentoPerfil
      indicadores={indicadores}
      equipamento={equipamento as any}
      tipoNome={tipoNome}
      historico={historico}
      linhaDoTempo={linhaDoTempo}
      abaInicial={aba}
    />
  );
}
