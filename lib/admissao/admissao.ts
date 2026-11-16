/**
 * ADMISSÃO DIGITAL — as REGRAS PURAS. Sem banco, sem rede, sem React: telas, servidor e testes
 * usam as mesmas funções, então a tela nunca pede o que a rota recusa.
 *
 * O desenho: o RH pré-cadastra o colaborador (nome, CPF, cargo, salário) e gera um CONVITE com
 * token e validade. O colaborador abre o link no celular, consente (LGPD), preenche em etapas —
 * com rascunho salvo a cada passo —, manda os documentos, lê o contrato montado a partir do
 * MODELO DA EMPRESA e assina. A prova da assinatura é a mesma do aceite da OS: nome digitado, IP,
 * navegador e data/hora, mais uma selfie.
 *
 * O que NÃO está aqui: nada que o sistema inventaria sozinho. O contrato só preenche campos; a
 * lista de documentos, o texto das orientações e a validade do link são configuração da empresa.
 */
import { cpfValido, digitos } from "@/lib/documento";

/* ───────── situações ───────── */

export const SITUACOES = [
  "CONVIDADO", "PREENCHENDO", "AGUARDANDO_ASSINATURA", "ASSINADO", "ENVIADO_CONTADOR", "ADMITIDO",
  "CANCELADA", "EXPIRADA",
] as const;
export type SituacaoAdmissao = (typeof SITUACOES)[number];

export const ROTULO_SITUACAO: Record<SituacaoAdmissao, string> = {
  CONVIDADO: "Convidado",
  PREENCHENDO: "Preenchendo",
  AGUARDANDO_ASSINATURA: "Aguardando assinatura",
  ASSINADO: "Assinado",
  ENVIADO_CONTADOR: "Enviado ao contador",
  ADMITIDO: "Admitido",
  CANCELADA: "Cancelada",
  EXPIRADA: "Expirada",
};

/** O que cada situação diz ao RH — o ⓘ da lista, não um parágrafo na tela. */
export const AJUDA_SITUACAO: Record<SituacaoAdmissao, string> = {
  CONVIDADO: "O link foi gerado. O colaborador ainda não abriu.",
  PREENCHENDO: "O colaborador abriu o link e está preenchendo. O rascunho fica salvo.",
  AGUARDANDO_ASSINATURA: "Preencheu tudo e mandou os documentos. Falta assinar o contrato.",
  ASSINADO: "Contrato assinado, com a prova guardada. A ficha já pode ir para o contador.",
  ENVIADO_CONTADOR: "A ficha e os documentos foram baixados para o contador.",
  ADMITIDO: "Admissão concluída. O colaborador está no quadro.",
  CANCELADA: "A admissão foi cancelada. O histórico fica.",
  EXPIRADA: "O link passou da validade sem ser concluído. Reenviar gera um prazo novo.",
};

/** Situação encerrada: não aceita mais mudança pelo link. */
export const ENCERRADAS: readonly SituacaoAdmissao[] = ["ADMITIDO", "CANCELADA"];

/** O colaborador ainda mexe no formulário nestas situações. */
export const ABERTAS_AO_COLABORADOR: readonly SituacaoAdmissao[] = [
  "CONVIDADO", "PREENCHENDO", "AGUARDANDO_ASSINATURA",
];

/**
 * A transição é permitida? O fluxo anda para a frente; cancelar vale de qualquer situação viva;
 * expirar só atinge quem ainda estava com o link aberto.
 */
const PROXIMAS: Record<SituacaoAdmissao, readonly SituacaoAdmissao[]> = {
  CONVIDADO: ["PREENCHENDO", "AGUARDANDO_ASSINATURA", "CANCELADA", "EXPIRADA"],
  PREENCHENDO: ["AGUARDANDO_ASSINATURA", "CANCELADA", "EXPIRADA"],
  AGUARDANDO_ASSINATURA: ["ASSINADO", "CANCELADA", "EXPIRADA"],
  ASSINADO: ["ENVIADO_CONTADOR", "ADMITIDO", "CANCELADA"],
  ENVIADO_CONTADOR: ["ADMITIDO", "CANCELADA"],
  ADMITIDO: [],
  CANCELADA: [],
  // Expirada volta ao jogo quando o RH reenvia (prazo novo)
  EXPIRADA: ["CONVIDADO", "CANCELADA"],
};

export const podeIr = (de: SituacaoAdmissao, para: SituacaoAdmissao): boolean =>
  PROXIMAS[de]?.includes(para) ?? false;

/** Situações em que ainda existe link para (re)enviar: a tela e a rota leem a mesma lista. */
export const REENVIAVEIS: readonly SituacaoAdmissao[] = [
  "CONVIDADO", "PREENCHENDO", "AGUARDANDO_ASSINATURA", "EXPIRADA",
];
export const podeReenviar = (s: string) => REENVIAVEIS.includes(s as SituacaoAdmissao);

/** O link ainda vale? Expirado e encerrado valem a mesma coisa para quem tem o link. */
export function linkValido(a: { situacao: string; expiraEm: Date | string }, agora = new Date()): boolean {
  if (!ABERTAS_AO_COLABORADOR.includes(a.situacao as SituacaoAdmissao)) return false;
  return new Date(a.expiraEm).getTime() > agora.getTime();
}

export const MSG_LINK_INVALIDO = "Este link não está mais válido. Fale com quem te enviou.";
export const MSG_SEM_CONSENTIMENTO = "É preciso aceitar o tratamento dos dados para continuar.";
export const MSG_JA_ASSINADO = "Este contrato já foi assinado.";
export const MSG_CANCELADA = "Esta admissão foi cancelada.";

/* ───────── as etapas do formulário ───────── */

export const ETAPAS = ["DADOS", "ENDERECO", "DOCUMENTOS", "BANCO", "DEPENDENTES", "CONTRATO"] as const;
export type Etapa = (typeof ETAPAS)[number];

export const ROTULO_ETAPA: Record<Etapa, string> = {
  DADOS: "Seus dados",
  ENDERECO: "Endereço",
  DOCUMENTOS: "Documentos",
  BANCO: "Conta para o salário",
  DEPENDENTES: "Dependentes",
  CONTRATO: "Contrato",
};

/* ───────── o que o colaborador preenche ───────── */

export interface Dependente {
  nome: string;
  nascimento: string;
  cpf: string;
  /** FILHO | CONJUGE | ENTEADO | OUTRO */
  parentesco: string;
  irrf: boolean;
  salarioFamilia: boolean;
}

export interface FormAdmissao {
  // DADOS
  nome: string; cpf: string; rg: string; dataNascimento: string;
  nomeMae: string; nomePai: string; estadoCivil: string; escolaridade: string;
  nacionalidade: string; naturalidade: string; sexo: string;
  pis: string; ctpsNumero: string; ctpsSerie: string; ctpsUf: string;
  tituloEleitor: string; reservista: string;
  email: string; telefone: string;
  // ENDERECO
  cep: string; endereco: string; numero: string; complemento: string; bairro: string; cidade: string; estado: string;
  // BANCO
  banco: string; agencia: string; conta: string; contaTipo: string; pixChave: string;
  // DEPENDENTES
  dependentes: Dependente[];
}

export const formVazio = (): FormAdmissao => ({
  nome: "", cpf: "", rg: "", dataNascimento: "",
  nomeMae: "", nomePai: "", estadoCivil: "", escolaridade: "",
  nacionalidade: "Brasileira", naturalidade: "", sexo: "",
  pis: "", ctpsNumero: "", ctpsSerie: "", ctpsUf: "",
  tituloEleitor: "", reservista: "",
  email: "", telefone: "",
  cep: "", endereco: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "",
  banco: "", agencia: "", conta: "", contaTipo: "CORRENTE", pixChave: "",
  dependentes: [],
});

/* ───────── listas fixas (enum: seletor nativo, não busca) ───────── */

export const ESTADOS_CIVIS = [
  ["SOLTEIRO", "Solteiro(a)"], ["CASADO", "Casado(a)"], ["DIVORCIADO", "Divorciado(a)"],
  ["VIUVO", "Viúvo(a)"], ["UNIAO_ESTAVEL", "União estável"],
] as const;

export const ESCOLARIDADES = [
  ["FUNDAMENTAL_INCOMPLETO", "Fundamental incompleto"], ["FUNDAMENTAL", "Fundamental completo"],
  ["MEDIO_INCOMPLETO", "Médio incompleto"], ["MEDIO", "Médio completo"],
  ["TECNICO", "Técnico"], ["SUPERIOR_INCOMPLETO", "Superior incompleto"],
  ["SUPERIOR", "Superior completo"], ["POS", "Pós-graduação"],
] as const;

export const TIPOS_CONTA = [
  ["CORRENTE", "Conta corrente"], ["POUPANCA", "Conta poupança"], ["SALARIO", "Conta salário"],
] as const;

export const PARENTESCOS = [
  ["FILHO", "Filho(a)"], ["CONJUGE", "Cônjuge"], ["ENTEADO", "Enteado(a)"], ["OUTRO", "Outro"],
] as const;

/* ───────── PIS/NIS: dígito verificador de verdade ───────── */

/** O PIS/PASEP/NIS tem 11 dígitos e dígito verificador (peso 3,2,9,8,7,6,5,4,3,2). */
export function pisValido(s: string): boolean {
  const d = digitos(s);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const soma = pesos.reduce((acc, p, i) => acc + Number(d[i]) * p, 0);
  const r = 11 - (soma % 11);
  return (r === 10 || r === 11 ? 0 : r) === Number(d[10]);
}

export const formatarPis = (s: string) => {
  const d = digitos(s).slice(0, 11);
  return [d.slice(0, 3), d.slice(3, 8), d.slice(8, 10), d.slice(10, 11)].filter(Boolean).join(".").replace(/\.(\d)$/, "-$1");
};

/* ───────── o que falta para passar de cada etapa ───────── */

const vazio = (v: string | undefined | null) => !(v ?? "").trim();

/**
 * O que FALTA na etapa (lista vazia = pode seguir). É a mesma conferência da tela e da rota: o
 * botão só libera quando a rota aceitaria.
 */
export function faltaNaEtapa(etapa: Etapa, f: FormAdmissao, docs: { enviados: string[]; obrigatorios: string[] } = { enviados: [], obrigatorios: [] }): string[] {
  const falta: string[] = [];
  if (etapa === "DADOS") {
    if (vazio(f.nome)) falta.push("Nome completo");
    if (!cpfValido(f.cpf)) falta.push("CPF válido");
    if (vazio(f.dataNascimento)) falta.push("Data de nascimento");
    if (vazio(f.nomeMae)) falta.push("Nome da mãe");
    if (vazio(f.rg)) falta.push("RG");
    if (f.pis.trim() && !pisValido(f.pis)) falta.push("PIS/NIS válido");
    if (vazio(f.telefone)) falta.push("Telefone");
  }
  if (etapa === "ENDERECO") {
    if (digitos(f.cep).length !== 8) falta.push("CEP");
    if (vazio(f.endereco)) falta.push("Endereço");
    if (vazio(f.numero)) falta.push("Número");
    if (vazio(f.bairro)) falta.push("Bairro");
    if (vazio(f.cidade)) falta.push("Cidade");
    if (vazio(f.estado)) falta.push("Estado");
  }
  if (etapa === "DOCUMENTOS") {
    for (const id of docs.obrigatorios) if (!docs.enviados.includes(id)) falta.push(id);
  }
  if (etapa === "BANCO") {
    // Conta OU PIX: quem recebe por PIX não precisa digitar agência e conta
    const temConta = !vazio(f.banco) && !vazio(f.agencia) && !vazio(f.conta);
    if (!temConta && vazio(f.pixChave)) falta.push("Banco, agência e conta — ou a chave PIX");
  }
  if (etapa === "DEPENDENTES") {
    f.dependentes.forEach((d, i) => {
      if (vazio(d.nome)) falta.push(`Nome do dependente ${i + 1}`);
      if (d.cpf.trim() && !cpfValido(d.cpf)) falta.push(`CPF do dependente ${i + 1}`);
    });
  }
  return falta;
}

/** Terminou tudo que o colaborador precisa preencher (o contrato é o passo seguinte). */
export function prontoParaAssinar(f: FormAdmissao, docs: { enviados: string[]; obrigatorios: string[] }): boolean {
  return (["DADOS", "ENDERECO", "DOCUMENTOS", "BANCO", "DEPENDENTES"] as Etapa[])
    .every((e) => faltaNaEtapa(e, f, docs).length === 0);
}

/** A próxima etapa que ainda tem pendência (null = pode assinar). */
export function etapaPendente(f: FormAdmissao, docs: { enviados: string[]; obrigatorios: string[] }): Etapa | null {
  for (const e of ["DADOS", "ENDERECO", "DOCUMENTOS", "BANCO", "DEPENDENTES"] as Etapa[]) {
    if (faltaNaEtapa(e, f, docs).length) return e;
  }
  return null;
}

/* ───────── documentos pedidos pela empresa ───────── */

export interface DocumentoPedido { id: string; rotulo: string; obrigatorio: boolean }

/** O que a empresa pede quando ainda não configurou nada. Editável em Configurações. */
export const DOCUMENTOS_PADRAO: DocumentoPedido[] = [
  { id: "rg", rotulo: "RG (frente e verso)", obrigatorio: true },
  { id: "cpf", rotulo: "CPF", obrigatorio: true },
  { id: "comprovante_residencia", rotulo: "Comprovante de residência", obrigatorio: true },
  { id: "ctps", rotulo: "Carteira de trabalho", obrigatorio: true },
  { id: "foto", rotulo: "Foto 3x4", obrigatorio: false },
  { id: "titulo_eleitor", rotulo: "Título de eleitor", obrigatorio: false },
  { id: "certidao_nascimento_filhos", rotulo: "Certidão de nascimento dos filhos", obrigatorio: false },
  { id: "comprovante_escolaridade", rotulo: "Comprovante de escolaridade", obrigatorio: false },
];

/** A lista da empresa, ou o padrão quando ela ainda não mexeu. Sempre com rótulo e id limpos. */
export function documentosDaEmpresa(config: unknown): DocumentoPedido[] {
  if (!Array.isArray(config) || config.length === 0) return DOCUMENTOS_PADRAO;
  const lista: DocumentoPedido[] = [];
  for (const item of config) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    const rotulo = String(o.rotulo ?? "").trim();
    if (!id || !rotulo) continue;
    lista.push({ id, rotulo, obrigatorio: o.obrigatorio === true });
  }
  return lista.length ? lista : DOCUMENTOS_PADRAO;
}

export const obrigatoriosDa = (docs: DocumentoPedido[]) => docs.filter((d) => d.obrigatorio).map((d) => d.id);

/* ───────── o contrato ───────── */

/** Os campos que o sistema preenche. O resto do texto é da empresa — nenhuma cláusula é inventada. */
export interface DadosContrato {
  empresa: string; empresaCnpj: string;
  nome: string; cpf: string; rg: string; endereco: string;
  cargo: string; salario: string; jornada: string; admissao: string;
  experienciaDias: number; experienciaProrrogacaoDias: number;
  cidade: string; data: string;
}

export const CAMPOS_CONTRATO = [
  "empresa", "empresaCnpj", "nome", "cpf", "rg", "endereco", "cargo", "salario", "jornada",
  "admissao", "experienciaDias", "experienciaProrrogacaoDias", "cidade", "data",
] as const;

/**
 * Preenche o modelo da empresa: troca {{campo}} pelo valor. Campo desconhecido fica como está —
 * é erro de quem escreveu o modelo, e esconder isso só atrasaria a descoberta.
 */
export function montarContrato(modelo: string, dados: DadosContrato): string {
  return modelo.replace(/\{\{\s*(\w+)\s*\}\}/g, (inteiro, campo: string) => {
    const v = (dados as unknown as Record<string, unknown>)[campo];
    return v === undefined || v === null ? inteiro : String(v);
  });
}

/** Os campos que o modelo usa e o sistema não conhece — a tela de configuração avisa. */
export function camposDesconhecidos(modelo: string): string[] {
  const usados = [...modelo.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
  return [...new Set(usados.filter((c) => !CAMPOS_CONTRATO.includes(c as never)))];
}

/* ───────── validade do link ───────── */

export const VALIDADE_MIN = 1;
export const VALIDADE_MAX = 60;
export const VALIDADE_PADRAO = 7;

export const validadeValida = (dias: number) =>
  Number.isInteger(dias) && dias >= VALIDADE_MIN && dias <= VALIDADE_MAX;

export const MSG_VALIDADE = `Validade do link: de ${VALIDADE_MIN} a ${VALIDADE_MAX} dias.`;

/** A data em que o link para de valer. */
export function expiraEm(dias: number, agora = new Date()): Date {
  const d = new Date(agora);
  d.setDate(d.getDate() + (validadeValida(dias) ? dias : VALIDADE_PADRAO));
  return d;
}

/* ───────── verificação do e-mail por código ───────── */

export const CODIGO_TAMANHO = 6;
/** Minutos que o código vale. Curto de propósito: é um código de uma vez. */
export const CODIGO_VALIDADE_MIN = 15;
/** Erradas demais no mesmo código: o código morre e tem de ser pedido outro. */
export const CODIGO_MAX_TENTATIVAS = 5;

export const codigoValido = (s: string) => new RegExp(`^\\d{${CODIGO_TAMANHO}}$`).test((s ?? "").trim());

export const MSG_CODIGO_FORMATO = `O código tem ${CODIGO_TAMANHO} números.`;
export const MSG_CODIGO_ERRADO = "Código incorreto. Confira o e-mail e tente de novo.";
export const MSG_CODIGO_VENCIDO = "O código venceu. Peça outro.";
export const MSG_EMAIL_NAO_VERIFICADO = "Confirme o e-mail com o código antes de continuar.";

/** O e-mail digitado é o mesmo que foi verificado? Trocar o e-mail derruba a verificação. */
export const emailConfere = (digitado: string, verificado: string | null | undefined) =>
  !!verificado && digitado.trim().toLowerCase() === verificado.trim().toLowerCase();

/* ───────── cancelar: razão é razão ───────── */

export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 500;
export const MSG_MOTIVO = `Diga o motivo do cancelamento (pelo menos ${MOTIVO_MIN} caracteres).`;
export const motivoValido = (s: string) => {
  const t = (s ?? "").trim();
  return t.length >= MOTIVO_MIN && t.length <= MOTIVO_MAX;
};

/** O caminho do link público (a tela monta a URL com a origem da requisição). */
export const caminhoPublicoAdmissao = (token: string) => `/admissao/${token}`;

/* ───────── o rascunho que chega pelo link (dado de fora: nunca entra cru no banco) ───────── */

/** Teto de cada campo de texto do formulário. O que passar é cortado, não recusado. */
export const CAMPO_MAX = 200;
/** Teto de dependentes por admissão. */
export const DEPENDENTES_MAX = 20;

const texto = (v: unknown, max = CAMPO_MAX) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Reconstrói o formulário SÓ com os campos conhecidos, cada um cortado no teto. O rascunho vem de
 * um link público: gravar o JSON como chegou deixaria qualquer coisa entrar no banco.
 */
export function normalizarForm(bruto: unknown): FormAdmissao {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const base = formVazio();
  const f: FormAdmissao = { ...base };
  for (const k of Object.keys(base) as (keyof FormAdmissao)[]) {
    if (k === "dependentes") continue;
    (f[k] as string) = texto(o[k]);
  }
  const brutos = Array.isArray(o.dependentes) ? o.dependentes.slice(0, DEPENDENTES_MAX) : [];
  f.dependentes = brutos.map((d) => {
    const x = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
    return {
      nome: texto(x.nome), nascimento: texto(x.nascimento, 20), cpf: texto(x.cpf, 20),
      parentesco: PARENTESCOS.some(([v]) => v === x.parentesco) ? String(x.parentesco) : "FILHO",
      irrf: x.irrf === true, salarioFamilia: x.salarioFamilia === true,
    };
  });
  // Campo que nasce preenchido volta ao padrão quando chega vazio
  if (!f.nacionalidade) f.nacionalidade = base.nacionalidade;
  if (!f.contaTipo) f.contaTipo = base.contaTipo;
  return f;
}

/* ───────── textos que o contrato e a ficha usam ───────── */

const DIAS_JORNADA: [string, string][] = [
  ["SEG", "segunda"], ["TER", "terça"], ["QUA", "quarta"], ["QUI", "quinta"],
  ["SEX", "sexta"], ["SAB", "sábado"], ["DOM", "domingo"],
];

/** "08:00 às 18:00, de segunda a sexta" — vazio quando a jornada não foi preenchida. */
export function textoJornada(j: { entrada?: string | null; saida?: string | null; dias?: readonly string[] | null }): string {
  const horario = j.entrada && j.saida ? `${j.entrada} às ${j.saida}` : "";
  const indices = DIAS_JORNADA.map((_, i) => i).filter((i) => (j.dias ?? []).includes(DIAS_JORNADA[i][0]));
  let trecho = "";
  if (indices.length) {
    const nomes = indices.map((i) => DIAS_JORNADA[i][1]);
    const seguidos = indices.length > 2 && indices[indices.length - 1] - indices[0] === indices.length - 1;
    trecho = seguidos ? `de ${nomes[0]} a ${nomes[nomes.length - 1]}` : nomes.join(", ");
  }
  return [horario, trecho].filter(Boolean).join(", ");
}

/** O endereço numa linha, como vai no contrato e na ficha. */
export function enderecoEmLinha(e: {
  endereco?: string | null; numero?: string | null; complemento?: string | null;
  bairro?: string | null; cidade?: string | null; estado?: string | null; cep?: string | null;
}): string {
  const rua = [e.endereco, e.numero].filter(Boolean).join(", ");
  const local = [e.cidade, e.estado].filter(Boolean).join("/");
  return [rua, e.complemento, e.bairro, local, e.cep].map((p) => (p ?? "").trim()).filter(Boolean).join(" — ");
}
