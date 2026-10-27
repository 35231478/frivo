/**
 * Proposta corporativa — regras puras do documento do orçamento (servidor, tela e documento usam
 * as mesmas): número formal, normas atendidas, "Não incluso", garantias, RT/ART, timbre da empresa
 * e o bloco "Para:" do cliente. Campo vazio = o bloco/linha não aparece (orçamento antigo fica igual).
 */

const t = (v: string | null | undefined) => (v ?? "").trim();

// ───────────────────────── Número formal ─────────────────────────

/** "ORC-2026-0147" → "2026-0147" (o "Orçamento Nº" do documento). Código fora do padrão sai como está. */
export function numeroFormalOrcamento(codigo: string): string {
  const m = /^ORC-(\d{4})-(\d+)$/.exec(codigo.trim());
  return m ? `${m[1]}-${m[2]}` : codigo;
}

/** Código do orçamento a partir do ano e do sequencial: ORC-2026-0147 (4 dígitos, cresce depois de 9999). */
export function codigoOrcamento(ano: number, sequencial: number): string {
  return `ORC-${ano}-${String(sequencial).padStart(4, "0")}`;
}

// ───────────────────────── Normas ─────────────────────────

export interface Norma { codigo: string; titulo: string; descricao: string }

/** Normas que a proposta pode declarar atendidas (ligáveis por orçamento; padrão em Configurações). */
export const NORMAS: readonly Norma[] = [
  { codigo: "NBR_16401", titulo: "ABNT NBR 16401", descricao: "Instalações de ar-condicionado — sistemas centrais e unitários (projeto, conforto térmico e qualidade do ar interior)" },
  { codigo: "NBR_13971", titulo: "ABNT NBR 13971", descricao: "Sistemas de refrigeração, condicionamento de ar, ventilação e aquecimento — manutenção programada" },
  { codigo: "PMOC", titulo: "PMOC — Lei nº 13.589/2018", descricao: "Plano de Manutenção, Operação e Controle dos sistemas de climatização" },
];

/** Mantém só códigos conhecidos, sem repetir, na ordem da lista NORMAS. */
export function normasValidas(codigos: readonly string[] | null | undefined): string[] {
  const pedidos = new Set(codigos ?? []);
  return NORMAS.filter((n) => pedidos.has(n.codigo)).map((n) => n.codigo);
}

export function normasDoDocumento(codigos: readonly string[] | null | undefined): Norma[] {
  const validas = new Set(normasValidas(codigos));
  return NORMAS.filter((n) => validas.has(n.codigo));
}

// ───────────────────────── Não incluso ─────────────────────────

/**
 * Sugestões rápidas do "Não incluso" (o campo é texto livre, uma exclusão por linha; a sugestão
 * entra como linha nova e dá para editar depois — ex.: trocar os "3 metros"). As primeiras
 * NAO_INCLUSO_VISIVEIS aparecem sempre; o resto, em "mais sugestões".
 */
export const NAO_INCLUSO_SUGESTOES = [
  "Obra civil (alvenaria, forro, pintura e acabamentos)",
  "Infraestrutura elétrica além do ponto de força",
  "Tubulação frigorígena além de 3 metros",
  "Dreno além de 3 metros",
  "Remoção e descarte do equipamento antigo",
  "Andaimes, plataforma elevatória ou equipamento de acesso",
  "Suportes e mão-francesa",
  "Bomba de dreno",
  "Furação em concreto ou alvenaria",
  "Projeto e ART (quando cobrados à parte)",
  "Içamento ou guindaste",
  "Trabalho noturno, em fim de semana ou feriado",
  "Materiais de acabamento",
  "Pintura",
  "Limpeza pós-obra",
  "Remoção de entulho e descarte",
  "Deslocamento fora da região de atendimento",
  "Taxas de acesso, liberação ou integração no local",
] as const;

export const NAO_INCLUSO_VISIVEIS = 8;

/** Uma exclusão por linha: sem vazias, sem marcador ("-", "•", "*") e sem repetir. */
export function linhasNaoIncluso(texto: string | null | undefined): string[] {
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const bruta of (texto ?? "").split(/\r?\n/)) {
    const l = bruta.replace(/^\s*[-•*–]\s*/, "").trim();
    const chave = l.toLocaleLowerCase("pt-BR");
    if (!l || vistas.has(chave)) continue;
    vistas.add(chave);
    saida.push(l);
  }
  return saida;
}

/** Acrescenta uma sugestão ao texto (uma por linha), sem duplicar. */
export function adicionarNaoIncluso(texto: string, item: string): string {
  const linhas = linhasNaoIncluso(texto);
  if (linhas.some((l) => l.toLocaleLowerCase("pt-BR") === item.toLocaleLowerCase("pt-BR"))) return texto;
  return [...(texto.trim() ? [texto.replace(/\s+$/, "")] : []), item].join("\n");
}

// ───────────────────────── Tabela de itens ─────────────────────────

const casasDecimais = (n: number) => {
  const s = String(n);
  const i = s.indexOf(".");
  return i < 0 || /e/i.test(s) ? 0 : s.length - i - 1;
};

/**
 * Quantidades de um grupo alinhadas pela vírgula (coluna à direita): se alguma tem casas decimais,
 * todas saem com o mesmo número de casas (até 3) — "1,00 / 2,50"; tudo inteiro fica "1 / 3".
 */
export function quantidadesAlinhadas(qtds: readonly number[]): string[] {
  const casas = Math.min(3, Math.max(0, ...qtds.map((q) => casasDecimais(Number(q) || 0))));
  return qtds.map((q) => (Number(q) || 0).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }));
}

/** Valor em reais sem o "R$" (a coluna diz "(R$)"), sempre com 2 casas: alinha pela vírgula. */
export const valorSemMoeda = (v: number) =>
  (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ───────────────────────── Condições ─────────────────────────

export interface CondicoesEntrada {
  prazoExecucao?: string | null;
  formaPagamento?: string | null;
  garantiaServico?: string | null;
  garantiaPecas?: string | null;
  validadeEm?: string | null; // já formatada (dd/MM/yyyy)
}

/** As linhas do bloco "Condições" do documento, na ordem do comprador; só as preenchidas. */
export function linhasCondicoes(c: CondicoesEntrada): { chave: string; rotulo: string; valor: string }[] {
  const linhas = [
    { chave: "prazo-execucao", rotulo: "Prazo de execução dos serviços", valor: t(c.prazoExecucao) },
    { chave: "forma-pagamento", rotulo: "Forma de pagamento", valor: t(c.formaPagamento) },
    { chave: "garantia-servico", rotulo: "Garantia dos serviços", valor: t(c.garantiaServico) },
    { chave: "garantia-pecas", rotulo: "Garantia das peças", valor: t(c.garantiaPecas) },
    { chave: "validade", rotulo: "Validade da proposta", valor: t(c.validadeEm) },
  ];
  return linhas.filter((l) => l.valor);
}

// ───────────────────────── Responsável técnico / ART ─────────────────────────

export const NOTA_ART_APOS_APROVACAO = "ART emitida após aprovação";

/** "ART nº 123" quando já existe; senão a nota padrão. */
export function textoArt(artNumero: string | null | undefined): string {
  return t(artNumero) ? `ART nº ${t(artNumero)}` : NOTA_ART_APOS_APROVACAO;
}

/** Validade padrão em dias (Configurações): 1 a 365; fora disso ou inválido = 10. */
export function diasValidadeValidos(dias: unknown, padrao = 10): number {
  const n = Math.trunc(Number(dias));
  return Number.isFinite(n) && n >= 1 && n <= 365 ? n : padrao;
}

// ───────────────────────── Timbre e destinatário ─────────────────────────

export interface EnderecoPartes {
  endereco?: string | null; // logradouro
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
}

/** "Rua X, 100 — Sala 2 — Centro — São Paulo/SP — CEP 01310-100" (só as partes preenchidas). */
export function enderecoEmLinha(e: EnderecoPartes): string {
  const partes: string[] = [];
  if (t(e.endereco)) partes.push(`${t(e.endereco)}${t(e.numero) ? `, ${t(e.numero)}` : ""}`);
  if (t(e.complemento)) partes.push(t(e.complemento));
  if (t(e.bairro)) partes.push(t(e.bairro));
  if (t(e.cidade)) partes.push(t(e.estado) ? `${t(e.cidade)}/${t(e.estado)}` : t(e.cidade));
  if (t(e.cep)) partes.push(`CEP ${t(e.cep)}`);
  return partes.join(" — ");
}

export interface EmpresaTimbre extends EnderecoPartes {
  nome: string;
  nomeFantasia?: string | null;
  cnpj: string;
  inscricaoEstadual?: string | null;
  inscricaoMunicipal?: string | null;
  telefone?: string | null;
  celular?: string | null;
  email?: string | null;
  site?: string | null;
}

export interface Timbre {
  /** Nome de destaque (fantasia, se houver) */
  titulo: string;
  /** Razão social (quando difere do título) */
  razaoSocial: string | null;
  /** "CNPJ … · IE … · IM …" */
  documentos: string;
  endereco: string;
  /** "Tel … · e-mail · site" */
  contato: string;
}

export function timbreEmpresa(
  e: EmpresaTimbre,
  fmt: { doc?: (d: string) => string; tel?: (d: string) => string } = {},
): Timbre {
  const doc = fmt.doc ?? ((d: string) => d);
  const tel = fmt.tel ?? ((d: string) => d);
  const titulo = t(e.nomeFantasia) || e.nome;
  const docs = [`CNPJ ${doc(e.cnpj)}`];
  if (t(e.inscricaoEstadual)) docs.push(`IE ${t(e.inscricaoEstadual)}`);
  if (t(e.inscricaoMunicipal)) docs.push(`IM ${t(e.inscricaoMunicipal)}`);
  const fones = [e.telefone, e.celular].map(t).filter(Boolean).map(tel);
  const contato = [fones.length ? `Tel. ${fones.join(" / ")}` : "", t(e.email), t(e.site).replace(/^https?:\/\//, "").replace(/\/$/, "")].filter(Boolean);
  return {
    titulo,
    razaoSocial: titulo !== e.nome ? e.nome : null,
    documentos: docs.join(" · "),
    endereco: enderecoEmLinha(e),
    contato: contato.join(" · "),
  };
}

export interface ClientePara extends EnderecoPartes {
  nome: string;
  nomeFantasia?: string | null;
  cpfCnpj: string;
  inscricaoEstadual?: string | null;
  contato?: string | null;
  telefone?: string | null;
  email?: string | null;
}
export interface UnidadePara {
  nome: string;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
}
export interface ContatoPara { nome: string; cargo?: string | null; email?: string | null; telefone?: string | null; whatsapp?: string | null }

export interface Destinatario {
  razaoSocial: string;
  nomeFantasia: string | null;
  documentos: string;
  /** "A/C Fulana (Compras)" — o contato escolhido; sem ele, o "contato" do cadastro do cliente */
  aosCuidados: string | null;
  /** E-mail/telefone do contato A/C (ou do cliente) */
  contato: string;
  /** Unidade escolhida (nome), quando houver */
  unidade: string | null;
  /** Endereço da unidade; sem unidade (ou unidade sem endereço), o do cliente */
  endereco: string;
}

export function destinatarioOrcamento(
  c: ClientePara,
  unidade: UnidadePara | null | undefined,
  contato: ContatoPara | null | undefined,
  fmt: { doc?: (d: string) => string; tel?: (d: string) => string } = {},
): Destinatario {
  const doc = fmt.doc ?? ((d: string) => d);
  const tel = fmt.tel ?? ((d: string) => d);
  const pessoaJuridica = c.cpfCnpj.replace(/\D/g, "").length > 11;
  const docs = [`${pessoaJuridica ? "CNPJ" : "CPF"} ${doc(c.cpfCnpj)}`];
  if (t(c.inscricaoEstadual)) docs.push(`IE ${t(c.inscricaoEstadual)}`);
  const ac = contato ? `${contato.nome}${t(contato.cargo) ? ` (${t(contato.cargo)})` : ""}` : t(c.contato) || null;
  const fone = contato ? t(contato.telefone) || t(contato.whatsapp) : t(c.telefone);
  const email = contato ? t(contato.email) : t(c.email);
  const endUnidade = unidade ? enderecoEmLinha({ ...unidade, endereco: unidade.logradouro }) : "";
  return {
    razaoSocial: c.nome,
    nomeFantasia: t(c.nomeFantasia) && t(c.nomeFantasia) !== c.nome ? t(c.nomeFantasia) : null,
    documentos: docs.join(" · "),
    aosCuidados: ac,
    contato: [fone ? tel(fone) : "", email].filter(Boolean).join(" · "),
    unidade: unidade ? unidade.nome : null,
    endereco: endUnidade || enderecoEmLinha(c),
  };
}
