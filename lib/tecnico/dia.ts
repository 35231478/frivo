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

const SELECT_CARTAO = {
  id: true, titulo: true, status: true, dataAgendada: true, duracaoMin: true,
  tipoOs: { select: { nome: true, cor: true } },
  ordemServico: {
    select: {
      id: true, numero: true, prioridade: true, descricao: true,
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
  equipamentos: number;
  atendidos: number;
  adicionais: number;
}

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
    equipamentos: a._count.equipamentos, atendidos: a.equipamentos.length, adicionais: a._count.servicosAdicionais,
  };
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
  const cartoes = atividades.map(montarCartao);
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
  for (const c of atividades.map(montarCartao)) porDia.set(c.dia!, [...(porDia.get(c.dia!) ?? []), c]);
  return [...porDia.keys()].sort().map((dia) => ({ dia, atividades: ordenarDoDia(porDia.get(dia)!) }));
}

/** O cartão de UMA atividade (cabeçalho da execução no app). */
export async function cartaoDaAtividade(empresaId: string, atividadeId: string, filtro: Prisma.AtividadeOsWhereInput = {}) {
  const a = await prisma.atividadeOs.findFirst({ where: { id: atividadeId, empresaId, ...filtro }, select: SELECT_CARTAO });
  return a ? montarCartao(a) : null;
}
