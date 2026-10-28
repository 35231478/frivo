/**
 * NFS-e — a empresa como EMITENTE (gateway PlugNotas): regras puras (servidor, tela e testes usam as
 * mesmas). Rótulos dos regimes, o que ainda falta para cadastrar o emitente, o corpo que vai para o
 * PlugNotas (POST/PATCH /empresa), o status mostrado na tela e as mensagens de erro em português.
 *
 * Mapeamento para o PlugNotas (campos `simplesNacional`, `regimeTributario`, `regimeTributarioEspecial`):
 *   Simples Nacional → simplesNacional true,  regimeTributario 1
 *   MEI              → simplesNacional true,  regimeTributario 1, regimeTributarioEspecial 5
 *   Lucro Presumido  → simplesNacional false, regimeTributario 3 (regime normal)
 *   Lucro Real       → simplesNacional false, regimeTributario 3 (regime normal)
 */

export const REGIMES = ["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL", "MEI"] as const;
export type Regime = (typeof REGIMES)[number];
export const LABEL_REGIME: Record<Regime, string> = {
  SIMPLES_NACIONAL: "Simples Nacional",
  LUCRO_PRESUMIDO: "Lucro Presumido",
  LUCRO_REAL: "Lucro Real",
  MEI: "MEI (Microempreendedor Individual)",
};

/** Regime especial de tributação (do município); o código é o do PlugNotas */
export const REGIMES_ESPECIAIS = [
  { id: "MICROEMPRESA_MUNICIPAL", label: "Microempresa municipal", codigo: 1 },
  { id: "ESTIMATIVA", label: "Estimativa", codigo: 2 },
  { id: "SOCIEDADE_PROFISSIONAIS", label: "Sociedade de profissionais", codigo: 3 },
  { id: "COOPERATIVA", label: "Cooperativa", codigo: 4 },
  { id: "MEI", label: "Microempreendedor individual (MEI)", codigo: 5 },
  { id: "ME_EPP_SIMPLES", label: "ME/EPP do Simples Nacional", codigo: 6 },
] as const;
export type RegimeEspecial = (typeof REGIMES_ESPECIAIS)[number]["id"];
export const ehRegimeEspecial = (v: unknown): v is RegimeEspecial => REGIMES_ESPECIAIS.some((r) => r.id === v);

export const AMBIENTES = ["HOMOLOGACAO", "PRODUCAO"] as const;
export type Ambiente = (typeof AMBIENTES)[number];
export const LABEL_AMBIENTE: Record<Ambiente, string> = { HOMOLOGACAO: "Homologação (testes)", PRODUCAO: "Produção" };

export type StatusEmitente = "NAO_CONFIGURADO" | "PENDENTE" | "ATIVO" | "ERRO";
export const LABEL_STATUS: Record<StatusEmitente, string> = {
  NAO_CONFIGURADO: "Não configurado",
  PENDENTE: "Configuração incompleta",
  ATIVO: "Emitente ativo no PlugNotas",
  ERRO: "Erro no PlugNotas",
};

/** Avisar a renovação do certificado quando faltar até isto */
export const DIAS_AVISO_CERTIFICADO = 30;
const DIA = 86_400_000;

export const soDigitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
export const ehCodigoIbge = (v: string | null | undefined) => /^\d{7}$/.test(v ?? "");

/** Dias inteiros até o certificado vencer (negativo = já venceu) */
export function diasParaVencer(validoAte: Date, agora: Date = new Date()): number {
  return Math.floor((validoAte.getTime() - agora.getTime()) / DIA);
}

export interface EmpresaEmitente {
  cnpj: string; nome: string; nomeFantasia?: string | null; email?: string | null; telefone?: string | null;
  endereco?: string | null; numero?: string | null; complemento?: string | null; bairro?: string | null;
  cidade?: string | null; estado?: string | null; cep?: string | null;
  inscricaoMunicipal?: string | null; inscricaoEstadual?: string | null;
}
export interface DadosFiscais {
  regimeTributario: Regime | null; regimeEspecial: RegimeEspecial | null;
  incentivoFiscal: boolean; incentivadorCultural: boolean; ambiente: Ambiente;
  codigoMunicipio: string | null; municipioNome: string | null; municipioUf: string | null;
}

/**
 * O que ainda falta para cadastrar o emitente no PlugNotas (vazio = pode enviar).
 * `temCertificado`: já há certificado lá, ou um .pfx válido veio agora.
 */
export function pendenciasEmitente(e: EmpresaEmitente, f: DadosFiscais, temCertificado: boolean): string[] {
  const p: string[] = [];
  if (soDigitos(e.cnpj).length !== 14) p.push("CNPJ da empresa (14 dígitos) em Dados da empresa");
  if (!e.nome?.trim()) p.push("Razão social em Dados da empresa");
  if (!soDigitos(e.inscricaoMunicipal)) p.push("Inscrição municipal");
  if (!f.regimeTributario) p.push("Regime tributário");
  const faltaEndereco = [
    [e.endereco, "logradouro"], [e.numero, "número"], [e.bairro, "bairro"],
  ].filter(([v]) => !v?.toString().trim()).map(([, n]) => n);
  if (soDigitos(e.cep).length !== 8) faltaEndereco.push("CEP");
  if (faltaEndereco.length) p.push(`Endereço da empresa: ${faltaEndereco.join(", ")} (em Dados da empresa)`);
  if (!ehCodigoIbge(f.codigoMunicipio)) p.push("Município com o código IBGE (7 dígitos)");
  if (!f.municipioUf || f.municipioUf.length !== 2) p.push("UF do município");
  if (!temCertificado) p.push("Certificado digital A1 (.pfx) e a senha");
  return p;
}

/** Telefone no formato do PlugNotas ({ ddd, numero }) ou nada */
function telefonePlug(t: string | null | undefined) {
  const d = soDigitos(t);
  return d.length >= 10 ? { ddd: d.slice(0, 2), numero: d.slice(2) } : undefined;
}

/** Corpo do emitente para POST /empresa e PATCH /empresa/{cpfCnpj} no PlugNotas */
export function corpoEmpresaPlugNotas(e: EmpresaEmitente, f: DadosFiscais, certificadoId: string) {
  const regime = f.regimeTributario!;
  const simples = regime === "SIMPLES_NACIONAL" || regime === "MEI";
  const especial = regime === "MEI" ? 5 : REGIMES_ESPECIAIS.find((r) => r.id === f.regimeEspecial)?.codigo ?? 0;
  const telefone = telefonePlug(e.telefone);
  return {
    cpfCnpj: soDigitos(e.cnpj),
    inscricaoMunicipal: soDigitos(e.inscricaoMunicipal),
    ...(soDigitos(e.inscricaoEstadual) ? { inscricaoEstadual: soDigitos(e.inscricaoEstadual) } : {}),
    razaoSocial: e.nome.trim(),
    nomeFantasia: (e.nomeFantasia?.trim() || e.nome).trim(),
    certificado: certificadoId,
    simplesNacional: simples,
    regimeTributario: simples ? 1 : 3,
    regimeTributarioEspecial: especial,
    incentivoFiscal: f.incentivoFiscal,
    incentivadorCultural: f.incentivadorCultural,
    endereco: {
      logradouro: e.endereco!.trim(),
      numero: e.numero!.trim(),
      ...(e.complemento?.trim() ? { complemento: e.complemento.trim() } : {}),
      bairro: e.bairro!.trim(),
      codigoPais: "1058",
      descricaoPais: "Brasil",
      codigoCidade: f.codigoMunicipio!,
      descricaoCidade: f.municipioNome?.trim() || e.cidade?.trim() || "",
      estado: f.municipioUf!.toUpperCase(),
      cep: soDigitos(e.cep),
    },
    ...(telefone ? { telefone } : {}),
    ...(e.email?.trim() ? { email: e.email.trim() } : {}),
    // Só NFS-e por enquanto; producao=false = homologação na prefeitura
    nfse: { ativo: true, tipoContrato: 0, config: { producao: f.ambiente === "PRODUCAO" } },
  };
}

/**
 * Mensagem em português para um erro do PlugNotas ({ error: { message, data } }), sem repetir
 * nada sensível (o corpo de erro deles nunca traz o certificado nem a senha; mesmo assim só lemos
 * a mensagem e os nomes de campos).
 */
export function mensagemErroPlugNotas(status: number, corpo: unknown): string {
  const err = (corpo as { error?: { message?: unknown; data?: unknown } } | null)?.error;
  const msg = typeof err?.message === "string" ? err.message.trim() : "";
  const campos = err?.data && typeof err.data === "object" ? Object.keys(err.data as object).slice(0, 5) : [];
  const t = msg.toLowerCase();
  if (status === 401 || status === 403) return "O PlugNotas recusou o acesso: o token da integração (PLUGNOTAS_API_TOKEN) é inválido ou não tem permissão.";
  if (/senha/.test(t)) return "O PlugNotas recusou o certificado: a senha não confere.";
  if (/vencid|expirad/.test(t)) return "O PlugNotas recusou o certificado: ele está vencido.";
  if (status === 429) return "O PlugNotas limitou as requisições agora. Tente de novo em alguns minutos.";
  if (status >= 500) return `O PlugNotas está fora do ar ou com erro (${status}). Tente de novo mais tarde.`;
  const base = msg || `O PlugNotas recusou os dados (${status}).`;
  return campos.length ? `${base} Campos: ${campos.join(", ")}.` : base;
}

/** Como a tela mostra o certificado: validade, dias que faltam e o tom do aviso */
export function situacaoCertificado(validoAte: Date | null, agora: Date = new Date()) {
  if (!validoAte) return null;
  const dias = diasParaVencer(validoAte, agora);
  return {
    dias,
    vencido: dias < 0,
    vencendo: dias >= 0 && dias <= DIAS_AVISO_CERTIFICADO,
  };
}
