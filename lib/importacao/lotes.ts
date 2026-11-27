/**
 * Lotes de importação (Implantação, leva 5) — servidor: listar, prévia do desfazer e desfazer.
 *
 * O "em uso" vem do PRÓPRIO schema (Prisma DMMF): toda relação que aponta para o registro (OS, orçamento, contrato,
 * movimentação, QR, foto, documento…) conta. Nada é apagado se tiver vínculo fora do que o próprio desfazer apaga —
 * e várias dessas relações apagam em cascata, por isso a conta é feita antes e de novo na hora de apagar.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Acao } from "@/lib/permissoes";
import {
  CADASTROS_DO_LOTE, motivoVinculo, ordemDeApagar, podeDesfazerCadastro, pontoFixo, semPermissao, TOLERANCIA_ALTERADO_MS,
} from "@/lib/importacao/lotes-regras";

type Db = Prisma.TransactionClient | typeof prisma;
type Delegate = {
  findMany: (a: unknown) => Promise<Record<string, unknown>[]>;
  deleteMany: (a: unknown) => Promise<{ count: number }>;
};
const delegate = (db: Db, entidade: string) => (db as unknown as Record<string, Delegate>)[CADASTROS_DO_LOTE[entidade].delegate];

/* ───────── Relações de uso, lidas do schema ───────── */
type Relacao = { campo: string; tipo: string; lista: boolean };
const cacheRelacoes = new Map<string, { relacoes: Relacao[]; temAtualizadoEm: boolean }>();
/** As relações que APONTAM para o model (o lado sem a chave estrangeira) e se ele tem `atualizadoEm` */
export function relacoesDeUso(model: string) {
  let r = cacheRelacoes.get(model);
  if (!r) {
    const m = Prisma.dmmf.datamodel.models.find((x) => x.name === model);
    if (!m) throw new Error(`Model ${model} não existe no schema`);
    r = {
      relacoes: m.fields.filter((f) => f.kind === "object" && !f.relationFromFields?.length).map((f) => ({ campo: f.name, tipo: f.type, lista: f.isList })),
      temAtualizadoEm: m.fields.some((f) => f.name === "atualizadoEm"),
    };
    cacheRelacoes.set(model, r);
  }
  return r;
}
const ENTIDADE_DO_MODEL: Record<string, string> = Object.fromEntries(Object.entries(CADASTROS_DO_LOTE).map(([k, v]) => [v.model, k]));

/**
 * Motivos para NÃO apagar cada registro: vínculos fora de `apagando` (as chaves "entidade:id" que o desfazer vai
 * apagar junto) e alteração depois da importação.
 */
async function motivosDeUso(db: Db, entidade: string, ids: string[], empresaId: string, apagando: Set<string>, loteEm: Date | null) {
  const { relacoes: todas, temAtualizadoEm } = relacoesDeUso(CADASTROS_DO_LOTE[entidade].model);
  const ignorar = CADASTROS_DO_LOTE[entidade].ignorar ?? [];
  const relacoes = todas.filter((r) => !ignorar.includes(r.campo));
  const excluidos = (tipo: string) => {
    const ent = ENTIDADE_DO_MODEL[tipo];
    return ent ? [...apagando].filter((k) => k.startsWith(`${ent}:`)).map((k) => k.slice(ent.length + 1)) : [];
  };
  const listas = relacoes.filter((r) => r.lista);
  const select: Record<string, unknown> = { id: true, ...(temAtualizadoEm && { atualizadoEm: true }), ...(entidade === "unidades" && { principal: true, clienteId: true }) };
  if (listas.length)
    select._count = { select: Object.fromEntries(listas.map((r) => { const ex = excluidos(r.tipo); return [r.campo, ex.length ? { where: { id: { notIn: ex } } } : true]; })) };
  for (const r of relacoes.filter((x) => !x.lista)) select[r.campo] = true;
  const linhas = await delegate(db, entidade).findMany({ where: { id: { in: ids }, empresaId }, select });
  const saida = new Map<string, string[]>();
  for (const l of linhas) {
    const motivos: string[] = [];
    const cont = (l._count ?? {}) as Record<string, number>;
    for (const r of listas) if (cont[r.campo] > 0) motivos.push(motivoVinculo(r.campo, cont[r.campo]));
    for (const r of relacoes.filter((x) => !x.lista)) if (l[r.campo]) motivos.push(motivoVinculo(r.campo, null));
    const alterado = l.atualizadoEm as Date | undefined;
    if (alterado && loteEm && alterado.getTime() > loteEm.getTime() + TOLERANCIA_ALTERADO_MS)
      motivos.push("alterado depois desta importação (pela tela ou por outra planilha)");
    // A unidade principal é o endereço do cliente: só sai junto com ele
    if (entidade === "unidades" && l.principal && !apagando.has(`clientes:${l.clienteId}`))
      motivos.push("é a unidade principal de um cliente que fica");
    saida.set(String(l.id), motivos);
  }
  return saida;
}

/* ───────── Rótulos ───────── */
const ROTULOS: Record<string, { select: Record<string, unknown>; texto: (r: Record<string, any>) => string }> = {
  clientes: { select: { nome: true }, texto: (r) => r.nome },
  unidades: { select: { nome: true, cliente: { select: { nome: true } } }, texto: (r) => `${r.nome} — ${r.cliente?.nome ?? ""}` },
  contatos: { select: { nome: true, cliente: { select: { nome: true } } }, texto: (r) => `${r.nome} — ${r.cliente?.nome ?? ""}` },
  equipamentos: { select: { marca: true, modelo: true, localizacao: true }, texto: (r) => [r.marca, r.modelo].filter(Boolean).join(" ") + (r.localizacao ? ` — ${r.localizacao}` : "") },
  fornecedores: { select: { nome: true }, texto: (r) => r.nome },
  servicos: { select: { nome: true }, texto: (r) => r.nome },
  produtos: { select: { nome: true }, texto: (r) => r.nome },
  colaboradores: { select: { nome: true }, texto: (r) => r.nome },
  veiculos: { select: { placa: true, modelo: true }, texto: (r) => `${r.placa} — ${r.modelo}` },
  cargos: { select: { nome: true }, texto: (r) => r.nome },
  tiposEquipamento: { select: { nome: true }, texto: (r) => r.nome },
  contratos: { select: { numero: true, cliente: { select: { nome: true } } }, texto: (r) => `${r.numero} — ${r.cliente?.nome ?? ""}` },
  pmocs: { select: { nome: true, cliente: { select: { nome: true } } }, texto: (r) => `${r.nome} — ${r.cliente?.nome ?? ""}` },
};

export interface ItemDesfazer { entidade: string; id: string; rotulo: string; linha: number | null }
export interface PreviaDesfazer {
  lote: { id: string; entidade: string; arquivo: string; criadoEm: string; criados: number; atualizados: number; desfeitoEm: string | null };
  /** O que o desfazer APAGA (criado pelo lote, sem uso) */
  apagar: ItemDesfazer[];
  /** O que o lote criou e FICA, com o motivo */
  ficam: (ItemDesfazer & { motivos: string[] })[];
  /** O que o lote só ATUALIZOU: nunca é desfeito */
  atualizados: ItemDesfazer[];
  /** Criados que já não existem (apagados antes, por outro desfazer ou pela tela) */
  naoExistem: ItemDesfazer[];
  /** Um aviso do tipo de planilha (ex.: estoque não se desfaz por aqui) */
  nota?: string;
}

const NOTA_ESTOQUE = "Os lançamentos de estoque nunca são apagados (o extrato do estoque não se reescreve). Para corrigir um saldo, importe a planilha de novo com o saldo certo: ela lança só a diferença.";

type Ctx = { empresaId: string; pode: (m: string, a: Acao) => boolean; temModulo: (m: string) => boolean };

async function rotulos(entidade: string, ids: string[], empresaId: string, db: Db = prisma) {
  const r = ROTULOS[entidade];
  if (!r || !ids.length) return new Map<string, string>();
  const linhas = await delegate(db, entidade).findMany({ where: { id: { in: ids }, empresaId }, select: { id: true, ...r.select } });
  return new Map(linhas.map((l) => [String(l.id), r.texto(l as Record<string, any>)]));
}

/** A prévia do desfazer: o que apaga, o que fica (e por quê), o que o lote só atualizou. Nada é gravado. */
export async function previaDesfazer(loteId: string, ctx: Ctx, db: Db = prisma): Promise<PreviaDesfazer | null> {
  const lote = await db.importacaoLote.findFirst({ where: { id: loteId, empresaId: ctx.empresaId }, include: { itens: true } });
  if (!lote) return null;
  const porEntidade = new Map<string, string[]>();
  for (const it of lote.itens) porEntidade.set(it.entidade, [...(porEntidade.get(it.entidade) ?? []), it.registroId]);
  const nomes = new Map<string, string>();
  for (const [ent, ids] of porEntidade) for (const [id, t] of await rotulos(ent, ids, ctx.empresaId, db)) nomes.set(`${ent}:${id}`, t);
  const item = (it: { entidade: string; registroId: string; linha: number | null }): ItemDesfazer =>
    ({ entidade: it.entidade, id: it.registroId, rotulo: nomes.get(`${it.entidade}:${it.registroId}`) ?? "(não existe mais)", linha: it.linha });

  const atualizados = lote.itens.filter((i) => i.acao === "ATUALIZADO").map(item);
  const criados = lote.itens.filter((i) => i.acao === "CRIADO" && !i.desfeitoEm);
  const naoExistem = criados.filter((i) => !nomes.has(`${i.entidade}:${i.registroId}`)).map(item);
  const ficam: (ItemDesfazer & { motivos: string[] })[] = [];
  const candidatos: string[] = [];
  for (const it of criados) {
    if (!nomes.has(`${it.entidade}:${it.registroId}`)) continue;
    const cad = CADASTROS_DO_LOTE[it.entidade];
    if (!cad) { ficam.push({ ...item(it), motivos: ["cadastro que o desfazer não apaga"] }); continue; }
    if (cad.modulo && !ctx.temModulo(cad.modulo)) { ficam.push({ ...item(it), motivos: [`o módulo de ${cad.plural} está desligado`] }); continue; }
    if (!podeDesfazerCadastro(it.entidade, ctx.pode)) { ficam.push({ ...item(it), motivos: [semPermissao(it.entidade)] }); continue; }
    candidatos.push(`${it.entidade}:${it.registroId}`);
  }
  const { apagar, ficam: emUso } = await pontoFixo(candidatos, async (restantes) => {
    const m = new Map<string, string[]>();
    const grupos = new Map<string, string[]>();
    for (const k of restantes) { const [ent, id] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)]; grupos.set(ent, [...(grupos.get(ent) ?? []), id]); }
    for (const [ent, ids] of grupos)
      for (const [id, ms] of await motivosDeUso(db, ent, ids, ctx.empresaId, restantes, lote.criadoEm)) m.set(`${ent}:${id}`, ms);
    return m;
  });
  const porChave = new Map(criados.map((i) => [`${i.entidade}:${i.registroId}`, i]));
  for (const [k, ms] of emUso) ficam.push({ ...item(porChave.get(k)!), motivos: ms });
  const porLinha = (a: ItemDesfazer, b: ItemDesfazer) => (a.linha ?? 0) - (b.linha ?? 0);
  return {
    lote: {
      id: lote.id, entidade: lote.entidade, arquivo: lote.arquivo, criadoEm: lote.criadoEm.toISOString(), criados: lote.criados,
      atualizados: lote.atualizados, desfeitoEm: lote.desfeitoEm?.toISOString() ?? null,
    },
    apagar: ordemDeApagar([...apagar].map((k) => item(porChave.get(k)!))),
    ficam: ficam.sort(porLinha),
    atualizados: atualizados.sort(porLinha),
    naoExistem,
    ...(lote.entidade === "estoque" && { nota: NOTA_ESTOQUE }),
  };
}

export interface ResultadoDesfazer { apagados: number; ficam: (ItemDesfazer & { motivos: string[] })[]; atualizados: number }

/** Tabela de cada cadastro (para travar as linhas) */
const tabelaDo = (entidade: string) => Prisma.dmmf.datamodel.models.find((m) => m.name === CADASTROS_DO_LOTE[entidade].model)?.dbName;

/**
 * Desfaz o lote numa transação só, tudo ou nada:
 *  1. trava (FOR UPDATE) as linhas que o lote criou e ainda existem — enquanto isso, nada novo consegue se ligar a
 *     elas (uma OS, uma interação…), nem mesmo as relações que apagariam em cascata;
 *  2. recalcula a prévia DENTRO da transação (o que passou a ser usado depois da prévia que a pessoa viu, fica);
 *  3. apaga filhos antes dos pais. O que o lote só atualizou nunca é tocado.
 */
export async function desfazerLote(loteId: string, ctx: Ctx & { usuarioId: string | null }): Promise<ResultadoDesfazer | null> {
  const existe = await prisma.importacaoLote.findFirst({ where: { id: loteId, empresaId: ctx.empresaId }, select: { id: true } });
  if (!existe) return null;
  const usuarioId = ctx.usuarioId && (await prisma.usuario.count({ where: { id: ctx.usuarioId } })) ? ctx.usuarioId : null;
  return prisma.$transaction(async (tx) => {
    const pendentes = await tx.importacaoLoteItem.findMany({ where: { loteId, empresaId: ctx.empresaId, acao: "CRIADO", desfeitoEm: null }, select: { entidade: true, registroId: true } });
    const grupos = new Map<string, string[]>();
    for (const it of pendentes) if (CADASTROS_DO_LOTE[it.entidade]) grupos.set(it.entidade, [...(grupos.get(it.entidade) ?? []), it.registroId]);
    for (const [ent, ids] of grupos) {
      const tabela = tabelaDo(ent);
      if (tabela) await tx.$queryRawUnsafe(`SELECT "id" FROM "${tabela}" WHERE "id" = ANY($1::text[]) AND "empresa_id" = $2 FOR UPDATE`, ids, ctx.empresaId);
    }
    const p = (await previaDesfazer(loteId, ctx, tx))!;
    const agora = new Date();
    for (const it of p.apagar) {
      const n = await delegate(tx, it.entidade).deleteMany({ where: { id: it.id, empresaId: ctx.empresaId } });
      if (n.count !== 1) throw new Error(`O registro ${it.rotulo} mudou durante o desfazer. Tente de novo.`);
    }
    if (p.apagar.length)
      await tx.importacaoLoteItem.updateMany({
        where: { loteId, OR: p.apagar.map((it) => ({ entidade: it.entidade, registroId: it.id })) }, data: { desfeitoEm: agora },
      });
    await tx.importacaoLote.update({ where: { id: loteId }, data: { desfeitoEm: agora, desfeitoPorId: usuarioId, apagados: { increment: p.apagar.length } } });
    return { apagados: p.apagar.length, ficam: p.ficam, atualizados: p.atualizados.length };
  }, { timeout: 60_000, maxWait: 10_000 });
}

export interface LoteLista {
  id: string; entidade: string; arquivo: string; criadoEm: string; quem: string | null;
  criados: number; atualizados: number; comErro: number; avisos: number;
  desfeitoEm: string | null; desfeitoPor: string | null; apagados: number;
  /** Criados que ainda existem pelo lote (não desfeitos) */
  pendentes: number;
}

/** As importações da empresa, da mais nova para a mais antiga */
export async function listarLotes(empresaId: string, limite = 30): Promise<LoteLista[]> {
  const ls = await prisma.importacaoLote.findMany({
    where: { empresaId }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: limite,
    select: {
      id: true, entidade: true, arquivo: true, criadoEm: true, criados: true, atualizados: true, comErro: true, avisos: true,
      desfeitoEm: true, apagados: true, usuario: { select: { nome: true } }, desfeitoPor: { select: { nome: true } },
      _count: { select: { itens: { where: { acao: "CRIADO", desfeitoEm: null } } } },
    },
  });
  return ls.map((l) => ({
    id: l.id, entidade: l.entidade, arquivo: l.arquivo, criadoEm: l.criadoEm.toISOString(), quem: l.usuario?.nome ?? null,
    criados: l.criados, atualizados: l.atualizados, comErro: l.comErro, avisos: l.avisos,
    desfeitoEm: l.desfeitoEm?.toISOString() ?? null, desfeitoPor: l.desfeitoPor?.nome ?? null, apagados: l.apagados, pendentes: l._count.itens,
  }));
}
