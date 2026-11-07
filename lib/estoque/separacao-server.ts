import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { movimentar } from "@/lib/estoque/servidor";
import { arred, situacaoEstoque, type Situacao } from "@/lib/estoque/regras";
import { faltaSeparar, planoSeparacao, precisaSeparar, resumoSeparacao, situacaoDoMaterial, type EstadoSeparacao, type MaterialSeparavel, type SituacaoMaterial } from "@/lib/estoque/separacao";

/**
 * Estoque E4.1 — separação de material da OS, lado do banco: a fila "A separar", os materiais de uma OS com o saldo
 * disponível de cada produto, e a separação em si (RESERVA no razão da E1 + estado por material na os_materiais,
 * tudo na MESMA transação). A regra é a pura (lib/estoque/separacao). Empresa sempre da sessão.
 */

/** Regra de negócio recusada (vira 400 na API). */
export class ErroSeparacao extends Error {}

/** A fila é das OS vivas: concluída/cancelada não pede separação (o estado continua visível na OS). */
export const STATUS_FORA_DA_FILA = ["CONCLUIDA", "CANCELADA"] as const;

const SELECT_MATERIAL = {
  id: true, osItemId: true, produtoId: true, descricao: true, unidade: true, comportamento: true, quantidade: true, kitNome: true, ordem: true,
  quantidadeSeparada: true, estadoSeparacao: true, separadoEm: true,
  separadoPor: { select: { nome: true } },
  produto: { select: { nome: true, saldo: true, estoqueMinimo: true, controlaEstoque: true } },
  item: { select: { descricao: true, ordem: true } },
} as const;
type MaterialBanco = Prisma.OsMaterialGetPayload<{ select: typeof SELECT_MATERIAL }>;

export interface MaterialSeparacaoTela extends MaterialSeparavel {
  osItemId: string;
  item: string;
  kitNome: string | null;
  comportamento: "VENDA_A_PARTE" | "INCLUSO_NO_SERVICO";
  falta: number;
  situacao: SituacaoMaterial;
  separadoEm: string | null;
  separadoPor: string | null;
  /** Saldo disponível do produto (null = produto saiu do cadastro) */
  saldo: number | null;
  situacaoSaldo: Situacao | null;
}

export const paraSeparavel = (m: { id: string; produtoId: string | null; descricao: string; unidade: string; quantidade: unknown; quantidadeSeparada: unknown; estadoSeparacao: EstadoSeparacao | null }): MaterialSeparavel => ({
  id: m.id, produtoId: m.produtoId, descricao: m.descricao, unidade: m.unidade,
  quantidade: arred(Number(m.quantidade)), quantidadeSeparada: arred(Number(m.quantidadeSeparada)), estadoSeparacao: m.estadoSeparacao,
});

export function materialParaTela(m: MaterialBanco): MaterialSeparacaoTela {
  const s = paraSeparavel(m);
  const saldo = m.produto ? arred(Number(m.produto.saldo)) : null;
  return {
    ...s, osItemId: m.osItemId, item: m.item.descricao, kitNome: m.kitNome, comportamento: m.comportamento,
    falta: faltaSeparar(s), situacao: situacaoDoMaterial(s), separadoEm: m.separadoEm?.toISOString() ?? null, separadoPor: m.separadoPor?.nome ?? null,
    saldo, situacaoSaldo: m.produto ? situacaoEstoque(saldo!, m.produto.estoqueMinimo) : null,
  };
}

const ordemMaterial = (a: MaterialBanco, b: MaterialBanco) => a.item.ordem - b.item.ordem || a.osItemId.localeCompare(b.osItemId) || a.ordem - b.ordem || a.id.localeCompare(b.id);

/* ───────── Fila "A separar" ───────── */
export interface OsNaFila {
  id: string; numero: string; chamadoNumero: string | null; status: string; descricao: string; previsaoConclusao: Date | null; criadoEm: Date;
  cliente: string; unidade: string | null;
  /** Quantos materiais ainda têm o que separar, de quantos físicos */
  aSeparar: number; total: number; parciais: number;
  /** Os primeiros que faltam (para a lista bater o olho) */
  faltam: { descricao: string; falta: number; unidade: string }[];
}

/**
 * Toda OS viva com material (produto) ainda não separado por inteiro entra sozinha; sai quando tudo foi separado.
 * Ordem: previsão mais próxima primeiro (sem previsão por último), depois a mais antiga.
 */
export async function filaSeparacao(empresaId: string): Promise<OsNaFila[]> {
  const materiais = await prisma.osMaterial.findMany({
    where: { ordemServico: { empresaId, status: { notIn: [...STATUS_FORA_DA_FILA] } }, produtoId: { not: null }, quantidade: { gt: 0 }, OR: [{ estadoSeparacao: null }, { estadoSeparacao: "SEPARADO" }] },
    select: {
      id: true, produtoId: true, descricao: true, unidade: true, quantidade: true, quantidadeSeparada: true, estadoSeparacao: true, ordem: true,
      ordemServico: { select: { id: true, numero: true, chamadoNumero: true, status: true, descricao: true, previsaoConclusao: true, criadoEm: true, cliente: { select: { nome: true, nomeFantasia: true } }, unidade: { select: { nome: true } } } },
    },
    orderBy: [{ ordemServicoId: "asc" }, { ordem: "asc" }, { id: "asc" }],
  });
  const porOs = new Map<string, OsNaFila>();
  for (const m of materiais) {
    const s = paraSeparavel(m);
    const os = m.ordemServico;
    const linha = porOs.get(os.id) ?? {
      id: os.id, numero: os.numero, chamadoNumero: os.chamadoNumero, status: os.status, descricao: os.descricao, previsaoConclusao: os.previsaoConclusao, criadoEm: os.criadoEm,
      cliente: os.cliente.nomeFantasia || os.cliente.nome, unidade: os.unidade?.nome ?? null, aSeparar: 0, total: 0, parciais: 0, faltam: [],
    };
    linha.total++;
    if (precisaSeparar(s)) {
      linha.aSeparar++;
      if (s.quantidadeSeparada > 0) linha.parciais++;
      if (linha.faltam.length < 3) linha.faltam.push({ descricao: s.descricao, falta: faltaSeparar(s), unidade: s.unidade });
    }
    porOs.set(os.id, linha);
  }
  return [...porOs.values()].filter((o) => o.aSeparar > 0).sort((a, b) => {
    const pa = a.previsaoConclusao?.getTime() ?? Infinity, pb = b.previsaoConclusao?.getTime() ?? Infinity;
    return pa - pb || a.criadoEm.getTime() - b.criadoEm.getTime() || a.numero.localeCompare(b.numero);
  });
}

/** Quantas OS estão na fila (o sino de quem tem "Estoque › Separar material"). */
export async function contarFilaSeparacao(empresaId: string): Promise<number> {
  return (await filaSeparacao(empresaId)).length;
}

/* ───────── Materiais de uma OS ───────── */
export interface SeparacaoDaOs {
  os: { id: string; numero: string; chamadoNumero: string | null; status: string; descricao: string; previsaoConclusao: string | null; cliente: string; unidade: string | null };
  materiais: MaterialSeparacaoTela[];
  resumo: ReturnType<typeof resumoSeparacao>;
}

/** null = OS não é da empresa (a rota responde 404). */
export async function separacaoDaOs(empresaId: string, osId: string): Promise<SeparacaoDaOs | null> {
  const os = await prisma.ordemServico.findFirst({
    where: { id: osId, empresaId },
    select: { id: true, numero: true, chamadoNumero: true, status: true, descricao: true, previsaoConclusao: true, cliente: { select: { nome: true, nomeFantasia: true } }, unidade: { select: { nome: true } } },
  });
  if (!os) return null;
  const materiais = (await prisma.osMaterial.findMany({ where: { ordemServicoId: osId, quantidade: { gt: 0 } }, select: SELECT_MATERIAL })).sort(ordemMaterial).map(materialParaTela);
  return {
    os: { id: os.id, numero: os.numero, chamadoNumero: os.chamadoNumero, status: os.status, descricao: os.descricao, previsaoConclusao: os.previsaoConclusao?.toISOString() ?? null, cliente: os.cliente.nomeFantasia || os.cliente.nome, unidade: os.unidade?.nome ?? null },
    materiais, resumo: resumoSeparacao(materiais),
  };
}

/* ───────── Separar / desfazer ───────── */
export interface ResultadoSeparacao { separacao: SeparacaoDaOs; avisos: string[]; movimentos: number }

/**
 * Leva cada material ao alvo informado, na MESMA transação: a RESERVA (ou o estorno) no razão — `movimentar` da E1
 * tranca a linha do produto (UPDATE … saldo + 0 = FOR UPDATE): duas separações simultâneas do mesmo produto entram
 * em fila e nenhuma reserva se perde — e o estado por material (quantidade separada, quem, quando). Saldo que não
 * cobre NÃO trava: a reserva é feita e volta um aviso (coerente com a E1). Material de outra OS/empresa = recusado.
 * null = OS não é da empresa.
 */
export async function separarMateriais(empresaId: string, osId: string, usuarioId: string, alvos: { id: string; quantidade: number }[]): Promise<ResultadoSeparacao | null> {
  const ids = alvos.map((a) => a.id);
  if (new Set(ids).size !== ids.length) throw new ErroSeparacao("Material repetido no pedido.");
  const feito = await prisma.$transaction(async (tx) => {
    const os = await tx.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { id: true, numero: true, chamadoNumero: true } });
    if (!os) return null;
    const materiais = await tx.osMaterial.findMany({ where: { id: { in: ids }, ordemServicoId: osId }, select: SELECT_MATERIAL });
    if (materiais.length !== ids.length) throw new ErroSeparacao("Material não pertence a esta OS.");
    const alvoDe = new Map(alvos.map((a) => [a.id, a.quantidade]));
    const avisos: string[] = [];
    const feitos: string[] = [];
    let movimentos = 0;
    const agora = new Date();
    // Ordem fixa (produto, id): duas separações com os mesmos produtos trancam na mesma ordem — sem deadlock
    for (const m of [...materiais].sort((a, b) => (a.produtoId ?? "").localeCompare(b.produtoId ?? "") || a.id.localeCompare(b.id))) {
      const plano = planoSeparacao(paraSeparavel(m), alvoDe.get(m.id)!);
      if (!plano.ok) throw new ErroSeparacao(`${m.descricao}: ${plano.erro}`);
      if (plano.delta === 0 && plano.estado === m.estadoSeparacao) continue;
      if (plano.delta !== 0) {
        const r = await movimentar({
          empresaId, produtoId: m.produtoId!, operacao: plano.delta < 0 ? "RESERVA" : "ESTORNO_RESERVA", valor: Math.abs(plano.delta), usuarioId, refId: osId,
          observacao: `${plano.delta < 0 ? "Separação" : "Separação desfeita"} — OS ${os.chamadoNumero ?? os.numero} · ${m.descricao}`,
        }, tx);
        movimentos++;
        if (r.aviso) avisos.push(`${m.descricao}: ${r.aviso}`);
      }
      await tx.osMaterial.update({
        where: { id: m.id },
        data: { quantidadeSeparada: plano.quantidadeSeparada, estadoSeparacao: plano.estado, separadoEm: plano.estado ? agora : null, separadoPorId: plano.estado ? usuarioId : null },
      });
      feitos.push(`${m.descricao}: ${plano.quantidadeSeparada} ${m.unidade}${plano.quantidadeSeparada < arred(Number(m.quantidade)) ? ` de ${arred(Number(m.quantidade))}` : ""}`);
    }
    if (feitos.length) {
      const desfez = alvos.every((a) => a.quantidade === 0);
      await tx.osHistorico.create({ data: { ordemServicoId: osId, usuarioId, acao: desfez ? "Separação de material desfeita" : "Material separado", detalhes: feitos.join("; ").slice(0, 1000) } });
    }
    return { avisos, movimentos };
  });
  if (!feito) return null;
  const separacao = (await separacaoDaOs(empresaId, osId))!;
  return { separacao, ...feito };
}

/** Há material separado (reservado) para este item da OS? Editar/apagar o item apagaria o snapshot e deixaria a reserva órfã. */
export async function itemTemMaterialSeparado(itemId: string): Promise<boolean> {
  return (await prisma.osMaterial.count({ where: { osItemId: itemId, quantidadeSeparada: { gt: 0 } } })) > 0;
}
export const ERRO_ITEM_SEPARADO = "Há material separado para este item: desfaça a separação (Estoque › A separar) antes de alterar.";
