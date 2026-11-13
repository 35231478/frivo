/**
 * App do técnico — "O QUE LEVAR": os materiais e peças PREVISTOS para executar as OS, para o técnico
 * carregar o veículo certo antes de sair. REGRA PURA (servidor, tela e testes usam o mesmo cálculo).
 *
 * É só PREVISÃO: não baixa estoque, não reserva, não altera a OS. O consumo real continua sendo
 * registrado na execução / no estoque.
 *
 * De onde vem (só o que o sistema já grava — nada é inventado):
 *  1. Linha de SERVIÇO da OS com materiais lançados (o retrato copiado da composição ao lançar o
 *     serviço, já com o que o escritório ajustou): valem esses, na quantidade lançada. Material
 *     marcado "não usado" (quantidade 0) não entra; o que o estoque já deu como CONSUMIDO ou DEVOLVIDO
 *     também não (já foi levado).
 *  2. Linha de serviço do catálogo SEM material lançado: vale a composição padrão ATUAL do serviço
 *     (kit aberto nos seus itens). Serviço sem composição → nada aparece para ele.
 *  3. Linha de PRODUTO (peça vendida na OS): entra na quantidade da linha — menos a que só espelha um
 *     material do serviço (já contada em 1).
 *  4. Linha já marcada como EXECUTADA não entra: o material dela já foi usado.
 *
 * Nenhum VALOR (venda ou custo) passa por aqui: o app recebe descrição, quantidade e unidade.
 */
import { expandirComposicao, qtd, type LinhaComposicao } from "@/lib/estoque/composicao";

/** Um material previsto: o que aparece no app ("Filtro G4 — 4 un") */
export interface MaterialPrevisto {
  /** Identidade para somar: o produto do catálogo (ou a descrição, na linha livre) + a unidade */
  chave: string;
  descricao: string;
  unidade: string;
  quantidade: number;
}

export interface MaterialDaLinha { produtoId: string | null; descricao: string; unidade: string | null; quantidade: unknown; estadoSeparacao?: string | null }

/** Uma linha da OS (serviço ou produto), como o servidor lê do banco */
export interface LinhaDaOs {
  tipo: string;
  executado: boolean;
  descricao: string;
  quantidade: unknown;
  /** Linha de produto que só espelha um material de serviço (peça vendida à parte) */
  materialId: string | null;
  produto: { id: string; nome: string; unidade: string | null } | null;
  /** Materiais LANÇADOS nesta linha de serviço (retrato) */
  materiais: MaterialDaLinha[];
  /** Composição padrão ATUAL do serviço do catálogo (só usada quando não há material lançado) */
  composicao: LinhaComposicao[] | null;
}

/** Estados do estoque em que o material já saiu (ou voltou): não há mais o que levar */
const JA_LEVADO = new Set(["CONSUMIDO", "DEVOLVIDO"]);

const arred3 = (n: number) => Math.round(n * 1000) / 1000;
const unidadeDe = (u: string | null | undefined) => (u ?? "").trim() || "un";
const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** A identidade de um material para somar: mesmo produto (ou mesma descrição, na linha livre) na mesma unidade. */
export function chaveDoMaterial(produtoId: string | null | undefined, descricao: string, unidade: string | null | undefined): string {
  const u = semAcento(unidadeDe(unidade));
  return produtoId ? `p:${produtoId}|${u}` : `d:${semAcento(descricao)}|${u}`;
}

/** Soma listas de materiais pela chave (produto + unidade), em ordem alfabética. Quantidade ≤ 0 não entra. */
export function somarMateriais(listas: readonly (readonly MaterialPrevisto[] | null | undefined)[]): MaterialPrevisto[] {
  const soma = new Map<string, MaterialPrevisto>();
  for (const lista of listas) {
    for (const m of lista ?? []) {
      if (!(m.quantidade > 0)) continue;
      const ja = soma.get(m.chave);
      if (ja) ja.quantidade = arred3(ja.quantidade + m.quantidade);
      else soma.set(m.chave, { ...m, quantidade: arred3(m.quantidade) });
    }
  }
  return [...soma.values()].sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR", { numeric: true }) || a.unidade.localeCompare(b.unidade, "pt-BR"));
}

/** Os materiais previstos de UMA OS, a partir das suas linhas. */
export function materiaisPrevistosDaOs(linhas: readonly LinhaDaOs[]): MaterialPrevisto[] {
  const previstos: MaterialPrevisto[] = [];
  const por = (produtoId: string | null, descricao: string, unidade: string | null | undefined, quantidade: number) => {
    const nome = descricao.trim();
    if (!nome) return; // quantidade zero ("não usado") ou inválida cai na soma, logo abaixo
    previstos.push({ chave: chaveDoMaterial(produtoId, nome, unidade), descricao: nome, unidade: unidadeDe(unidade), quantidade });
  };
  for (const l of linhas) {
    if (l.executado) continue; // serviço já feito: o material dele já foi usado
    if (l.tipo === "PRODUTO") {
      if (l.materialId) continue; // espelho de um material do serviço: já contado na linha do serviço
      por(l.produto?.id ?? null, l.produto?.nome ?? l.descricao, l.produto?.unidade, qtd(l.quantidade));
      continue;
    }
    if (l.materiais.length) {
      for (const m of l.materiais) {
        if (m.estadoSeparacao && JA_LEVADO.has(m.estadoSeparacao)) continue;
        por(m.produtoId, m.descricao, m.unidade, qtd(m.quantidade));
      }
      continue;
    }
    // Serviço do catálogo sem material lançado: a composição padrão de hoje (kit aberto)
    for (const m of expandirComposicao(l.composicao)) por(m.produtoId, m.nome, m.unidade, m.quantidade);
  }
  return somarMateriais([previstos]);
}

/** Situações em que a atividade não pede mais material */
const ENCERRADA = new Set(["CONCLUIDA", "CANCELADA"]);

export interface CartaoComMateriais { osId: string; status: string; materiais?: MaterialPrevisto[] | null }

/**
 * O que levar num DIA: a soma dos materiais das OS ainda por fazer. Cada OS conta UMA vez (duas
 * atividades da mesma OS no dia não dobram o material) e atividade concluída ou cancelada não entra.
 * `statusDe` deixa a tela usar a situação que o técnico já gravou no aparelho (concluiu sem sinal).
 */
export function oQueLevarNoDia<T extends CartaoComMateriais>(cartoes: readonly T[], statusDe: (c: T) => string = (c) => c.status): { itens: MaterialPrevisto[]; os: number } {
  const porOs = new Map<string, MaterialPrevisto[]>();
  for (const c of cartoes) {
    if (ENCERRADA.has(statusDe(c)) || !c.materiais?.length || porOs.has(c.osId)) continue;
    porOs.set(c.osId, c.materiais);
  }
  return { itens: somarMateriais([...porOs.values()]), os: porOs.size };
}

/** Quantidade como o técnico lê: "4", "2,5", "0,125" (até 3 casas, sem zeros sobrando). */
export function formatarQuantidade(n: number): string {
  const v = arred3(Number.isFinite(n) ? n : 0);
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false });
}

/** "4 un" · "2,5 kg" */
export const quantidadeComUnidade = (m: Pick<MaterialPrevisto, "quantidade" | "unidade">) => `${formatarQuantidade(m.quantidade)} ${m.unidade}`;

/** O resumo do bloco do dia: "5 materiais para 3 OS" */
export function resumoDoQueLevar(itens: number, os: number): string {
  return `${itens === 1 ? "1 material" : `${itens} materiais`} para ${os === 1 ? "1 OS" : `${os} OS`}`;
}
