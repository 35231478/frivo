import type { StatusContrato } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { motivoBloqueioInativacao } from "@/lib/os-server";
import { anotarInativacao, impactoColaborador, impactoEquipe, impactoOrcamento, impactoVeiculo } from "@/lib/inativacao-server";
import { gerarQrCodeEquipamento } from "@/lib/qrcode-server";
import { CADASTROS, type EntidadeCadastro } from "@/lib/cadastros/registro";
import { REGRAS, type Registro } from "@/lib/cadastros/especificos";
import type { Permissoes } from "@/lib/permissoes";

/**
 * Regras de inativar/reativar POR REGISTRO — a mesma função atende a ação individual (rotas
 * /api/<entidade>/[id]) e a ação em massa (/api/acoes-massa). Assim o lote nunca tem regra
 * diferente da tela de um registro só.
 *
 * Aqui NÃO se confere permissão (quem chama confere: a rota individual com o guard, o lote por
 * item). Toda busca filtra pelo empresaId recebido: id de outra empresa = "não encontrado".
 */

export interface ContextoItem {
  empresaId: string;
  usuarioId: string;
  usuarioNome: string;
  /** Texto que entra no histórico/observação (ex.: "Inativado em massa") */
  origem?: "individual" | "massa";
  motivo?: string;
  /** Papel e acessos de quem age (travas que dependem do ator: perfil/usuário com mais acesso que ele) */
  role?: string;
  permissoes?: Permissoes;
}

export type CodigoFalha = "nao_encontrado" | "sem_permissao" | "bloqueado" | "invalido" | "erro";

export type ResultadoItem =
  | { ok: true; detalhe?: string; dados?: Record<string, unknown> }
  | { ok: false; codigo: CodigoFalha; motivo: string };

export const ok = (detalhe?: string, dados?: Record<string, unknown>): ResultadoItem => ({ ok: true, detalhe, dados });
export const falha = (codigo: CodigoFalha, motivo: string): ResultadoItem => ({ ok: false, codigo, motivo });
const NAO_ENCONTRADO = falha("nao_encontrado", "Não encontrado (ou de outra empresa)");

/** HTTP para a rota individual (mantém os status de antes: 404 / 403 / 409 / 400). */
export function statusHttp(r: ResultadoItem) {
  if (r.ok) return 200;
  return { nao_encontrado: 404, sem_permissao: 403, bloqueado: 409, invalido: 400, erro: 500 }[r.codigo];
}

const sufixoMassa = (ctx: ContextoItem) => (ctx.origem === "massa" ? " (ação em massa)" : "");

/* ───────── Ordem de serviço: inativar = CANCELADA (não cancela OS que entrou no financeiro) ───────── */
export async function cancelarOs(id: string, ctx: ContextoItem, opts: { recusa?: boolean } = {}): Promise<ResultadoItem> {
  const os = await prisma.ordemServico.findFirst({ where: { id, empresaId: ctx.empresaId }, select: { id: true, status: true } });
  if (!os) return NAO_ENCONTRADO;
  if (os.status === "CANCELADA") return ok("Já estava cancelada");
  const bloqueio = await motivoBloqueioInativacao(id);
  if (bloqueio) return falha("bloqueado", bloqueio);
  await prisma.ordemServico.update({ where: { id }, data: { status: "CANCELADA" } });
  await prisma.osHistorico.create({
    data: {
      ordemServicoId: id, usuarioId: ctx.usuarioId,
      acao: opts.recusa ? "Solicitação recusada" : `OS inativada (cancelada)${sufixoMassa(ctx)}`,
      detalhes: `${os.status} → CANCELADA${ctx.motivo ? ` — Motivo: ${ctx.motivo}` : ""}`,
    },
  });
  return ok();
}

/* ───────── Equipamento: ativo true/false ───────── */
export async function definirAtivoEquipamento(id: string, ativo: boolean, ctx: ContextoItem): Promise<ResultadoItem> {
  const e = await prisma.equipamento.findFirst({ where: { id, empresaId: ctx.empresaId }, select: { ativo: true } });
  if (!e) return NAO_ENCONTRADO;
  if (e.ativo === ativo) return ok(ativo ? "Já estava ativo" : "Já estava inativo");
  await prisma.equipamento.update({ where: { id }, data: { ativo } });
  return ok();
}

/** Gera (e vincula) um QR para o equipamento; se já tiver, só devolve o QR existente. */
export async function gerarQrEquipamento(id: string, ctx: ContextoItem): Promise<ResultadoItem> {
  const e = await prisma.equipamento.findFirst({ where: { id, empresaId: ctx.empresaId }, select: { qrcode: { select: { id: true, codigo: true } } } });
  if (!e) return NAO_ENCONTRADO;
  if (e.qrcode) return ok(`Já tinha o QR ${e.qrcode.codigo}`, { qrcodeId: e.qrcode.id });
  const qr = await gerarQrCodeEquipamento(ctx.empresaId, id);
  return ok(`QR ${qr.codigo} gerado`, { qrcodeId: qr.id });
}

/* ───────── Cadastros padronizados (produtos, serviços, cargos, categorias): ativo true/false ─────────
 * Única função de ativar/inativar desses cadastros: a usam a rota genérica /api/cadastros, as rotas
 * antigas (/api/produtos…) e as ações em massa. Nunca apaga: só ativo=false. */
type DelegateAtivo = {
  findFirst: (a: { where: { id: string; empresaId: string } }) => Promise<(Record<string, unknown> & { id: string; ativo: boolean }) | null>;
  update: (a: { where: { id: string }; data: { ativo: boolean } }) => Promise<unknown>;
};
export async function definirAtivoCadastro(entidade: EntidadeCadastro, id: string, ativo: boolean, ctx: ContextoItem): Promise<ResultadoItem> {
  const tabela = (prisma as unknown as Record<string, DelegateAtivo>)[CADASTROS[entidade].modelo];
  const r = await tabela.findFirst({ where: { id, empresaId: ctx.empresaId } });
  if (!r) return NAO_ENCONTRADO;
  if (r.ativo === ativo) return ok(ativo ? "Já estava ativo" : "Já estava inativo");
  // Travas do cadastro (perfil padrão, o próprio usuário, último admin…): nunca puladas, nem em massa
  const bloqueio = await verificarAtivoCadastro(entidade, r, ativo, ctx);
  if (bloqueio) return falha("bloqueado", bloqueio);
  await tabela.update({ where: { id }, data: { ativo } });
  return ok();
}

/** O que impede mudar o `ativo` deste registro (null = pode). Sem acessos no contexto, trava (seguro). */
export async function verificarAtivoCadastro(entidade: EntidadeCadastro, registro: Registro, ativo: boolean, ctx: ContextoItem) {
  const regra = REGRAS[entidade]?.bloqueioAtivo;
  if (!regra) return null;
  return regra(registro, ativo, { id: ctx.usuarioId, empresaId: ctx.empresaId, role: ctx.role, permissoes: ctx.permissoes ?? {} });
}

/* ───────── Cliente: ativo true/false ───────── */
export async function definirAtivoCliente(id: string, ativo: boolean, ctx: ContextoItem): Promise<ResultadoItem> {
  const c = await prisma.cliente.findFirst({ where: { id, empresaId: ctx.empresaId }, select: { ativo: true } });
  if (!c) return NAO_ENCONTRADO;
  if (c.ativo === ativo) return ok(ativo ? "Já estava ativo" : "Já estava inativo");
  await prisma.cliente.update({ where: { id }, data: { ativo } });
  return ok();
}

/* ───────── Orçamento: inativar = CANCELADO (com bloqueios); reativar = RASCUNHO ───────── */
export async function cancelarOrcamento(id: string, ctx: ContextoItem): Promise<ResultadoItem> {
  const o = await prisma.orcamento.findFirst({ where: { id, empresaId: ctx.empresaId }, select: { status: true } });
  if (!o) return NAO_ENCONTRADO;
  if (o.status === "CANCELADO") return ok("Já estava cancelado");
  const impacto = await impactoOrcamento(id, ctx.empresaId);
  if (impacto?.bloqueio) return falha("bloqueado", impacto.bloqueio);
  await prisma.orcamento.update({ where: { id }, data: { status: "CANCELADO", lembretesAtivos: false } });
  return ok();
}

export async function reativarOrcamento(id: string, ctx: ContextoItem): Promise<ResultadoItem> {
  const o = await prisma.orcamento.findFirst({ where: { id, empresaId: ctx.empresaId }, select: { status: true } });
  if (!o) return NAO_ENCONTRADO;
  if (o.status !== "CANCELADO") return ok("Não estava cancelado", { status: o.status });
  await prisma.orcamento.update({ where: { id }, data: { status: "RASCUNHO" } });
  return ok(undefined, { status: "RASCUNHO" });
}

/* ───────── Contrato: troca de status com histórico (mesma regra da tela do contrato) ───────── */
export async function mudarStatusContrato(id: string, novo: StatusContrato, ctx: ContextoItem): Promise<ResultadoItem> {
  const c = await prisma.contrato.findFirst({ where: { id, empresaId: ctx.empresaId }, select: { status: true } });
  if (!c) return NAO_ENCONTRADO;
  if (c.status === novo) return falha("invalido", "O contrato já está neste status.");
  const [, historico] = await prisma.$transaction([
    prisma.contrato.update({ where: { id }, data: { status: novo } }),
    prisma.contratoHistoricoStatus.create({
      data: { empresaId: ctx.empresaId, contratoId: id, statusAnterior: c.status, statusNovo: novo, motivo: ctx.motivo || null, usuarioId: ctx.usuarioId },
      include: { usuario: { select: { id: true, nome: true } } },
    }),
  ]);
  return ok(undefined, { historico });
}

/** Em massa, "inativar" contrato = SUSPENDER (reversível). Encerrado/cancelado não muda. */
export async function suspenderContrato(id: string, ctx: ContextoItem): Promise<ResultadoItem> {
  const c = await prisma.contrato.findFirst({ where: { id, empresaId: ctx.empresaId }, select: { status: true } });
  if (!c) return NAO_ENCONTRADO;
  if (c.status === "SUSPENSO") return ok("Já estava suspenso");
  if (c.status === "ENCERRADO" || c.status === "CANCELADO")
    return falha("bloqueado", `Contrato ${c.status === "ENCERRADO" ? "encerrado" : "cancelado"}: não dá para suspender.`);
  return mudarStatusContrato(id, "SUSPENSO", { ...ctx, motivo: ctx.motivo || `Suspenso${sufixoMassa(ctx)}` });
}

/** Em massa, "reativar" contrato = SUSPENSO → ATIVO. Encerrado/cancelado só pela tela do contrato. */
export async function reativarContrato(id: string, ctx: ContextoItem): Promise<ResultadoItem> {
  const c = await prisma.contrato.findFirst({ where: { id, empresaId: ctx.empresaId }, select: { status: true } });
  if (!c) return NAO_ENCONTRADO;
  if (c.status === "ATIVO") return ok("Já estava ativo");
  if (c.status !== "SUSPENSO")
    return falha("bloqueado", `Só contratos suspensos são reativados em massa (este está ${c.status.toLowerCase().replace(/_/g, " ")}). Altere pela tela do contrato.`);
  return mudarStatusContrato(id, "ATIVO", { ...ctx, motivo: ctx.motivo || `Reativado${sufixoMassa(ctx)}` });
}

/* ───────── Veículo: inativar = INATIVO (+ anotação); reativar = ATIVO ───────── */
export async function inativarVeiculo(id: string, ctx: ContextoItem): Promise<ResultadoItem> {
  const v = await prisma.veiculo.findFirst({ where: { id, empresaId: ctx.empresaId }, select: { status: true, observacoes: true } });
  if (!v) return NAO_ENCONTRADO;
  if (v.status === "INATIVO") return ok("Já estava inativo");
  const impacto = await impactoVeiculo(id, ctx.empresaId);
  if (impacto?.bloqueio) return falha("bloqueado", impacto.bloqueio);
  await prisma.veiculo.update({
    where: { id },
    data: { status: "INATIVO", observacoes: anotarInativacao(v.observacoes, ctx.usuarioNome, ctx.motivo ?? "", `Inativado${sufixoMassa(ctx)}`) },
  });
  return ok();
}

export async function reativarVeiculo(id: string, ctx: ContextoItem): Promise<ResultadoItem> {
  const v = await prisma.veiculo.findFirst({ where: { id, empresaId: ctx.empresaId }, select: { status: true } });
  if (!v) return NAO_ENCONTRADO;
  if (v.status !== "INATIVO") return ok("Já estava ativo");
  await prisma.veiculo.update({ where: { id }, data: { status: "ATIVO" } });
  return ok();
}

/* ───────── Colaborador: inativar = ativo false + INATIVO (+ anotação); reativar = ATIVO ───────── */
export async function inativarColaborador(id: string, ctx: ContextoItem): Promise<ResultadoItem> {
  const t = await prisma.tecnico.findFirst({ where: { id, empresaId: ctx.empresaId }, select: { ativo: true, observacoes: true } });
  if (!t) return NAO_ENCONTRADO;
  if (!t.ativo) return ok("Já estava inativo");
  const impacto = await impactoColaborador(id, ctx.empresaId);
  if (impacto?.bloqueio) return falha("bloqueado", impacto.bloqueio);
  await prisma.tecnico.update({
    where: { id },
    data: { ativo: false, statusColaborador: "INATIVO", observacoes: anotarInativacao(t.observacoes, ctx.usuarioNome, ctx.motivo ?? "", `Inativado${sufixoMassa(ctx)}`) },
  });
  return ok();
}

export async function reativarColaborador(id: string, ctx: ContextoItem): Promise<ResultadoItem> {
  const t = await prisma.tecnico.findFirst({ where: { id, empresaId: ctx.empresaId }, select: { ativo: true } });
  if (!t) return NAO_ENCONTRADO;
  if (t.ativo) return ok("Já estava ativo");
  await prisma.tecnico.update({ where: { id }, data: { ativo: true, statusColaborador: "ATIVO" } });
  return ok();
}

/* ───────── Equipe: inativar = status INATIVA (+ anotação); reativar = ATIVA ─────────
 * Única função: botão Inativar (DELETE), select de status do formulário (PUT) e reativar (PATCH). */
export async function inativarEquipe(id: string, ctx: ContextoItem): Promise<ResultadoItem> {
  const e = await prisma.equipe.findFirst({ where: { id, empresaId: ctx.empresaId }, select: { status: true, observacoes: true } });
  if (!e) return NAO_ENCONTRADO;
  if (e.status === "INATIVA") return ok("Já estava inativa");
  const impacto = await impactoEquipe(id, ctx.empresaId);
  if (impacto?.bloqueio) return falha("bloqueado", impacto.bloqueio);
  await prisma.equipe.update({
    where: { id },
    data: { status: "INATIVA", observacoes: anotarInativacao(e.observacoes, ctx.usuarioNome, ctx.motivo ?? "", `Inativada${sufixoMassa(ctx)}`) },
  });
  return ok();
}

export async function reativarEquipe(id: string, ctx: ContextoItem): Promise<ResultadoItem> {
  const e = await prisma.equipe.findFirst({ where: { id, empresaId: ctx.empresaId }, select: { status: true } });
  if (!e) return NAO_ENCONTRADO;
  if (e.status === "ATIVA") return ok("Já estava ativa");
  await prisma.equipe.update({ where: { id }, data: { status: "ATIVA" } });
  return ok();
}
