import { prisma } from "@/lib/prisma";
import { formatarData } from "@/lib/utils";

/**
 * Regras de inativação (soft-delete) de Orçamentos, Colaboradores, Equipes e Veículos.
 * Nada é apagado: o registro sai das listas padrão e pode ser reativado.
 *
 * Cada função devolve:
 * - `bloqueio`: motivo que IMPEDE a inativação (o servidor responde 409 com essa mensagem);
 * - `avisos`: impactos que não impedem, mas o usuário precisa saber antes de confirmar.
 * A mesma função alimenta o modal (GET …/impacto) e a rota que inativa (DELETE).
 */
export interface Impacto { bloqueio: string | null; avisos: string[] }

const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;
const lista = (itens: string[], max = 3) => itens.slice(0, max).join(", ") + (itens.length > max ? ` e mais ${itens.length - max}` : "");

/* ───────── Orçamento (inativar = status CANCELADO) ───────── */
export async function impactoOrcamento(id: string, empresaId: string): Promise<Impacto | null> {
  const o = await prisma.orcamento.findFirst({
    where: { id, empresaId },
    select: {
      status: true, assinadoEm: true,
      contratoGerado: { select: { numero: true, status: true } },
      ordensServico: { select: { ordemServico: { select: { numero: true, chamadoNumero: true, status: true } } } },
      medicaoItens: { where: { medicao: { status: { not: "CANCELADA" } } }, select: { medicao: { select: { numero: true } } } },
      contasReceber: { where: { status: { not: "CANCELADO" } }, select: { numero: true } },
      pedidosCompra: { where: { status: { notIn: ["CANCELADO"] as any } }, select: { numero: true } },
    },
  });
  if (!o) return null;
  const avisos: string[] = [];

  if (o.status === "CONVERTIDA" || o.contratoGerado) {
    const ct = o.contratoGerado?.numero;
    return {
      bloqueio: `Este orçamento já foi convertido no contrato ${ct ?? "gerado a partir dele"}. Cancelar o orçamento deixaria o contrato sem a proposta de origem. Para encerrar, altere o status do contrato em Contratos.`,
      avisos,
    };
  }
  const financeiro = [
    ...o.medicaoItens.map((m) => `medição ${m.medicao.numero}`),
    ...o.contasReceber.map((c) => `conta a receber ${c.numero}`),
  ];
  if (financeiro.length) {
    return {
      bloqueio: `Este orçamento já entrou no financeiro (${lista([...new Set(financeiro)])}). Cancele ou remova esses lançamentos no Financeiro antes de cancelar o orçamento.`,
      avisos,
    };
  }
  const osAtivas = o.ordensServico.map((v) => v.ordemServico).filter((os) => os.status !== "CANCELADA");
  if (o.status === "APROVADO" && osAtivas.length) {
    return {
      bloqueio: `Este orçamento foi aprovado e está em execução na(s) OS ${lista(osAtivas.map((os) => os.chamadoNumero ?? os.numero))}. Desvincule o orçamento na aba Orçamentos da OS (ou cancele a OS) antes de cancelá-lo.`,
      avisos,
    };
  }

  if (o.status === "APROVADO") avisos.push(`O cliente já aprovou este orçamento${o.assinadoEm ? ` em ${formatarData(o.assinadoEm)}` : ""}. Ao cancelar, o link público passa a mostrar "cancelado".`);
  else if (o.status === "ENVIADO") avisos.push(`Ele já foi enviado ao cliente: o link público passa a mostrar "cancelado" e os lembretes automáticos param.`);
  if (osAtivas.length) avisos.push(`Está vinculado à(s) OS ${lista(osAtivas.map((os) => os.chamadoNumero ?? os.numero))}. O vínculo é mantido (aparece como cancelado na OS).`);
  if (o.pedidosCompra.length) avisos.push(`Tem ${plural(o.pedidosCompra.length, "pedido de compra", "pedidos de compra")} vinculado(s) (${lista(o.pedidosCompra.map((p) => p.numero))}) — eles não são cancelados automaticamente.`);
  return { bloqueio: null, avisos };
}

/* ───────── Colaborador / técnico (inativar = ativo=false + status INATIVO) ───────── */
export async function impactoColaborador(id: string, empresaId: string): Promise<Impacto | null> {
  const t = await prisma.tecnico.findFirst({
    where: { id, empresaId },
    select: {
      email: true,
      equipesLideradas: { where: { status: "ATIVA" }, select: { nome: true } },
      equipesMembro: { where: { status: "ATIVA" }, select: { nome: true } },
      veiculosResponsavel: { where: { status: { not: "INATIVO" } }, select: { placa: true } },
      contratosRecorrencia: { where: { status: "ATIVO" }, select: { numero: true } },
      contratosResponsavel: { where: { status: "ATIVO" }, select: { numero: true } },
      clientesResponsavel: { where: { ativo: true }, select: { id: true } },
      atividadesOs: {
        where: { status: { notIn: ["CONCLUIDA", "CANCELADA"] as any }, ordemServico: { status: { notIn: ["CONCLUIDA", "CANCELADA"] } } },
        select: { ordemServico: { select: { numero: true, chamadoNumero: true } } },
      },
    },
  });
  if (!t) return null;
  const avisos: string[] = [];
  const os = [...new Set(t.atividadesOs.map((a) => a.ordemServico.chamadoNumero ?? a.ordemServico.numero))];
  if (os.length) avisos.push(`Tem ${plural(t.atividadesOs.length, "atividade em aberto", "atividades em aberto")} em ${plural(os.length, "OS", "OS")} (${lista(os)}). Elas continuam atribuídas a ele: reatribua a outro técnico nas OS.`);
  if (t.contratosRecorrencia.length) avisos.push(`É o técnico das OS recorrentes do(s) contrato(s) ${lista(t.contratosRecorrencia.map((c) => c.numero))}: as próximas OS geradas sairão sem técnico até você trocar no contrato.`);
  if (t.contratosResponsavel.length) avisos.push(`É responsável pelo(s) contrato(s) ${lista(t.contratosResponsavel.map((c) => c.numero))}.`);
  if (t.equipesLideradas.length) avisos.push(`Lidera a(s) equipe(s) ${lista(t.equipesLideradas.map((e) => e.nome))} — defina outro líder.`);
  if (t.equipesMembro.length) avisos.push(`Continua listado como membro de ${lista(t.equipesMembro.map((e) => e.nome))}.`);
  if (t.veiculosResponsavel.length) avisos.push(`É responsável pelo(s) veículo(s) ${lista(t.veiculosResponsavel.map((v) => v.placa))}.`);
  if (t.clientesResponsavel.length) avisos.push(`É o técnico responsável de ${plural(t.clientesResponsavel.length, "cliente", "clientes")}.`);
  if (t.email) {
    const usuario = await prisma.usuario.findFirst({ where: { empresaId, ativo: true, email: { equals: t.email, mode: "insensitive" } }, select: { id: true } });
    if (usuario) avisos.push(`Ele também é usuário do sistema (${t.email}). Inativar o colaborador NÃO bloqueia o login — para isso, inative o usuário em Configurações › Usuários.`);
  }
  return { bloqueio: null, avisos };
}

/* ───────── Equipe (inativar = status INATIVA) ───────── */
export async function impactoEquipe(id: string, empresaId: string): Promise<Impacto | null> {
  const e = await prisma.equipe.findFirst({
    where: { id, empresaId },
    select: {
      membros: { select: { id: true } },
      veiculos: { where: { status: { not: "INATIVO" } }, select: { placa: true } },
    },
  });
  if (!e) return null;
  const avisos: string[] = [];
  // A OS não guarda a equipe: o vínculo é pelo técnico de cada atividade
  const abertas = e.membros.length
    ? await prisma.ordemServico.count({
        where: {
          empresaId, status: { notIn: ["CONCLUIDA", "CANCELADA"] },
          atividades: { some: { tecnicoId: { in: e.membros.map((m) => m.id) }, status: { notIn: ["CONCLUIDA", "CANCELADA"] as any } } },
        },
      })
    : 0;
  if (abertas) avisos.push(`Os membros desta equipe têm ${plural(abertas, "OS em aberto", "OS em aberto")}. As OS são atribuídas aos técnicos (não à equipe), então nada muda nelas.`);
  if (e.membros.length) avisos.push(`${plural(e.membros.length, "membro continua", "membros continuam")} ativo(s) como colaborador(es); só o agrupamento é inativado.`);
  if (e.veiculos.length) avisos.push(`O(s) veículo(s) ${lista(e.veiculos.map((v) => v.placa))} continuam vinculados a esta equipe — troque a equipe no cadastro do veículo se for o caso.`);
  return { bloqueio: null, avisos };
}

/* ───────── Veículo (inativar = status INATIVO) ───────── */
export async function impactoVeiculo(id: string, empresaId: string): Promise<Impacto | null> {
  const v = await prisma.veiculo.findFirst({
    where: { id, empresaId },
    select: {
      responsavel: { select: { nome: true } },
      equipe: { select: { nome: true } },
      _count: { select: { checklists: true, manutencoes: true } },
    },
  });
  if (!v) return null;
  const pendentes = await prisma.checklistPreenchido.count({ where: { veiculoId: id, status: "PENDENTE" } });
  const avisos: string[] = [];
  if (pendentes) avisos.push(`Tem ${plural(pendentes, "checklist pendente", "checklists pendentes")}: ele(s) fica(m) como está(ão) e o veículo sai da lista de checklist.`);
  if (v._count.checklists || v._count.manutencoes)
    avisos.push(`O histórico (${plural(v._count.checklists, "checklist", "checklists")}, ${plural(v._count.manutencoes, "manutenção", "manutenções")}) é preservado.`);
  if (v.responsavel) avisos.push(`O responsável (${v.responsavel.nome}) continua vinculado.`);
  if (v.equipe) avisos.push(`Continua vinculado à equipe ${v.equipe.nome}.`);
  return { bloqueio: null, avisos };
}

/** Registra o motivo da inativação no campo de observações (interno) do cadastro. */
export function anotarInativacao(observacoes: string | null, usuario: string, motivo: string, acao = "Inativado"): string {
  const linha = `[${acao} em ${formatarData(new Date(), "dd/MM/yyyy HH:mm")} por ${usuario}]${motivo ? ` Motivo: ${motivo}` : ""}`;
  return observacoes?.trim() ? `${observacoes.trim()}\n${linha}` : linha;
}

export function lerMotivo(body: unknown): string {
  const m = (body as any)?.motivo;
  return typeof m === "string" ? m.trim().slice(0, 500) : "";
}
