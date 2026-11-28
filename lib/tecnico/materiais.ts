/**
 * MATERIAIS USADOS EM CAMPO — regras PURAS (servidor, aparelho e testes).
 *
 * Um lugar só: o técnico registra o que usou, na atividade e (opcional) num equipamento dela, buscando no
 * catálogo que fica no aparelho (sem preço e sem custo — o técnico nunca vê custo). Funciona sem sinal: cada
 * gravação leva um `clientId` gerado no aparelho, e a mesma gravação reenviada não duplica.
 *
 * Baixa do estoque (decisão do produto, leva app-campo 1):
 *  - sai do ESTOQUE GERAL (SAIDA de origem OS), com o veículo no `local_id` do razão;
 *  - material SEPARADO para a OS: o uso vira o CONSUMO daquela separação — a parte reservada só troca de
 *    RESERVA para SAIDA (líquido zero) e só o que passar dela baixa a mais. Nunca baixa duas vezes;
 *  - sem saldo, lança assim mesmo (estoque negativo; o escritório é avisado no sino);
 *  - corrigir ou estornar lança só a DIFERENÇA (o razão nunca é apagado).
 */
import { z } from "zod";
import { arred } from "@/lib/estoque/regras";

export const QTD_MAX = 99_999;
export const DESCRICAO_MAX = 160;

const id = z.string().min(1).max(64);
const temAteTresCasas = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;
export const quantidadeSchema = z.number({ invalid_type_error: "Informe a quantidade." })
  .refine((n) => Number.isFinite(n) && n > 0, "A quantidade precisa ser maior que zero.")
  .refine((n) => n <= QTD_MAX, `No máximo ${QTD_MAX.toLocaleString("pt-BR")}.`)
  .refine(temAteTresCasas, "Use no máximo 3 casas decimais.");

/**
 * Gravar (criar ou corrigir a quantidade/equipamento) um material usado. O `clientId` identifica a linha: a correção
 * manda só `clientId` + `quantidade` (e o equipamento). Na CRIAÇÃO, produto ou descrição é obrigatório (`identificado`).
 */
export const materialSchema = z.object({
  clientId: id,
  produtoId: id.nullable().optional(),
  /** Só para o material fora do catálogo (com produto, a descrição é a do cadastro) */
  descricao: z.string().trim().max(DESCRICAO_MAX).optional(),
  unidade: z.string().trim().max(12).optional(),
  quantidade: quantidadeSchema,
  equipamentoId: id.nullable().optional(),
}).strict();
export type DadosMaterial = z.infer<typeof materialSchema>;

/** Linha NOVA: do catálogo (produto) ou descrita (fora do catálogo, ao menos 2 letras). */
export const identificado = (d: { produtoId?: string | null; descricao?: string }) => !!d.produtoId || (d.descricao ?? "").trim().length >= 2;
export const MSG_SEM_MATERIAL = "Escolha no catálogo ou descreva o material.";

export const materialRemoverSchema = z.object({ id: id.optional(), clientId: id.optional() }).strict()
  .refine((d) => !!d.id || !!d.clientId, "Diga qual material.");

/** Como a linha aparece no app (sem valor nenhum). */
export interface MaterialTela {
  id: string | null; clientId: string; produtoId: string | null; descricao: string; unidade: string; quantidade: number;
  equipamentoId: string | null;
  /** Lançado por quem está com o aparelho: só esse remove (e só com a atividade aberta) */
  meu: boolean;
  criadoPor: string | null;
  /** Gravado no aparelho, ainda não confirmado */
  pendente?: boolean;
}

/** Produto do catálogo como vai para o aparelho: SEM preço e SEM custo. */
export interface ProdutoCatalogo {
  id: string; codigo: number | null; nome: string; unidade: string;
  /** D5 — o saldo do estoque (sem custo nem preço). null = o produto não controla estoque ou o módulo está desligado;
   *  ausente = catálogo antigo no aparelho. */
  saldo?: number | null;
}

/* ───────── baixa ───────── */

export interface PlanoAjusteConsumo {
  /** + = ESTORNO_RESERVA (a reserva vira saída); − = RESERVA (volta a ficar reservado) */
  reserva: number;
  /** + = SAIDA; − = ESTORNO_SAIDA */
  saida: number;
}

/**
 * Consumo de uma separação passando de `antes` para `depois` (o total que o campo usou dela). Igual a desfazer o
 * consumo antigo e informar o novo (lib/estoque/separacao › planoConsumo), mas só com a diferença: a parte que
 * cabe na reserva troca de RESERVA para SAIDA; o excedente é SAIDA a mais.
 */
export function planoAjusteConsumo(separada: number, antes: number, depois: number): PlanoAjusteConsumo {
  const sep = Math.max(0, separada);
  const daReserva = (c: number) => Math.min(Math.max(0, c), sep);
  return { reserva: arred(daReserva(depois) - daReserva(antes)), saida: arred(Math.max(0, depois) - Math.max(0, antes)) };
}

/** Baixa direta (fora da reserva): a diferença entre o que a linha deve ter baixado e o que já baixou. */
export const deltaBaixaDireta = (baixado: number, alvo: number) => arred(Math.max(0, alvo) - Math.max(0, baixado));

export interface SeparacaoCandidata {
  id: string; produtoId: string | null; estadoSeparacao: string | null; quantidadeSeparada: number; quantidadeConsumida: number; ordem: number;
  /** O consumo dela foi informado pelo CAMPO (tem uso em campo ativo ligado) */
  doCampo: boolean;
}

/**
 * Qual separação da OS o uso deste produto consome: a do mesmo produto que está SEPARADA (o escritório ainda não
 * informou consumo) ou cujo consumo veio do próprio campo. Consumo informado pelo escritório ou sobra já devolvida
 * não entram (aí o uso baixa direto). Mais de uma: a primeira na ordem da OS.
 */
export function escolherSeparacao(lista: SeparacaoCandidata[], produtoId: string | null): string | null {
  if (!produtoId) return null;
  const ok = lista
    .filter((m) => m.produtoId === produtoId && m.quantidadeSeparada > 0)
    .filter((m) => (m.estadoSeparacao === "SEPARADO" && m.quantidadeConsumida <= 0) || (m.estadoSeparacao === "CONSUMIDO" && m.doCampo))
    .sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id));
  return ok[0]?.id ?? null;
}

/**
 * D5 — quanto da SEPARAÇÃO desta OS o próximo uso do produto ainda consome antes de sair do estoque: a mesma escolha do
 * servidor (escolherSeparacao). Separada e ainda não consumida = tudo; já consumida pelo campo = o que sobra dela.
 */
export function separadoParaUso(lista: SeparacaoCandidata[], produtoId: string | null): number {
  const id = escolherSeparacao(lista, produtoId);
  const m = id ? lista.find((x) => x.id === id) : null;
  if (!m) return 0;
  return arred(Math.max(0, m.estadoSeparacao === "SEPARADO" ? m.quantidadeSeparada : m.quantidadeSeparada - m.quantidadeConsumida));
}

/**
 * D5 — o SALDO DISPONÍVEL para este uso, sem o estoque ficar negativo: o saldo do catálogo + o separado para esta OS −
 * o que o aparelho já lançou deste produto e ainda não enviou (o servidor ainda não abateu). null = não controla estoque.
 */
export function disponivelParaUso(saldo: number | null | undefined, separado: number, pendentes: number): number | null {
  if (saldo == null || !Number.isFinite(saldo)) return null;
  return arred(saldo + Math.max(0, separado) - Math.max(0, pendentes));
}

/** D5 — o aviso ao passar do saldo: lança mesmo assim (o escritório recebe o push "Estoque negativo"). */
export function avisoSemSaldo(quantidade: number, disponivel: number | null, unidade: string): string | null {
  if (disponivel == null || !(quantidade > 0) || !(arred(quantidade) > disponivel)) return null;
  return `Saldo disponível: ${textoQuantidade(Math.max(0, disponivel), unidade)}. Vai ficar negativo; o escritório será avisado.`;
}

/** D5 — a linha de saldo embaixo do material escolhido. */
export function textoSaldo(disponivel: number | null, separado: number, unidade: string): string | null {
  if (disponivel == null) return null;
  const base = `Saldo disponível: ${textoQuantidade(disponivel, unidade)}`;
  return separado > 0 ? `${base} (${textoQuantidade(separado, unidade)} separado para esta OS)` : base;
}

/* ───────── catálogo no aparelho ───────── */

const normal = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim();

/** Busca no catálogo guardado: todas as palavras precisam aparecer (no nome ou no código). Começo do nome vem antes. */
export function buscarNoCatalogo(catalogo: ProdutoCatalogo[], termo: string, limite = 30): ProdutoCatalogo[] {
  const q = normal(termo);
  if (!q) return [];
  const palavras = q.split(/\s+/).filter(Boolean);
  const achados = catalogo.filter((p) => {
    const alvo = `${normal(p.nome)} ${p.codigo ?? ""}`;
    return palavras.every((w) => alvo.includes(w));
  });
  const peso = (p: ProdutoCatalogo) => (String(p.codigo ?? "") === q ? 0 : normal(p.nome).startsWith(q) ? 1 : 2);
  return achados.sort((a, b) => peso(a) - peso(b) || a.nome.localeCompare(b.nome, "pt-BR")).slice(0, limite);
}

/* ───────── aparelho: a gravação vale na hora ───────── */

export function aplicarMaterial(lista: MaterialTela[], d: DadosMaterial, extra: { produto?: ProdutoCatalogo | null } = {}): MaterialTela[] {
  const existe = lista.find((m) => m.clientId === d.clientId);
  if (existe) {
    return lista.map((m) => (m.clientId === d.clientId
      ? { ...m, quantidade: arred(d.quantidade), ...(d.equipamentoId !== undefined && { equipamentoId: d.equipamentoId ?? null }), pendente: true }
      : m));
  }
  const p = extra.produto ?? null;
  return [...lista, {
    id: null, clientId: d.clientId, produtoId: d.produtoId ?? null,
    descricao: (p?.nome ?? d.descricao ?? "").trim(), unidade: (p?.unidade ?? d.unidade ?? "un").trim() || "un",
    quantidade: arred(d.quantidade), equipamentoId: d.equipamentoId ?? null, meu: true, criadoPor: null, pendente: true,
  }];
}

export const removerMaterialDaLista = (lista: MaterialTela[], ref: { id?: string | null; clientId?: string | null }) =>
  lista.filter((m) => !((ref.clientId && m.clientId === ref.clientId) || (ref.id && m.id === ref.id)));

/** "2,5 m", "1 un" */
export const textoQuantidade = (q: number, unidade: string) => `${String(arred(q)).replace(".", ",")} ${unidade}`.trim();

export const MSG_SO_O_SEU = "Só quem lançou o material pode remover. Fale com o escritório.";
export const MSG_SOBRA_DEVOLVIDA = "A sobra deste material já voltou ao estoque: fale com o escritório.";
export const MSG_MATERIAL_REMOVIDO = "Este material foi retirado da OS.";
export const MSG_EQUIP_FORA = "Este equipamento não está nesta atividade.";
export const MSG_PRODUTO_INVALIDO = "Produto não encontrado no catálogo.";
