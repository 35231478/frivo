import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import type { Permissoes } from "@/lib/permissoes";
import {
  ACOES_ITEM, ENTIDADE, ENTIDADES, MAX_POR_REQUISICAO, MAX_SELECAO, podeAcao, podeExportar, podeVerLista, type Entidade,
} from "@/lib/acoes-massa/acoes";
import { EXECUTORES, gerarCsvExportacao, idsDoFiltro, linhasExportacao, rotulos } from "@/lib/acoes-massa/server";
import type { ResultadoItem } from "@/lib/acoes-massa/regras";

/**
 * Ações em massa — endpoint ÚNICO (a tela não faz uma chamada por registro).
 * - acao "inativar" | "reativar" | "gerar-qr": até 500 ids por requisição; a tela divide seleções
 *   maiores em partes (barra de progresso). Cada id passa pela MESMA regra e permissão da ação
 *   individual; id de outra empresa = "não encontrado". Nunca falha o lote inteiro em silêncio:
 *   devolve o resultado de cada id ("X feitas · Y não puderam, com o motivo").
 * - acao "exportar": CSV dos ids escolhidos (ver a lista + "Relatórios › Exportar").
 * - acao "ids-do-filtro": ids que batem no filtro atual da lista (mesmo where da página).
 * Cada requisição é registrada no log do servidor (quem, quando, o quê, quantos).
 */

export const maxDuration = 60;
const PRAZO_MS = 50_000; // para antes do limite da Vercel: o que sobrar volta como "não processado"

const id = z.string().min(1).max(40);
const schema = z.object({
  entidade: z.enum(ENTIDADES),
  acao: z.enum([...ACOES_ITEM, "exportar", "ids-do-filtro"]),
  ids: z.array(id).max(MAX_SELECAO).optional(),
  filtro: z.string().max(4000).optional(),
  motivo: z.string().trim().max(500).optional(),
  /** Agrupa as partes de uma mesma ação no log */
  lote: z.object({ id: z.string().max(40), parte: z.number().int().min(1), partes: z.number().int().min(1) }).strict().optional(),
}).strict();

export interface ItemResultado { id: string; rotulo: string; ok: boolean; detalhe?: string; codigo?: string; motivo?: string; qrcodeId?: string }

function registrar(dados: Record<string, unknown>) {
  // Auditoria das ações em massa (logs do servidor). Cada registro também ganha o rastro da ação
  // individual: histórico da OS / do contrato, anotação nas observações de veículo e colaborador.
  console.info(JSON.stringify({ evento: "acao_em_massa", quando: new Date().toISOString(), ...dados }));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const user = session.user;
  const permissoes = user.permissoes as Permissoes;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Requisição inválida", detalhes: parsed.error.flatten() }, { status: 400 });
  const { entidade, acao, motivo, lote } = parsed.data;
  const empresaId = user.empresaId;
  const quem = { usuarioId: user.id, usuario: user.name ?? user.email, empresaId };

  // ── Ids do filtro atual ──
  if (acao === "ids-do-filtro") {
    if (!podeVerLista(permissoes, user.role, entidade)) return NextResponse.json({ erro: "Sem permissão para esta lista" }, { status: 403 });
    return NextResponse.json(await idsDoFiltro(entidade, parsed.data.filtro ?? "", empresaId));
  }

  const ids = [...new Set(parsed.data.ids ?? [])];
  if (ids.length === 0) return NextResponse.json({ erro: "Nenhum registro selecionado" }, { status: 400 });

  // ── Exportar ──
  if (acao === "exportar") {
    if (!podeExportar(permissoes, user.role, entidade))
      return NextResponse.json({ erro: "Sem permissão para exportar (precisa ver a lista e de “Relatórios › Exportar”)" }, { status: 403 });
    const linhas = await linhasExportacao(entidade, ids, empresaId); // só registros da empresa da sessão
    registrar({ ...quem, entidade, acao, total: ids.length, exportados: linhas.length - 1 });
    return new NextResponse(gerarCsvExportacao(linhas), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${entidade}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // ── Ações que alteram registros ──
  const def = ENTIDADE[entidade].acoes[acao];
  const executar = EXECUTORES[entidade][acao];
  if (!def || !executar) return NextResponse.json({ erro: "Ação não disponível para esta lista" }, { status: 400 });
  if (ids.length > MAX_POR_REQUISICAO)
    return NextResponse.json({ erro: `No máximo ${MAX_POR_REQUISICAO} registros por vez (a tela envia em partes).` }, { status: 413 });
  if (!podeAcao(permissoes, user.role, entidade, acao)) {
    registrar({ ...quem, entidade, acao, total: ids.length, recusado: "sem_permissao", lote });
    return NextResponse.json({ erro: "Sem permissão para esta ação" }, { status: 403 });
  }

  const nomes = await rotulos(entidade, ids, empresaId); // só os da empresa da sessão aparecem aqui
  const ctx = { empresaId, usuarioId: user.id, usuarioNome: user.name ?? "usuário", origem: "massa" as const, motivo };
  const inicio = Date.now();
  const resultados: ItemResultado[] = [];

  // Um por vez (regras com contadores, como o número do QR, e para não esgotar o banco)
  for (const itemId of ids) {
    const rotulo = nomes.get(itemId) ?? itemId;
    if (Date.now() - inicio > PRAZO_MS) {
      resultados.push({ id: itemId, rotulo, ok: false, codigo: "nao_processado", motivo: "Não processado: tempo esgotado. Selecione de novo e repita." });
      continue;
    }
    let r: ResultadoItem;
    if (!nomes.has(itemId)) {
      r = { ok: false, codigo: "nao_encontrado", motivo: "Não encontrado (ou de outra empresa)" };
    } else if (!podeAcao(permissoes, user.role, entidade, acao)) {
      // Mesma permissão da ação individual, conferida por item
      r = { ok: false, codigo: "sem_permissao", motivo: "Sem permissão para esta ação" };
    } else {
      try {
        r = await executar(itemId, ctx);
      } catch (e) {
        console.error("[acoes-massa]", entidade, acao, itemId, e);
        r = { ok: false, codigo: "erro", motivo: "Erro inesperado ao processar este registro" };
      }
    }
    resultados.push(r.ok
      ? { id: itemId, rotulo, ok: true, detalhe: r.detalhe, ...(r.dados?.qrcodeId ? { qrcodeId: r.dados.qrcodeId as string } : {}) }
      : { id: itemId, rotulo, ok: false, codigo: r.codigo, motivo: r.motivo });
  }

  const feitas = resultados.filter((r) => r.ok).length;
  registrar({
    ...quem, entidade, acao, lote, total: ids.length, feitas, naoPuderam: ids.length - feitas, duracaoMs: Date.now() - inicio,
    falhas: resultados.filter((r) => !r.ok).slice(0, 50).map((r) => ({ id: r.id, codigo: r.codigo })),
  });
  return NextResponse.json({ resultados, resumo: { total: ids.length, feitas, naoPuderam: ids.length - feitas } });
}
