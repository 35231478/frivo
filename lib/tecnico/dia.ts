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

const SELECT_CARTAO = {
  id: true, titulo: true, status: true, dataAgendada: true, duracaoMin: true, observacao: true, planoVisitasId: true,
  tipoOs: { select: { nome: true, cor: true } },
  ordemServico: {
    select: {
      id: true, numero: true, prioridade: true, descricao: true, origem: true, observacoes: true,
      cliente: { select: { nome: true, nomeFantasia: true, telefone: true, endereco: true, numero: true, bairro: true, cidade: true, estado: true, cep: true } },
      unidade: { select: { nome: true, logradouro: true, numero: true, complemento: true, bairro: true, cidade: true, estado: true, cep: true, latitude: true, longitude: true, telefone: true } },
    },
  },
  _count: { select: { equipamentos: true, servicosAdicionais: true } },
  equipamentos: { where: { feito: true }, select: { id: true } },
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
  /** O que o escritório escreveu para a visita: a observação da atividade e as observações da OS */
  orientacao: string;
  equipamentos: number;
  atendidos: number;
  adicionais: number;
  /** "A caminho" / "Cheguei" registrados HOJE (só nas listas; no retrato vão em `execucao.avisos`) */
  avisos?: AvisosTela;
  /** OS dividida em visitas diárias: qual é esta ("Visita 3 de 12"). Ausente = atividade comum */
  visita?: { numero: number; total: number };
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
    equipamentos: a._count.equipamentos, atendidos: a.equipamentos.length, adicionais: a._count.servicosAdicionais,
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
  const visitas = await numerosDasVisitas(atividades);
  return atividades.map((a) => { const v = visitas.get(a.id); return v ? { ...montarCartao(a), visita: v } : montarCartao(a); });
}

/**
 * Hoje: as atividades marcadas para hoje (Brasília) + as que ele começou em outro dia e ainda não
 * concluiu (precisa terminar). Em ordem de horário.
 */
export async function meuDia(empresaId: string, tecnicoId: string, agora = new Date()) {
  const inicio = inicioHojeBR(agora);
  const fim = inicioHojeBR(agora, 1);
  const atividades = await prisma.atividadeOs.findMany({
    where: {
      empresaId, status: { not: "CANCELADA" }, ...atividadesDoTecnico(tecnicoId),
      AND: [{ OR: [{ dataAgendada: { gte: inicio, lt: fim } }, { status: "EM_ANDAMENTO", dataAgendada: { lt: inicio } }] }],
    },
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
