/**
 * Orçamento, leva D — a impressão do orçamento (regras puras, as mesmas no link do cliente, na impressão/PDF e na
 * versão interna):
 *
 * 1. Opção do documento, por orçamento (padrão da empresa em Configurações › Orçamentos): "Mostrar materiais ao
 *    cliente" — dentro de cada serviço, os MATERIAIS dele, só descrição e quantidade, SEM valor (o material vai
 *    embutido no preço do serviço). As PEÇAS já são linhas próprias, com valor, na tabela Produtos (não se repetem).
 *    Desde "Orçamento E" vem LIGADA por padrão, e o documento não mostra mais o valor de material nenhum (a opção
 *    "Mostrar valores" saiu da tela; a coluna do banco fica). O CUSTO nunca entra: o material do documento é
 *    montado campo a campo.
 *
 * 2. O número da OS vinculada vira link para a página pública que a OS já tem para o cliente: a "versão do
 *    cliente" (relatório GERAL, /relatorio/os/<token>) — o mesmo link que a tela da OS entrega ao cliente. A OS em
 *    si não tem link público (o cliente não tem login): sem esse relatório, o número fica só texto.
 */
import { numerosOsDoDocumento } from "@/lib/orcamentos/proposta";

export interface OpcoesDocumentoOrcamento {
  mostrarMateriais: boolean;
}

/**
 * A opção efetiva: só `false` explícito desliga — ausente/nulo (orçamento antigo lido sem a coluna) segue o padrão
 * novo, LIGADO. Outros campos que venham junto (ex.: o antigo "mostrar valores") são ignorados.
 */
export function opcoesDoDocumento(o?: { mostrarMateriais?: boolean | null } | null): OpcoesDocumentoOrcamento {
  return { mostrarMateriais: o?.mostrarMateriais !== false };
}

/** O material como vem do banco (o custo pode até vir junto: aqui ele é ignorado, nunca copiado). */
export interface MaterialOrcamentoEntrada {
  descricao: string;
  unidade?: string | null;
  quantidade: unknown;
  comportamento: string;
  ordem?: number | null;
}

/** O material que vai ao documento do cliente: descrição e quantidade. Nunca valor, nunca custo. */
export interface MaterialDocumento {
  descricao: string;
  quantidade: number;
  unidade: string;
}

const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const round = (v: number, casas: number) => { const f = 10 ** casas; return Math.round((v + Number.EPSILON) * f) / f; };

/**
 * Os materiais de UM serviço no documento: só com "Mostrar materiais" ligado; só os MATERIAIS (incluso no serviço),
 * com quantidade e descrição, na ordem do orçamento. Peça não entra aqui (é linha própria, com valor).
 */
export function materiaisNoDocumento(
  materiais: readonly MaterialOrcamentoEntrada[] | null | undefined,
  opcoes: OpcoesDocumentoOrcamento,
): MaterialDocumento[] {
  if (!opcoes.mostrarMateriais) return [];
  return [...(materiais ?? [])]
    .filter((m) => m.comportamento === "INCLUSO_NO_SERVICO" && num(m.quantidade) > 0 && !!m.descricao?.trim())
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
    .map((m) => ({ descricao: m.descricao.trim(), quantidade: round(num(m.quantidade), 3), unidade: m.unidade?.trim() || "un" }));
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
