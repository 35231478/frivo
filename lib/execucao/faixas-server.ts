/**
 * FAIXA ESPERADA no servidor: a foto da faixa na resposta (para o relatório continuar fiel) e o ΔT calculado.
 * As regras são as de lib/checklist/faixas.ts (as mesmas do app).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  calcularGrandeza, ehCalculada, faixaNaUnidade, foraDaFaixa, GRANDEZA, grandezaDoItem, type Grandeza, type LeituraGrandeza,
} from "@/lib/checklist/faixas";

type Dec = Prisma.Decimal | null;
const n = (d: Dec) => (d === null ? null : d.toNumber());

export interface ItemComFaixa { texto: string; tipoResposta: string; unidade: string | null; grandeza: string | null; valorMin: Dec; valorMax: Dec }
export const SELECT_FAIXA = { grandeza: true, valorMin: true, valorMax: true } as const;

/** A faixa do item na unidade da resposta e se o valor ficou fora (sem valor ou sem faixa: nada). */
export function fotoDaFaixa(item: ItemComFaixa, valor: number | null, unidade: string | null) {
  if (valor === null) return { faixaMin: null, faixaMax: null, foraDaFaixa: false };
  const f = faixaNaUnidade({ valorMin: n(item.valorMin), valorMax: n(item.valorMax), unidade: item.unidade, grandeza: grandezaDoItem(item) }, unidade);
  return { faixaMin: f?.min ?? null, faixaMax: f?.max ?? null, foraDaFaixa: foraDaFaixa(valor, f) };
}

/** A grandeza entra no cálculo de alguma calculada (insuflamento, retorno, entrada/saída da água)? */
export const alimentaCalculo = (g: Grandeza | null) => !!g && Object.values(GRANDEZA).some((d) => d.calculo?.includes(g));

/**
 * Refaz as medições calculadas (ΔT) do equipamento nesta atividade a partir das leituras gravadas. Sem as duas
 * leituras, a calculada fica vazia; uma delas "Não se aplica", a calculada também.
 */
export async function recalcularCalculadas(p: { empresaId: string; atividadeId: string; equipamentoId: string; tipoEquipamentoId: string | null; usuarioId: string }) {
  if (!p.tipoEquipamentoId) return [];
  const itens = await prisma.checklistTipoItem.findMany({
    where: { tipoEquipamentoId: p.tipoEquipamentoId, empresaId: p.empresaId, ativo: true, tipoResposta: "MEDICAO" },
    select: { id: true, texto: true, tipoResposta: true, unidade: true, ...SELECT_FAIXA },
  });
  const calculadas = itens.filter((i) => ehCalculada(grandezaDoItem(i)));
  if (!calculadas.length) return [];
  const respostas = await prisma.checklistResposta.findMany({
    where: { atividadeId: p.atividadeId, equipamentoId: p.equipamentoId, itemId: { in: itens.map((i) => i.id) } },
    select: { itemId: true, valor: true, unidade: true, status: true },
  });
  const leituras: Partial<Record<Grandeza, LeituraGrandeza>> = {};
  for (const it of itens) {
    const g = grandezaDoItem(it);
    const r = respostas.find((x) => x.itemId === it.id);
    if (g && r && !ehCalculada(g)) leituras[g] = { valor: n(r.valor), unidade: r.unidade ?? it.unidade, naoSeAplica: r.status === "NAO_SE_APLICA" };
  }
  const agora = new Date();
  const feitas: { itemId: string; valor: number | null; unidade: string | null; status: "NAO_SE_APLICA" | null }[] = [];
  for (const it of calculadas) {
    const c = calcularGrandeza(grandezaDoItem(it)!, leituras, it.unidade);
    const atual = respostas.find((x) => x.itemId === it.id);
    const dados = c === null
      ? { status: null, valor: null, unidade: it.unidade, faixaMin: null, faixaMax: null, foraDaFaixa: false }
      : "naoSeAplica" in c
        ? { status: "NAO_SE_APLICA" as const, valor: null, unidade: it.unidade, faixaMin: null, faixaMax: null, foraDaFaixa: false }
        : { status: null, valor: c.valor, unidade: c.unidade, ...fotoDaFaixa(it, c.valor, c.unidade) };
    if (c === null && !atual) continue; // nada a desfazer
    await prisma.checklistResposta.upsert({
      where: { atividadeId_equipamentoId_itemId: { atividadeId: p.atividadeId, equipamentoId: p.equipamentoId, itemId: it.id } },
      create: { empresaId: p.empresaId, atividadeId: p.atividadeId, equipamentoId: p.equipamentoId, itemId: it.id, textoItem: it.texto, ...dados, respondidoPorId: p.usuarioId, respondidoEm: agora },
      update: { ...dados, textoItem: it.texto, respondidoPorId: p.usuarioId, respondidoEm: agora },
    });
    feitas.push({ itemId: it.id, valor: dados.valor, unidade: dados.unidade, status: dados.status });
  }
  return feitas;
}
