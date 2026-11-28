/**
 * "Meu dia" e "Agenda" do técnico — carga do servidor. Só as atividades ATRIBUÍDAS ao técnico
 * (responsável ou na composição), da empresa da sessão, sem as canceladas. Cada cartão traz o que o
 * técnico precisa na rua: cliente, endereço + rota no mapa, horário, situação e nº de equipamentos.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { chaveDiaBR, inicioHojeBR } from "@/lib/fuso";
import { atividadesDoTecnico } from "@/lib/tecnico/escopo";
import { enderecoEmLinha, horaMarcada, linkRota, ordenarDoDia } from "@/lib/tecnico/cartao";
import { avisosDeHojePorAtividade } from "@/lib/execucao/aviso-cliente";
import type { AvisosTela } from "@/lib/tecnico/aviso-cliente";
import { numerosDasVisitas } from "@/lib/os/visitas-server";
import type { MaterialPrevisto } from "@/lib/tecnico/o-que-levar";
import { whereOsAguardando } from "@/lib/pedido-cliente/where";
import { prazoDefinido } from "@/lib/os/prazo-execucao";

const SELECT_CARTAO = {
  id: true, titulo: true, status: true, dataAgendada: true, duracaoMin: true, observacao: true, planoVisitasId: true, prazo: true, iniciadaEm: true,
  tipoOs: { select: { nome: true, cor: true } },
  ordemServico: {
    select: {
      id: true, numero: true, prioridade: true, descricao: true, origem: true, observacoes: true, prazoExecucao: true,
      criadoPor: { select: { nome: true } },
      cliente: { select: { nome: true, nomeFantasia: true, telefone: true, endereco: true, numero: true, bairro: true, cidade: true, estado: true, cep: true } },
      unidade: { select: { nome: true, logradouro: true, numero: true, complemento: true, bairro: true, cidade: true, estado: true, cep: true, latitude: true, longitude: true, telefone: true } },
    },
  },
  _count: { select: { equipamentos: true, servicosAdicionais: true } },
  equipamentos: { where: { feito: true }, select: { id: true } },
  // D1: a pausa aberta ("Pausada — motivo" no cartão)
  pausas: { where: { fim: null }, orderBy: { inicio: "desc" }, take: 1, select: { clientId: true, motivo: true, inicio: true, impedimento: true } },
} satisfies Prisma.AtividadeOsSelect;

type AtividadeCartao = Prisma.AtividadeOsGetPayload<{ select: typeof SELECT_CARTAO }>;

export interface CartaoAtividade {
  atividadeId: string;
  osId: string;
  osNumero: string;
  titulo: string;
  tipoOs: { nome: string; cor: string } | null;
  status: string;
  prioridade: string;
  dataAgendada: Date | null;
  dia: string | null;
  hora: string | null;
  duracaoMin: number | null;
  cliente: string;
  telefone: string | null;
  unidade: string | null;
  endereco: string;
  rota: string | null;
  descricao: string;
  /** A OS veio de um chamado do cliente (portal ou QR Code): a descrição é o que ele pediu */
  chamado: boolean;
  /** O cliente exige o pedido dele ANTES da execução e ele ainda não veio: o início trava (lib/pedido-cliente) */
  aguardandoPedido?: boolean;
  /** O que o escritório escreveu para a visita: a observação da atividade e as observações da OS */
  orientacao: string;
  /**
   * O prazo DEFINIDO ("AAAA-MM-DD"): o da atividade ou o da OS, o mais próximo. null = ninguém
   * definiu prazo (vale o dia agendado, que o cartão já mostra). O selo é calculado na tela.
   */
  prazo: string | null;
  equipamentos: number;
  atendidos: number;
  adicionais: number;
  /** "A caminho" / "Cheguei" registrados HOJE (só nas listas; no retrato vão em `execucao.avisos`) */
  avisos?: AvisosTela;
  /** OS dividida em visitas diárias: qual é esta ("Visita 3 de 12"). Ausente = atividade comum */
  visita?: { numero: number; total: number };
  /**
   * "O que levar": materiais previstos da OS (quem põe é a rota, com a opção da empresa ligada —
   * lib/tecnico/o-que-levar-server). Ausente = opção desligada
   */
  materiais?: MaterialPrevisto[];
  /** Quando começou (ISO); a atividade em andamento antiga, sem a coluna, usa a hora agendada. null = não começou */
  iniciadaEm: string | null;
  /** Quem abriu a OS e como ela chegou (dado de escritório: fica em "Detalhes") */
  criadoPor: string | null;
  origem: string;
  /** D1: a pausa aberta (null = em execução) */
  pausa: { clientId: string; motivo: string; inicio: string; impedimento: boolean } | null;
}

/** Junta os textos do escritório (sem repetir o mesmo texto), um parágrafo cada. */
const juntarTextos = (...textos: (string | null | undefined)[]) =>
  textos.map((t) => (t ?? "").trim()).filter((t, i, todos) => t && todos.indexOf(t) === i).join("\n\n");

export function montarCartao(a: AtividadeCartao): CartaoAtividade {
  const os = a.ordemServico;
  const u = os.unidade;
  const c = os.cliente;
  // Endereço da unidade (onde o serviço acontece); sem ele, o do cliente
  const local = u && (u.logradouro || u.cidade || u.latitude !== null)
    ? u
    : { logradouro: c.endereco, numero: c.numero, bairro: c.bairro, cidade: c.cidade, estado: c.estado, cep: c.cep };
  return {
    atividadeId: a.id, osId: os.id, osNumero: os.numero, titulo: a.titulo, tipoOs: a.tipoOs, status: a.status, prioridade: os.prioridade,
    dataAgendada: a.dataAgendada, dia: a.dataAgendada ? chaveDiaBR(a.dataAgendada) : null, hora: horaMarcada(a.dataAgendada), duracaoMin: a.duracaoMin,
    cliente: (c.nomeFantasia ?? "").trim() || c.nome, telefone: (u?.telefone ?? c.telefone ?? "").trim() || null, unidade: u?.nome ?? null,
    endereco: enderecoEmLinha(local), rota: linkRota(local), descricao: os.descricao,
    chamado: os.origem === "PORTAL_CLIENTE", orientacao: juntarTextos(a.observacao, os.observacoes),
    prazo: prazoDefinido({ prazoAtividade: a.prazo, prazoOs: os.prazoExecucao }),
    equipamentos: a._count.equipamentos, atendidos: a.equipamentos.length, adicionais: a._count.servicosAdicionais,
    // Atividade esquecida em andamento: o início (as antigas, sem a coluna, usam a hora agendada)
    iniciadaEm: (a.iniciadaEm ?? (a.status === "EM_ANDAMENTO" ? a.dataAgendada : null))?.toISOString() ?? null,
    // Dado de escritório (vai para "Detalhes" no topo da OS)
    criadoPor: os.criadoPor?.nome ?? null, origem: os.origem,
    pausa: a.pausas[0] ? { clientId: a.pausas[0].clientId, motivo: a.pausas[0].motivo, inicio: a.pausas[0].inicio.toISOString(), impedimento: a.pausas[0].impedimento } : null,
  };
}

/**
 * Põe em cada cartão o "A caminho" / "Cheguei" de HOJE (uma consulta para a lista inteira): é o que
 * diz ao card se o técnico já chegou — e, portanto, se a OS abre.
 */
async function comAvisosDeHoje(cartoes: CartaoAtividade[], agora: Date): Promise<CartaoAtividade[]> {
  const avisos = await avisosDeHojePorAtividade(cartoes.map((c) => c.atividadeId), agora);
  return cartoes.map((c) => ({ ...c, avisos: avisos.get(c.atividadeId) ?? {} }));
}

/** Os cartões das atividades, com "Visita N de M" nas que são visita de uma OS em campanha */
async function cartoesDe(atividades: AtividadeCartao[]): Promise<CartaoAtividade[]> {
  const osIds = [...new Set(atividades.map((a) => a.ordemServico.id))];
  // As OS de cliente que exige o pedido ANTES da execução e ainda não o mandou (o cartão avisa antes do "Cheguei")
  const [visitas, travadas] = await Promise.all([
    numerosDasVisitas(atividades),
    osIds.length ? prisma.ordemServico.findMany({ where: { id: { in: osIds }, ...whereOsAguardando(["EXECUTAR"]) }, select: { id: true } }) : [],
  ]);
  const semPedido = new Set(travadas.map((o) => o.id));
  return atividades.map((a) => {
    const v = visitas.get(a.id);
    const c = v ? { ...montarCartao(a), visita: v } : montarCartao(a);
    return semPedido.has(a.ordemServico.id) ? { ...c, aguardandoPedido: true } : c;
  });
}

/**
 * Hoje: as atividades marcadas para hoje (Brasília) + as que ele começou (em outro dia, ou sem data) e ainda não
 * concluiu (precisa terminar). Em ordem de horário.
 */
export const ondeMeuDia = (empresaId: string, tecnicoId: string, agora = new Date()): Prisma.AtividadeOsWhereInput => {
  const inicio = inicioHojeBR(agora);
  const fim = inicioHojeBR(agora, 1);
  // AND explícito: o filtro do técnico já é um OR (responsável ou na equipe), e outro OR na mesma chave o apagaria
  return {
    AND: [
      { empresaId, status: { not: "CANCELADA" } },
      atividadesDoTecnico(tecnicoId),
      // Em andamento entra com QUALQUER data — também sem data ou marcada para depois (começou e falta concluir); antes,
      // `dataAgendada < hoje` deixava a sem data fora do Meu dia (e o chat a oferecia)
      { OR: [{ dataAgendada: { gte: inicio, lt: fim } }, { status: "EM_ANDAMENTO" }] },
    ],
  };
};

export async function meuDia(empresaId: string, tecnicoId: string, agora = new Date()) {
  const atividades = await prisma.atividadeOs.findMany({
    where: ondeMeuDia(empresaId, tecnicoId, agora),
    select: SELECT_CARTAO,
    take: 100,
  });
  const cartoes = await comAvisosDeHoje(await cartoesDe(atividades), agora);
  const hoje = chaveDiaBR(agora);
  return {
    dia: hoje,
    atividades: ordenarDoDia(cartoes.filter((c) => c.dia === hoje)),
    anteriores: ordenarDoDia(cartoes.filter((c) => c.dia !== hoje)),
  };
}

/** Agenda: hoje e os próximos dias, agrupados por dia (em ordem de horário dentro do dia). */
export async function agenda(empresaId: string, tecnicoId: string, dias = 14, agora = new Date()) {
  const inicio = inicioHojeBR(agora);
  const fim = inicioHojeBR(agora, dias);
  const atividades = await prisma.atividadeOs.findMany({
    where: { empresaId, status: { not: "CANCELADA" }, dataAgendada: { gte: inicio, lt: fim }, ...atividadesDoTecnico(tecnicoId) },
    select: SELECT_CARTAO,
    take: 300,
  });
  const porDia = new Map<string, CartaoAtividade[]>();
  for (const c of await comAvisosDeHoje(await cartoesDe(atividades), agora)) porDia.set(c.dia!, [...(porDia.get(c.dia!) ?? []), c]);
  return [...porDia.keys()].sort().map((dia) => ({ dia, atividades: ordenarDoDia(porDia.get(dia)!) }));
}

/** O cartão de UMA atividade (cabeçalho da execução no app). */
export async function cartaoDaAtividade(empresaId: string, atividadeId: string, filtro: Prisma.AtividadeOsWhereInput = {}) {
  const a = await prisma.atividadeOs.findFirst({ where: { id: atividadeId, empresaId, ...filtro }, select: SELECT_CARTAO });
  return a ? (await cartoesDe([a]))[0] : null;
}
