/**
 * "Aplicar dados fiscais (NFS-e)" em massa nos serviços — regras puras (tela, rota e testes).
 * Só os campos PREENCHIDOS são aplicados (vazio = não altera). O CNAE tem três escolhas: não
 * alterar, "usar o CNAE principal da empresa" (limpa o CNAE próprio) ou um CNAE próprio.
 * A validação é a MESMA do cadastro do serviço (schema do registro).
 */
import { CADASTROS, CAMPOS_NFSE_SERVICO, mensagemValidacao, mesmoValor } from "@/lib/cadastros/registro";
import { formatarCnae, TRIBUTACAO_PADRAO } from "@/lib/nfse/servico";

export const CAMPOS_FISCAIS = CAMPOS_NFSE_SERVICO.map((c) => c.key);
const ACEITOS = new Set(CAMPOS_FISCAIS);
const vazio = (v: unknown) => v === undefined || v === null || (typeof v === "string" && !v.trim());

/**
 * O que vai ser aplicado a partir do que veio da tela: campo vazio sai (não altera); `cnae: null`
 * ou "" = usar o CNAE da empresa (grava vazio). Campo que não é fiscal = erro; nada para aplicar = erro.
 * Devolve os valores já normalizados pelo schema do cadastro ("1401" → "14.01", "2,5" → 2.5…).
 */
export function camposParaAplicar(entrada: Record<string, unknown>): { ok: true; dados: Record<string, unknown> } | { ok: false; erro: string } {
  const estranhos = Object.keys(entrada).filter((k) => !ACEITOS.has(k));
  if (estranhos.length) return { ok: false, erro: `Campo não permitido: ${estranhos.join(", ")}.` };
  const informados: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entrada)) {
    if (k === "cnae" && v !== undefined) informados.cnae = vazio(v) ? null : v;
    else if (!vazio(v)) informados[k] = v;
  }
  if (!Object.keys(informados).length) return { ok: false, erro: "Preencha ao menos um campo para aplicar." };
  const r = CADASTROS.servicos.schemaEditar.safeParse(informados);
  if (!r.success) return { ok: false, erro: mensagemValidacao(r.error, CADASTROS.servicos) };
  const dados = r.data as Record<string, unknown>;
  // "Tributável no município" é o padrão: grava vazio, como o cadastro (senão o modelo copiado "mudaria")
  if (dados.nfseTributacao === TRIBUTACAO_PADRAO) dados.nfseTributacao = null;
  return { ok: true, dados };
}

/** Só o que muda neste serviço (o resto já está igual: "já estava assim") */
export const mudancasServico = (atual: Record<string, unknown>, dados: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(dados).filter(([k, v]) => !mesmoValor(v, atual[k])));

/** Rótulos dos campos (para o resultado e o log): "Código do serviço (LC 116), CNAE" */
export const rotulosCampos = (chaves: string[]) =>
  CAMPOS_NFSE_SERVICO.filter((c) => chaves.includes(c.key)).map((c) => c.label).join(", ");

/* ───────── Formulário da tela ───────── */
export type ModoCnae = "manter" | "empresa" | "proprio";
export interface FormAplicarFiscal {
  codigoLc116: string;
  codigoMunicipal: string;
  cnaeModo: ModoCnae;
  cnae: string;
  /** "" = não alterar */
  nfseTributacao: string;
  aliquotaISS: string;
  /** "" = não alterar */
  issRetido: "" | "true" | "false";
  discriminacaoPadrao: string;
}

export const FORM_VAZIO: FormAplicarFiscal = {
  codigoLc116: "", codigoMunicipal: "", cnaeModo: "manter", cnae: "", nfseTributacao: "", aliquotaISS: "", issRetido: "", discriminacaoPadrao: "",
};

/** O corpo que vai para o servidor: só o que foi preenchido */
export function dadosDoForm(f: FormAplicarFiscal): Record<string, string | null> {
  const d: Record<string, string | null> = {};
  for (const k of ["codigoLc116", "codigoMunicipal", "nfseTributacao", "aliquotaISS", "issRetido", "discriminacaoPadrao"] as const) {
    if (f[k].trim()) d[k] = f[k].trim();
  }
  if (f.cnaeModo === "empresa") d.cnae = null;
  if (f.cnaeModo === "proprio" && f.cnae.trim()) d.cnae = f.cnae.trim();
  return d;
}

/** Quantos campos vão ser aplicados (0 = nada a fazer) */
export const totalCampos = (f: FormAplicarFiscal) => Object.keys(dadosDoForm(f)).length;

/** Pré-preenche a partir de um serviço já configurado ("copiar de um serviço modelo"): tudo vem preenchido */
export function formDoModelo(s: Record<string, unknown>): FormAplicarFiscal {
  const txt = (v: unknown) => (v == null ? "" : String(v));
  const cnae = txt(s.cnae);
  return {
    codigoLc116: txt(s.codigoLc116),
    codigoMunicipal: txt(s.codigoMunicipal),
    cnaeModo: cnae ? "proprio" : "empresa",
    cnae: formatarCnae(cnae),
    nfseTributacao: txt(s.nfseTributacao) || "TRIBUTAVEL",
    aliquotaISS: txt(s.aliquotaISS).replace(".", ","),
    issRetido: s.issRetido ? "true" : "false",
    discriminacaoPadrao: txt(s.discriminacaoPadrao),
  };
}
