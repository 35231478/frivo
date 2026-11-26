/**
 * Orçamento, leva D — a impressão do orçamento (regras puras, as mesmas no link do cliente, na impressão/PDF e na
 * versão interna):
 *
 * 1. Opções do documento, por orçamento (padrão da empresa em Configurações › Orçamentos):
 *    - "Mostrar materiais ao cliente": dentro de cada serviço, os materiais INCLUSOS nele (os de venda à parte já
 *      são linhas da tabela Produtos — não se repetem);
 *    - "Mostrar valores dos produtos/materiais": o PREÇO DE VENDA de cada material (unitário e total). Só vale com
 *      a primeira ligada.
 *    Desligado (o padrão) = como sempre: o cliente vê só a linha do serviço.
 *    O CUSTO nunca entra: o material do documento é montado campo a campo, sem o custo, e o preço só com a opção.
 *
 * 2. O número da OS vinculada vira link para a página pública que a OS já tem para o cliente: a "versão do
 *    cliente" (relatório GERAL, /relatorio/os/<token>) — o mesmo link que a tela da OS entrega ao cliente. A OS em
 *    si não tem link público (o cliente não tem login): sem esse relatório, o número fica só texto.
 */
import { numerosOsDoDocumento } from "@/lib/orcamentos/proposta";
import { repartir } from "@/lib/orcamentos/calculo";

export interface OpcoesDocumentoOrcamento {
  mostrarMateriais: boolean;
  mostrarValoresMateriais: boolean;
}

/** As opções efetivas: valores só com materiais ligado; qualquer coisa que não seja `true` = desligado. */
export function opcoesDoDocumento(o?: { mostrarMateriais?: boolean | null; mostrarValoresMateriais?: boolean | null } | null): OpcoesDocumentoOrcamento {
  const mostrarMateriais = o?.mostrarMateriais === true;
  return { mostrarMateriais, mostrarValoresMateriais: mostrarMateriais && o?.mostrarValoresMateriais === true };
}

/** O material como vem do banco (o custo pode até vir junto: aqui ele é ignorado, nunca copiado). */
export interface MaterialOrcamentoEntrada {
  descricao: string;
  unidade?: string | null;
  quantidade: unknown;
  valorVendaUnit?: unknown;
  comportamento: string;
  ordem?: number | null;
}

/** O material que vai ao documento do cliente: sem custo; valores nulos quando a opção de valores está desligada. */
export interface MaterialDocumento {
  descricao: string;
  quantidade: number;
  unidade: string;
  valorUnitario: number | null;
  valorTotal: number | null;
}

const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const round = (v: number, casas: number) => { const f = 10 ** casas; return Math.round((v + Number.EPSILON) * f) / f; };

/**
 * O fator de preço da linha do serviço no documento: o valor que o documento mostra ÷ o valor gravado. Na versão do
 * cliente com ISS, é o ISS embutido no serviço (ex.: 462 ÷ 440 = 1,05); sem ISS, ou na versão interna (ISS em linha
 * própria), é 1. Os materiais do serviço usam o MESMO fator: ficam na mesma base de preço do serviço.
 */
export function fatorPrecoDoServico(valorGravado: number, valorNoDocumento: number): number {
  if (!(valorGravado > 0) || !(valorNoDocumento > 0)) return 1;
  const f = valorNoDocumento / valorGravado;
  return Number.isFinite(f) ? f : 1;
}

/**
 * Os materiais de UM serviço no documento: só com "Mostrar materiais" ligado; só os INCLUSOS no serviço, com
 * quantidade e descrição, na ordem do orçamento. Preço de venda só com "Mostrar valores", na base de preço do serviço
 * (`fatorPreco`, ver fatorPrecoDoServico): a soma dos totais exibidos é exatamente Σ (preço × quantidade) × fator,
 * repartida sem perder centavo (lib/orcamentos/calculo → repartir, a mesma regra que embute o ISS nos serviços).
 */
export function materiaisNoDocumento(
  materiais: readonly MaterialOrcamentoEntrada[] | null | undefined,
  opcoes: OpcoesDocumentoOrcamento,
  fatorPreco = 1,
): MaterialDocumento[] {
  if (!opcoes.mostrarMateriais) return [];
  const lista = [...(materiais ?? [])]
    .filter((m) => m.comportamento === "INCLUSO_NO_SERVICO" && num(m.quantidade) > 0 && !!m.descricao?.trim())
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
    .map((m) => ({ descricao: m.descricao.trim(), quantidade: round(num(m.quantidade), 3), unidade: m.unidade?.trim() || "un", unitario: round(num(m.valorVendaUnit), 2) }));
  if (!opcoes.mostrarValoresMateriais) {
    return lista.map((m) => ({ descricao: m.descricao, quantidade: m.quantidade, unidade: m.unidade, valorUnitario: null, valorTotal: null }));
  }
  const brutos = lista.map((m) => round(m.quantidade * m.unitario, 2));
  const f = Number.isFinite(fatorPreco) && fatorPreco > 0 ? fatorPreco : 1;
  const totais = f === 1 ? brutos : repartir(round(brutos.reduce((a, b) => a + b, 0) * f, 2), brutos);
  return lista.map((m, i) => ({
    descricao: m.descricao, quantidade: m.quantidade, unidade: m.unidade,
    valorUnitario: f === 1 ? m.unitario : round(totais[i] / m.quantidade, 2),
    valorTotal: totais[i],
  }));
}

/** OS vinculada como o documento recebe (com a "versão do cliente" da OS, se houver). */
export interface OsVinculadaComLink {
  ordemServico: {
    numero: string;
    criadoEm?: Date | string | null;
    empresaId?: string | null;
    relatorios?: readonly { tokenPublico: string; escopo?: string | null; empresaId?: string | null }[] | null;
  } | null;
}

export interface OsNoDocumento {
  numero: string;
  /** Página pública da OS para o cliente (relativa: o navegador a completa com o endereço do sistema, também no PDF) */
  href: string | null;
}

const TOKEN_VALIDO = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * As OS do cabeçalho do documento (mesma ordem e regras de `numerosOsDoDocumento`: só da empresa do orçamento, sem
 * repetir), cada uma com o link público da sua "versão do cliente" — o relatório GERAL da OS, da mesma empresa.
 * Sem relatório GERAL (a OS ainda não foi concluída), o número fica sem link. Nunca um endereço interno.
 */
export function osDoDocumento(vinculos: readonly OsVinculadaComLink[] | null | undefined, empresaId?: string | null): OsNoDocumento[] {
  const daEmpresa = (vinculos ?? []).map((v) => v.ordemServico)
    .filter((os): os is NonNullable<OsVinculadaComLink["ordemServico"]> => !!os && (!empresaId || !os.empresaId || os.empresaId === empresaId));
  return numerosOsDoDocumento(vinculos, empresaId).map((numero) => {
    const token = daEmpresa
      .filter((os) => os.numero?.trim() === numero)
      .flatMap((os) => os.relatorios ?? [])
      .find((r) => (r.escopo ?? "GERAL") === "GERAL" && (!empresaId || !r.empresaId || r.empresaId === empresaId) && TOKEN_VALIDO.test(r.tokenPublico ?? ""))
      ?.tokenPublico;
    return { numero, href: token ? `/relatorio/os/${token}` : null };
  });
}

/**
 * Até quando as opções do documento se mudam: enquanto o orçamento está em jogo (rascunho, enviado, visualizado,
 * recusado — dá para reenviar). Aprovado (ou convertido) o documento fica como o cliente aprovou; cancelado, nada muda.
 */
const STATUS_TRAVADOS = ["APROVADO", "CONVERTIDA", "CANCELADO"] as const;
export const STATUS_OPCOES_TRAVADAS: readonly string[] = STATUS_TRAVADOS;

export function opcoesDocumentoEditaveis(status: string): boolean {
  return !STATUS_OPCOES_TRAVADAS.includes(status);
}

/** O porquê do cadeado (para a tela e para o 409 da rota). */
export function motivoOpcoesTravadas(status: string): string | null {
  if (opcoesDocumentoEditaveis(status)) return null;
  return status === "CANCELADO"
    ? "Orçamento cancelado: as opções do documento não mudam."
    : "Orçamento aprovado: o documento fica como o cliente aprovou.";
}
