/**
 * NFS-e — dados fiscais do SERVIÇO (regras puras: cadastro, importação, emissão e testes usam as
 * mesmas). Normaliza o código LC 116 e o CNAE, valida a alíquota, traduz a tributação do ISS
 * escolhida na tela para os códigos do PlugNotas e monta o objeto `servico` da emissão (PR3).
 *
 * Tributação do ISS → PlugNotas (`iss.tipoTributacao` / `iss.exigibilidade`), pela documentação deles:
 *   tipoTributacao: 1 Isento · 2 Imune · 3 Não incidência no município · 4 Não tributável · 5 Retido
 *                   · 6 Tributável dentro do município · 7 Tributável fora do município
 *                   · 8 Tributável dentro do município pelo tomador
 *   exigibilidade:  1 Exigível · 2 Não incidência · 3 Isenção · 4 Exportação · 5 Imunidade
 *                   · 6 Suspensa por decisão judicial · 7 Suspensa por processo administrativo
 * ISS retido pelo tomador: `iss.retido = true` + `responsavelRetencao = 1` (tomador).
 */
import { descricaoLc116 } from "@/lib/nfse/lc116";

export const TRIBUTACOES_ISS = [
  { id: "TRIBUTAVEL", label: "Tributável no município", ajuda: "Padrão: o ISS é devido ao município da emissão", tipoTributacao: 6, exigibilidade: 1 },
  { id: "ISENTO", label: "Isento", ajuda: "Isenção prevista na lei do município", tipoTributacao: 1, exigibilidade: 3 },
  { id: "IMUNE", label: "Imune", ajuda: "Imunidade constitucional", tipoTributacao: 2, exigibilidade: 5 },
  { id: "NAO_INCIDENCIA", label: "Não incidência no município", ajuda: "O serviço não gera ISS neste município", tipoTributacao: 3, exigibilidade: 2 },
  { id: "SUSPENSA_JUDICIAL", label: "Exigibilidade suspensa (decisão judicial)", ajuda: "ISS suspenso por decisão judicial", tipoTributacao: 6, exigibilidade: 6 },
  { id: "SUSPENSA_ADMINISTRATIVA", label: "Exigibilidade suspensa (processo administrativo)", ajuda: "ISS suspenso por processo administrativo", tipoTributacao: 6, exigibilidade: 7 },
] as const;
export type TributacaoIss = (typeof TRIBUTACOES_ISS)[number]["id"];
export const TRIBUTACAO_PADRAO: TributacaoIss = "TRIBUTAVEL";
export const ehTributacaoIss = (v: unknown): v is TributacaoIss => TRIBUTACOES_ISS.some((t) => t.id === v);
/** Vazio/desconhecido = o padrão (tributável no município, exigível) */
export const tributacaoIss = (v: unknown) => TRIBUTACOES_ISS.find((t) => t.id === v) ?? TRIBUTACOES_ISS[0];
/** Só com ISS a pagar faz sentido exigir a alíquota (tributável ou suspenso) */
const temIss = (id: TributacaoIss) => id === "TRIBUTAVEL" || id === "SUSPENSA_JUDICIAL" || id === "SUSPENSA_ADMINISTRATIVA";

const so = (v: string) => v.replace(/\D/g, "");

/**
 * Código LC 116 no formato "NN.NN" (aceita "14.01", "1401", "7.02", "702" e espaços). Vazio = null.
 * Grupo 1–40 (os itens da lei) e subitem 01–99.
 */
export function normalizarLc116(v: unknown): { codigo: string | null; erro?: string } {
  const t = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  if (!t) return { codigo: null };
  const m = /^(\d{1,2})\.?(\d{2})$/.exec(t.replace(/\s+/g, ""));
  const grupo = m ? Number(m[1]) : 0;
  if (!m || grupo < 1 || grupo > 40 || m[2] === "00") {
    return { codigo: null, erro: "Código LC 116 inválido: use o subitem da lista, no formato NN.NN (ex.: 14.01)." };
  }
  return { codigo: `${String(grupo).padStart(2, "0")}.${m[2]}` };
}

/** CNAE (subclasse) com 7 dígitos; aceita "4321-5/00". Vazio = null. */
export function normalizarCnae(v: unknown): { cnae: string | null; erro?: string } {
  const t = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  if (!t) return { cnae: null };
  const d = so(t);
  if (d.length !== 7 || /[^\d\s./-]/.test(t)) return { cnae: null, erro: "CNAE inválido: use os 7 dígitos da subclasse (ex.: 4321-5/00)." };
  return { cnae: d };
}

/**
 * CNAE que vai na nota: o próprio do serviço; vazio = o CNAE principal da empresa; nenhum = null.
 * (O cadastro do serviço guarda o próprio só quando a pessoa desmarca "Usar o CNAE principal da empresa".)
 */
export const cnaeEfetivo = (cnaeServico: string | null | undefined, cnaeEmpresa: string | null | undefined) =>
  normalizarCnae(cnaeServico).cnae ?? normalizarCnae(cnaeEmpresa).cnae;

/** "4321500" → "4321-5/00" (só para mostrar) */
export const formatarCnae = (c: string | null | undefined) => (c && /^\d{7}$/.test(c) ? `${c.slice(0, 4)}-${c[4]}/${c.slice(5)}` : c ?? "");

/** Alíquota de ISS: 0 a 100 (%). null = não informada. */
export function erroAliquota(v: number | null | undefined): string | null {
  if (v == null) return null;
  return v >= 0 && v <= 100 ? null : "Alíquota de ISS deve estar entre 0 e 100%.";
}

/** O que o serviço precisa ter guardado para a emissão da nota */
export interface ServicoFiscal {
  nome: string;
  codigoLc116?: string | null;
  codigoMunicipal?: string | null;
  aliquotaISS?: number | null;
  nfseTributacao?: string | null;
  issRetido?: boolean | null;
  cnae?: string | null;
  discriminacaoPadrao?: string | null;
}

/**
 * O que falta para EMITIR a nota com este serviço (salvar o serviço não exige nada disto).
 * `aliquotaPadrao`: o ISS da empresa (usado quando o serviço não tem alíquota própria).
 */
export function pendenciasServicoNfse(s: ServicoFiscal, aliquotaPadrao?: number | null): string[] {
  const p: string[] = [];
  if (!normalizarLc116(s.codigoLc116).codigo) p.push("Código do serviço (LC 116)");
  const trib = tributacaoIss(s.nfseTributacao);
  const aliquota = s.aliquotaISS ?? aliquotaPadrao ?? null;
  if (temIss(trib.id) && !(aliquota != null && aliquota > 0)) p.push("Alíquota de ISS");
  return p;
}

/**
 * O objeto `servico` da emissão no PlugNotas (PR3 completa o `valor` e o resto da nota):
 * { codigo, codigoTributacao, discriminacao, cnae?, iss: { tipoTributacao, exigibilidade, aliquota, retido }, responsavelRetencao?, valor }
 * `codigoTributacao` vazio = o próprio código LC 116; `discriminacao` vazia = a padrão do serviço, senão o nome;
 * `cnae` = o do serviço, senão o principal da empresa (`cnaeEmpresa`).
 */
export function servicoPlugNotas(
  s: ServicoFiscal, o: { valor: number; discriminacao?: string | null; aliquotaPadrao?: number | null; cnaeEmpresa?: string | null },
) {
  const codigo = normalizarLc116(s.codigoLc116).codigo;
  if (!codigo) throw new Error(`O serviço “${s.nome}” não tem o código LC 116.`);
  const trib = tributacaoIss(s.nfseTributacao);
  const cnae = cnaeEfetivo(s.cnae, o.cnaeEmpresa);
  return {
    codigo,
    codigoTributacao: s.codigoMunicipal?.trim() || codigo,
    discriminacao: o.discriminacao?.trim() || s.discriminacaoPadrao?.trim() || s.nome.trim(),
    ...(cnae ? { cnae } : {}),
    iss: {
      tipoTributacao: trib.tipoTributacao,
      exigibilidade: trib.exigibilidade,
      aliquota: s.aliquotaISS ?? o.aliquotaPadrao ?? 0,
      retido: !!s.issRetido,
    },
    ...(s.issRetido ? { responsavelRetencao: 1 } : {}),
    valor: { servico: o.valor },
  };
}

/** Rótulo do código LC 116 para mostrar ("14.01 — Lubrificação, limpeza…") */
export function rotuloLc116(codigo: string | null | undefined): string {
  const n = normalizarLc116(codigo).codigo;
  if (!n) return codigo ?? "";
  const d = descricaoLc116(n);
  return d ? `${n} — ${d}` : n;
}
