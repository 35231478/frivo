/**
 * NFS-e — a empresa como EMITENTE (gateway PlugNotas): regras puras (servidor, tela e testes usam as
 * mesmas). Rótulos dos regimes, o que ainda falta para cadastrar o emitente, o corpo que vai para o
 * PlugNotas (POST/PATCH /empresa), o status mostrado na tela e as mensagens de erro em português.
 *
 * Mapeamento para o PlugNotas (campos `simplesNacional`, `regimeTributario`, `regimeTributarioEspecial`),
 * pelos códigos da documentação do cadastro de empresa deles:
 *   regimeTributario: 0 Nenhum · 1 Simples Nacional · 2 Simples Nacional (excesso de sublimite)
 *                     · 3 Normal – Lucro Presumido · 4 Normal – Lucro Real
 *   Simples Nacional → simplesNacional true,  regimeTributario 1
 *   MEI              → simplesNacional true,  regimeTributario 1, regimeTributarioEspecial 5
 *   Lucro Presumido  → simplesNacional false, regimeTributario 3
 *   Lucro Real       → simplesNacional false, regimeTributario 4
 *   regimeTributarioEspecial: 0 nenhum, ou o código de REGIMES_ESPECIAIS (1 a 6)
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

/** O certificado A1 é um arquivo PKCS#12: termina em .pfx ou .p12 */
export const EXTENSOES_CERTIFICADO = [".pfx", ".p12"] as const;
/** `accept` do input: as extensões e o tipo MIME (alguns celulares filtram só pelo tipo) */
export const ACEITA_CERTIFICADO = `${EXTENSOES_CERTIFICADO.join(",")},application/x-pkcs12`;
export const ehArquivoCertificado = (nome: string | null | undefined) => /\.(pfx|p12)$/i.test((nome ?? "").trim());
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

/** Código do PlugNotas para o regime tributário (ver o cabeçalho) */
export const CODIGO_REGIME: Record<Regime, number> = { SIMPLES_NACIONAL: 1, MEI: 1, LUCRO_PRESUMIDO: 3, LUCRO_REAL: 4 };

/** Abreviações/nomes comuns no começo do logradouro → o `tipoLogradouro` do PlugNotas */
const TIPOS_LOGRADOURO: [RegExp, string][] = [
  [/^(av|avda|avenida)\.?\s+/i, "Avenida"],
  [/^(rod|rodovia)\.?\s+/i, "Rodovia"],
  [/^(r|rua)\.?\s+/i, "Rua"],
  [/^(al|alameda)\.?\s+/i, "Alameda"],
  [/^(tv|trav|travessa)\.?\s+/i, "Travessa"],
  [/^(estr|estrada)\.?\s+/i, "Estrada"],
  [/^(pç|pc|pca|pça|praça|praca)\.?\s+/i, "Praça"],
  [/^(lg|lgo|largo)\.?\s+/i, "Largo"],
  [/^(qd|quadra)\.?\s+/i, "Quadra"],
  [/^via\s+/i, "Via"],
];

/**
 * Separa o tipo do logradouro ("Av. Paulista" → Avenida + "Paulista"). Sem tipo reconhecível, vai
 * "Rua" com o logradouro inteiro (o PlugNotas exige o campo; a prefeitura recebe o texto completo).
 */
export function separarLogradouro(logradouro: string): { tipoLogradouro: string; logradouro: string } {
  const l = logradouro.trim().replace(/\s+/g, " ");
  for (const [re, tipo] of TIPOS_LOGRADOURO) {
    const resto = l.replace(re, "");
    if (resto !== l) return { tipoLogradouro: tipo, logradouro: resto };
  }
  return { tipoLogradouro: "Rua", logradouro: l };
}

/**
 * Corpo do emitente para POST /empresa e PATCH /empresa/{cpfCnpj} no PlugNotas — exatamente os
 * campos do exemplo oficial da coleção do sandbox (nada além: campo desconhecido reprova o JSON).
 */
export function corpoEmpresaPlugNotas(e: EmpresaEmitente, f: DadosFiscais, certificadoId: string) {
  const regime = f.regimeTributario!;
  const simples = regime === "SIMPLES_NACIONAL" || regime === "MEI";
  const especial = regime === "MEI" ? 5 : REGIMES_ESPECIAIS.find((r) => r.id === f.regimeEspecial)?.codigo ?? 0;
  const { tipoLogradouro, logradouro } = separarLogradouro(e.endereco!);
  return {
    cpfCnpj: soDigitos(e.cnpj),
    razaoSocial: e.nome.trim(),
    inscricaoMunicipal: soDigitos(e.inscricaoMunicipal),
    simplesNacional: simples,
    regimeTributario: CODIGO_REGIME[regime],
    regimeTributarioEspecial: especial,
    incentivoFiscal: f.incentivoFiscal,
    incentivadorCultural: f.incentivadorCultural,
    certificado: certificadoId,
    endereco: {
      codigoPais: "1058",
      descricaoPais: "Brasil",
      tipoLogradouro,
      logradouro,
      numero: e.numero!.trim(),
      ...(e.complemento?.trim() ? { complemento: e.complemento.trim() } : {}),
      tipoBairro: "Bairro",
      bairro: e.bairro!.trim(),
      codigoCidade: f.codigoMunicipio!,
      descricaoCidade: f.municipioNome?.trim() || e.cidade?.trim() || "",
      estado: f.municipioUf!.toUpperCase(),
      cep: soDigitos(e.cep),
    },
    // Só NFS-e por enquanto; producao=false = homologação. O Frivo envia a nota por conta própria.
    nfse: { ativo: true, tipoContrato: 0, config: { producao: f.ambiente === "PRODUCAO", email: { envio: false } } },
  };
}

export type CorpoEmpresaPlugNotas = ReturnType<typeof corpoEmpresaPlugNotas>;

/**
 * Mensagem em português para um erro do PlugNotas ({ error: { message, data } }), sem repetir
 * nada sensível (o corpo de erro deles nunca traz o certificado nem a senha; mesmo assim só lemos
 * a mensagem e os nomes de campos).
 */
const MAX_CAMPOS = 8;
const texto = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "");

/**
 * Os campos reprovados na validação do PlugNotas, como "campo (motivo)". Aceita os formatos que a
 * API usa para `fields`: objeto { "endereco.cep": "motivo" } (aninhado ou não, motivo em texto ou
 * lista) ou lista de textos / de { campo|field|path|dataPath, mensagem|message } .
 */
export function camposReprovados(fields: unknown): string[] {
  const saida: string[] = [];
  const add = (campo: string, motivo: string) => {
    if (saida.length >= MAX_CAMPOS) return;
    const c = campo.replace(/^[./]+/, "").replace(/\//g, ".");
    const m = motivo.slice(0, 120);
    const item = c && m ? `${c} (${m})` : c || m;
    if (item && !saida.includes(item)) saida.push(item);
  };
  const andar = (v: unknown, caminho: string, prof: number) => {
    if (prof > 4 || saida.length >= MAX_CAMPOS) return;
    if (Array.isArray(v)) {
      if (v.every((x) => texto(x) || x == null)) { add(caminho, v.map(texto).filter(Boolean).join("; ")); return; }
      for (const x of v) andar(x, caminho, prof + 1);
      return;
    }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const campoItem = texto(o.campo ?? o.field ?? o.path ?? o.dataPath ?? o.instancePath ?? o.property ?? o.name);
      const motivoItem = texto(o.mensagem ?? o.message ?? o.msg ?? o.error ?? o.erro);
      const faltando = texto((o.params as Record<string, unknown> | undefined)?.missingProperty);
      if (campoItem || motivoItem) {
        add([caminho, campoItem, faltando].filter(Boolean).join("."), motivoItem);
        return;
      }
      for (const [k, filho] of Object.entries(o)) andar(filho, caminho ? `${caminho}.${k}` : k, prof + 1);
      return;
    }
    add(caminho, texto(v));
  };
  andar(fields, "", 0);
  return saida;
}

export function mensagemErroPlugNotas(status: number, corpo: unknown): string {
  const err = (corpo as { error?: { message?: unknown; data?: unknown; fields?: unknown } } | null)?.error;
  const msg = typeof err?.message === "string" ? err.message.trim() : "";
  const data = err?.data && typeof err.data === "object" ? (err.data as Record<string, unknown>) : null;
  const fields = err?.fields ?? data?.fields;
  // Validação do JSON: o detalhe (qual campo e por quê) vem em `fields`; sem ele, só os nomes em `data`
  const campos = fields !== undefined ? camposReprovados(fields) : data ? Object.keys(data).slice(0, 5) : [];
  const t = msg.toLowerCase();
  if (status === 401 || status === 403) return "O PlugNotas recusou o acesso: o token da integração (PLUGNOTAS_API_TOKEN) é inválido ou não tem permissão.";
  if (/senha/.test(t)) return "O PlugNotas recusou o certificado: a senha não confere.";
  if (/vencid|expirad/.test(t)) return "O PlugNotas recusou o certificado: ele está vencido.";
  if (status === 429) return "O PlugNotas limitou as requisições agora. Tente de novo em alguns minutos.";
  if (status >= 500) return `O PlugNotas está fora do ar ou com erro (${status}). Tente de novo mais tarde.`;
  const base = msg || `O PlugNotas recusou os dados (${status}).`;
  return campos.length ? `${base.replace(/[.!:;\s]+$/, "")}. Campos: ${campos.join("; ")}.` : base;
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
