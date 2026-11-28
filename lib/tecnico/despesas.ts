/**
 * DESPESAS DE CAMPO — regras PURAS (aparelho, servidor e testes).
 *
 * O colaborador lança pelo app a despesa que teve em campo, com a FOTO DO CUPOM (obrigatória), com ou sem sinal (o
 * `clientId` gerado no aparelho faz a reenviada não duplicar). O escritório decide em Financeiro › Despesas de campo:
 *  - APROVAR "do próprio bolso": gera a conta a pagar de REEMBOLSO ao colaborador (favorecido = o colaborador), na
 *    categoria financeira ligada à categoria da despesa;
 *  - APROVAR "pela empresa" (cartão ou dinheiro da empresa): só registra — o custo fica na OS;
 *  - RECUSAR: com o motivo, obrigatório (o colaborador vê no app).
 * O técnico vê só as despesas DELE (nunca custo da OS).
 */
import { z } from "zod";
import { arred } from "@/lib/estoque/regras";

export const CATEGORIAS_DESPESA = [
  { id: "COMBUSTIVEL", nome: "Combustível" },
  { id: "PEDAGIO", nome: "Pedágio" },
  { id: "ESTACIONAMENTO", nome: "Estacionamento" },
  { id: "ALIMENTACAO", nome: "Alimentação" },
  { id: "HOSPEDAGEM", nome: "Hospedagem" },
  { id: "MATERIAL", nome: "Material comprado em campo" },
  { id: "OUTROS", nome: "Outros" },
] as const;
export type CategoriaDespesa = (typeof CATEGORIAS_DESPESA)[number]["id"];
export const NOME_CATEGORIA = Object.fromEntries(CATEGORIAS_DESPESA.map((c) => [c.id, c.nome])) as Record<CategoriaDespesa, string>;
const IDS = CATEGORIAS_DESPESA.map((c) => c.id) as [CategoriaDespesa, ...CategoriaDespesa[]];

export const PAGAMENTOS = { PROPRIO: "Do meu bolso", EMPRESA: "Cartão ou dinheiro da empresa" } as const;
export type Pagamento = keyof typeof PAGAMENTOS;
/** O mesmo, como o escritório lê */
export const PAGAMENTO_ESCRITORIO: Record<Pagamento, string> = { PROPRIO: "Do bolso do colaborador", EMPRESA: "Pago pela empresa" };
/** Vencimento sugerido do reembolso: daqui a 7 dias */
export const DIAS_VENCIMENTO_REEMBOLSO = 7;

export type StatusDespesa = "PENDENTE" | "APROVADA" | "RECUSADA";
/** O que o colaborador lê no app (aprovada do bolso e já paga = reembolsada) */
export type SituacaoDespesa = StatusDespesa | "REEMBOLSADA";
export const ROTULO_SITUACAO: Record<SituacaoDespesa, string> = {
  PENDENTE: "Aguardando aprovação", APROVADA: "Aprovada", RECUSADA: "Recusada", REEMBOLSADA: "Reembolsada",
};
export function situacaoDespesa(d: { status: string; pagamento: string; contaPaga?: boolean }): SituacaoDespesa {
  if (d.status === "APROVADA" && d.pagamento === "PROPRIO" && d.contaPaga) return "REEMBOLSADA";
  return (["PENDENTE", "APROVADA", "RECUSADA"].includes(d.status) ? d.status : "PENDENTE") as StatusDespesa;
}

export const VALOR_MAX = 100_000;
/** Despesa mais antiga que isto não entra pelo app (o escritório lança à mão) */
export const DIAS_MAX_ATRAS = 60;
export const DESCRICAO_MAX = 200;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const temAteDuasCasas = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

const camposDespesa = {
  clientId: z.string().min(1).max(64),
  categoria: z.enum(IDS, { errorMap: () => ({ message: "Escolha a categoria." }) }),
  valor: z.number({ invalid_type_error: "Informe o valor." })
    .refine((n) => Number.isFinite(n) && n > 0, "O valor precisa ser maior que zero.")
    .refine((n) => n <= VALOR_MAX, `No máximo R$ ${VALOR_MAX.toLocaleString("pt-BR")}.`)
    .refine(temAteDuasCasas, "Use no máximo 2 casas decimais."),
  /** O dia da despesa (Brasília), "AAAA-MM-DD" */
  data: z.string().regex(DIA, "Data inválida."),
  pagamento: z.enum(["PROPRIO", "EMPRESA"], { errorMap: () => ({ message: "Diga como foi paga." }) }),
  descricao: z.string().trim().max(DESCRICAO_MAX).optional(),
  foto: z.string().min(30, "Tire a foto do cupom.").startsWith("data:image/", "Tire a foto do cupom."),
};
const outrosDescrita = (d: { categoria: CategoriaDespesa; descricao?: string }) => d.categoria !== "OUTROS" || (d.descricao ?? "").trim().length >= 3;
const MSG_OUTROS = { message: "Em Outros, descreva a despesa.", path: ["descricao"] };
/** O que a fila manda ao lançar. A foto vai junto (data URL já comprimida no aparelho). */
export const despesaSchema = z.object(camposDespesa).strict().refine(outrosDescrita, MSG_OUTROS);
export type DadosDespesa = z.infer<typeof despesaSchema>;
/**
 * D7 — CORRIGIR a despesa enquanto o escritório não decidiu: os mesmos campos (pelo clientId do aparelho), a foto só
 * quando trocou. Vazia a descrição = sem descrição.
 */
export const despesaEdicaoSchema = z.object({ ...camposDespesa, foto: camposDespesa.foto.optional() }).strict().refine(outrosDescrita, MSG_OUTROS);
export type EdicaoDespesa = z.infer<typeof despesaEdicaoSchema>;
/** D7 — EXCLUIR a despesa enquanto o escritório não decidiu (pelo clientId do aparelho) */
export const despesaExclusaoSchema = z.object({ clientId: camposDespesa.clientId }).strict();

export const MSG_DESPESA_DECIDIDA_CORRIGIR = "O escritório já decidiu esta despesa: não dá mais para corrigir nem excluir.";
export const MSG_DESPESA_EXCLUIDA = "Esta despesa foi excluída.";
export const MSG_DESPESA_DE_OUTRO = "Só quem lançou corrige ou exclui a despesa.";

const moeda = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const diaBR = (dia: string) => dia.split("-").reverse().join("/");
type CamposComparados = { categoria: CategoriaDespesa; valor: number; data: string; pagamento: Pagamento; descricao: string | null };
/** D7 — a trilha da correção: o que mudou, "campo: antes → depois" (a foto, só "trocada"). Nada mudou = []. */
export function mudancasDaDespesa(antes: CamposComparados, depois: CamposComparados, fotoTrocada = false): string[] {
  const m: string[] = [];
  if (antes.categoria !== depois.categoria) m.push(`Tipo: ${NOME_CATEGORIA[antes.categoria] ?? antes.categoria} → ${NOME_CATEGORIA[depois.categoria] ?? depois.categoria}`);
  if (Math.round(antes.valor * 100) !== Math.round(depois.valor * 100)) m.push(`Valor: ${moeda(antes.valor)} → ${moeda(depois.valor)}`);
  if (antes.data !== depois.data) m.push(`Dia: ${diaBR(antes.data)} → ${diaBR(depois.data)}`);
  if (antes.pagamento !== depois.pagamento) m.push(`Pagamento: ${PAGAMENTOS[antes.pagamento]} → ${PAGAMENTOS[depois.pagamento]}`);
  const da = (antes.descricao ?? "").trim(), dd = (depois.descricao ?? "").trim();
  if (da !== dd) m.push(`Descrição: ${da ? `“${da}”` : "(sem)"} → ${dd ? `“${dd}”` : "(sem)"}`);
  if (fotoTrocada) m.push("Foto do cupom trocada");
  return m;
}
/** D7 — o que a despesa excluída era (fica na trilha) */
export function resumoDaDespesa(d: CamposComparados): string {
  return [NOME_CATEGORIA[d.categoria] ?? d.categoria, moeda(d.valor), diaBR(d.data), PAGAMENTOS[d.pagamento], (d.descricao ?? "").trim() || null].filter(Boolean).join(" · ");
}
/** D7 — o técnico ainda pode corrigir/excluir? Só a dele que o escritório não decidiu (e que não deu erro ao enviar). */
export const podeCorrigirDespesa = (d: Pick<DespesaTela, "situacao" | "erroEnvio">) => d.situacao === "PENDENTE" && !d.erroEnvio;

/** O dia da despesa vale? Não pode ser no futuro nem mais antiga que DIAS_MAX_ATRAS (dias civis em Brasília). */
export function dataDespesaValida(dia: string, hoje: string): string | null {
  if (!DIA.test(dia) || Number.isNaN(Date.parse(`${dia}T12:00:00Z`))) return "Data inválida.";
  if (dia > hoje) return "A data não pode ser no futuro.";
  const dias = Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${dia}T12:00:00Z`)) / 86_400_000);
  if (dias > DIAS_MAX_ATRAS) return `Despesa com mais de ${DIAS_MAX_ATRAS} dias: fale com o escritório.`;
  return null;
}

/** "R$ 1.234,50" → 1234.5; inválido → NaN */
export function lerValor(t: string): number {
  const s = t.replace(/R\$\s?/i, "").replace(/\s/g, "");
  if (!s) return Number.NaN;
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return /^\d+(\.\d+)?$/.test(normal) ? arred(Number(normal)) : Number.NaN;
}

/* ───────── escritório ───────── */

export const recusaSchema = z.object({ motivo: z.string().trim().min(3, "Diga o motivo da recusa.").max(300) }).strict();
export const aprovacaoSchema = z.object({
  /** Vencimento do reembolso (só "do próprio bolso"), "AAAA-MM-DD" */
  vencimento: z.string().regex(DIA, "Informe o vencimento do reembolso.").optional(),
  /** Troca a categoria financeira só nesta aprovação (sem mexer no padrão) */
  categoriaId: z.string().min(1).max(64).optional(),
}).strict();

/** A categoria financeira ligada a cada categoria da despesa (o que a empresa configurou). */
export type MapaCategorias = Partial<Record<CategoriaDespesa, string>>;
export const mapaSchema = z.record(z.enum(IDS), z.string().min(1).max(64));

/** Lê o JSON gravado (lixo vira vazio; chaves desconhecidas saem). */
export function lerMapa(json: unknown): MapaCategorias {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const m: MapaCategorias = {};
  for (const c of IDS) { const v = (json as Record<string, unknown>)[c]; if (typeof v === "string" && v) m[c] = v; }
  return m;
}

/**
 * A categoria financeira do reembolso: a escolhida na aprovação; senão a do mapa; senão a de MESMO NOME (sem
 * diferença de maiúsculas/acentos) entre as ativas; senão null (o servidor cria a de mesmo nome).
 */
export function categoriaFinanceiraDe(
  categoria: CategoriaDespesa, op: { escolhida?: string | null; mapa: MapaCategorias; ativas: { id: string; nome: string }[] },
): string | null {
  const existe = (id?: string | null) => !!id && op.ativas.some((c) => c.id === id);
  if (existe(op.escolhida)) return op.escolhida!;
  if (existe(op.mapa[categoria])) return op.mapa[categoria]!;
  const alvo = normal(NOME_CATEGORIA[categoria]);
  return op.ativas.find((c) => normal(c.nome) === alvo)?.id ?? null;
}
const normal = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim();

/** A descrição da conta a pagar de reembolso */
export function descricaoReembolso(d: { categoria: CategoriaDespesa; data: string; osNumero?: string | null; descricao?: string | null }): string {
  const [a, m, dd] = d.data.split("-");
  return [`Reembolso de despesa de campo: ${NOME_CATEGORIA[d.categoria]}`, `${dd}/${m}/${a}`, d.osNumero, (d.descricao ?? "").trim() || null].filter(Boolean).join(" · ").slice(0, 300);
}

/** Uma despesa como o app mostra (só as do próprio colaborador) */
export interface DespesaTela {
  id: string | null; clientId: string; categoria: CategoriaDespesa; valor: number; data: string; pagamento: Pagamento;
  descricao: string | null; osNumero: string | null; situacao: SituacaoDespesa; motivoRecusa: string | null;
  /** Gravada no aparelho, ainda não enviada (a foto é a local) */
  pendente?: boolean; fotoLocal?: string;
  /** O servidor recusou o envio (fica no aparelho, com o motivo, até o técnico ver na fila) */
  erroEnvio?: string | null;
  /** D7 — a atividade da fila em que a despesa entrou (a correção vai atrás dela, na mesma ordem) */
  atividadeFila?: string;
  /** D7 — correção/exclusão ainda no aparelho */
  corrigidaNoAparelho?: boolean;
  /** D7 — a correção ou exclusão que o servidor recusou (ex.: o escritório já tinha decidido) */
  erroCorrecao?: string | null;
}

/** Resumo do topo da tela do escritório: o que espera decisão e quanto disso é reembolso */
export function resumoDespesas(l: { status: string; pagamento: string; valor: number }[]) {
  const pend = l.filter((d) => d.status === "PENDENTE");
  const soma = (x: { valor: number }[]) => Math.round(x.reduce((t, d) => t + d.valor, 0) * 100) / 100;
  return { pendentes: pend.length, totalPendente: soma(pend), aReembolsar: soma(pend.filter((d) => d.pagamento === "PROPRIO")) };
}

export const MSG_DESPESAS_DESLIGADAS = "Lançar despesas pelo app está desligado na empresa.";
export const MSG_SEM_COLABORADOR = "Seu usuário não está ligado a um colaborador. Fale com o escritório.";
export const MSG_JA_DECIDIDA = "Esta despesa já foi decidida.";
/** Despesa lançada fora de uma OS: a fila agrupa por este id no lugar da atividade */
export const SEM_OS = "sem-os";

/**
 * O que falta para lançar a despesa, na ordem da tela. Com o "Lançar" cinza, o técnico lê o que falta embaixo
 * (antes, o botão só ficava apagado, sem dizer por quê — ex.: faltava escolher a forma de pagamento).
 */
export function faltaNaDespesa(d: { categoria: boolean; valorOk: boolean; dataOk: boolean; pagamento: boolean; descricaoOk: boolean; foto: boolean }): string[] {
  const falta: string[] = [];
  if (!d.categoria) falta.push("o tipo");
  if (!d.valorOk) falta.push("o valor");
  if (!d.dataOk) falta.push("um dia válido");
  if (!d.pagamento) falta.push("quem pagou");
  if (!d.descricaoOk) falta.push("a descrição");
  if (!d.foto) falta.push("a foto do cupom");
  return falta;
}

/** "Falta: o valor e a foto do cupom." (null = pronta) */
export function textoFaltaDespesa(falta: readonly string[]): string | null {
  if (!falta.length) return null;
  const lista = falta.length === 1 ? falta[0] : `${falta.slice(0, -1).join(", ")} e ${falta[falta.length - 1]}`;
  return `Falta: ${lista}.`;
}
