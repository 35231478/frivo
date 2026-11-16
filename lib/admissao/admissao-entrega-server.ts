/**
 * A ENTREGA DA ADMISSÃO ao contador: a Ficha de Admissão em PDF, o pacote (zip) com os documentos
 * que o colaborador enviou, e o PDF do contrato assinado.
 *
 * Quem pode: a mesma permissão do resto da admissão ("Admissão digital › gerenciar"), conferida
 * pela rota. Aqui dentro, o escopo é sempre a EMPRESA da sessão — uma admissão de outra empresa é
 * 404, nunca o arquivo.
 *
 * A partir de quando: só de ASSINADO em diante (assinado, enviado ao contador, admitido). Antes
 * disso a ficha estaria pela metade, e meia ficha no contador é pior do que nenhuma. Marcar
 * "Enviado ao contador" é o registro de que o RH mandou — não é o que destrava o download, senão
 * ele teria de marcar como enviado ANTES de conseguir baixar o que vai enviar.
 */

import { prisma } from "@/lib/prisma";
import { formatarData, formatarDataHora, formatarMoeda } from "@/lib/utils";
import { formatarDocumento } from "@/lib/documento";
import { decodificarDataUrl } from "@/lib/anexos-server";
import { identificarTipo } from "@/lib/anexos";
import { montarZip, type ArquivoZip } from "@/lib/zip";
import type { ArquivoGerado } from "@/lib/pdf/resposta";
import {
  ESCOLARIDADES, ESTADOS_CIVIS, PARENTESCOS, TIPOS_CONTA, documentosDaEmpresa, formatarPis,
  normalizarForm, textoJornada, type FormAdmissao,
} from "@/lib/admissao/admissao";
import {
  VAZIO, gerarContratoPdf, gerarFichaPdf, ou, type DadosFicha, type DependenteFicha, type LinhaFicha,
} from "@/lib/admissao/admissao-pdf";
// A regra de quando a entrega existe mora no módulo puro: a tela lê a MESMA coisa.
import { temEntrega } from "@/lib/admissao/admissao-entrega-regras";

export { SITUACOES_COM_ENTREGA, temEntrega } from "@/lib/admissao/admissao-entrega-regras";

export class ErroEntrega extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ErroEntrega";
  }
}

const MSG_NAO_ENCONTRADA = "Admissão não encontrada";
export const MSG_AINDA_NAO = "A ficha e os documentos ficam prontos quando o colaborador assinar o contrato.";

/**
 * O `tipo` do contrato assinado nos anexos do colaborador. Começa com "_" de propósito: os
 * documentos que a EMPRESA pede têm ids escolhidos por ela, e este é do sistema — assim ele nunca
 * entra, por acidente, na conta de "documentos entregues" da admissão.
 */
export const TIPO_CONTRATO_ASSINADO = "_contrato_assinado";

const rotulo = (lista: readonly (readonly [string, string])[], valor: string | null | undefined) =>
  lista.find(([v]) => v === (valor ?? ""))?.[1] ?? ou(valor);

const SEXOS: Record<string, string> = { M: "Masculino", F: "Feminino", OUTRO: "Outro" };

/* ───────────────────────── carregar ───────────────────────── */

const SELECT_ENTREGA = {
  id: true, situacao: true, rascunho: true,
  assinaturaNome: true, assinaturaEm: true, assinaturaIp: true, assinaturaUserAgent: true,
  selfie: true, contratoTexto: true, concluidoEm: true, consentimentoEm: true,
  enviadoContadorEm: true, admitidoEm: true,
  empresa: { select: { nome: true, nomeFantasia: true, cnpj: true, cidade: true, estado: true } },
  colaborador: {
    select: {
      id: true, nome: true, cpf: true, rg: true, email: true, telefone: true,
      dataNascimento: true, dataAdmissao: true, salario: true,
      jornadaEntrada: true, jornadaSaida: true, jornadaDias: true,
      pis: true, ctpsNumero: true, ctpsSerie: true, ctpsUf: true,
      nomeMae: true, nomePai: true, estadoCivil: true, escolaridade: true,
      nacionalidade: true, naturalidade: true, sexo: true, tituloEleitor: true, reservista: true,
      banco: true, agencia: true, conta: true, contaTipo: true, pixChave: true,
      endereco: true, numero: true, complemento: true, bairro: true, cidade: true, estado: true, cep: true,
      cargo: { select: { nome: true, cbo: true } },
    },
  },
} as const;

type LinhaEntrega = NonNullable<Awaited<ReturnType<typeof carregar>>>;

async function carregar(admissaoId: string, empresaId: string) {
  return prisma.admissao.findFirst({ where: { id: admissaoId, empresaId }, select: SELECT_ENTREGA });
}

/** A admissão pronta para entrega, ou o erro certo: 404 quando não é desta empresa, 409 quando ainda não assinou. */
async function exigirPronta(admissaoId: string, empresaId: string): Promise<LinhaEntrega> {
  const a = await carregar(admissaoId, empresaId);
  if (!a) throw new ErroEntrega(MSG_NAO_ENCONTRADA, 404);
  if (!temEntrega(a.situacao)) throw new ErroEntrega(MSG_AINDA_NAO, 409);
  return a;
}

/* ───────────────────────── a ficha ───────────────────────── */

/**
 * Monta os blocos do S-2200 a partir do que foi preenchido. O que vale é o CADASTRO (é para lá que
 * `concluirPreenchimento` passou os dados); o rascunho entra só como segunda fonte, para o caso de
 * um campo que o cadastro não guarda.
 */
export function blocosDaFicha(a: LinhaEntrega, agora: Date): DadosFicha {
  const col = a.colaborador;
  const form: FormAdmissao = normalizarForm(a.rascunho);
  /** O cadastro manda; o rascunho preenche o buraco. */
  const v = (doCadastro: string | null | undefined, doRascunho?: string) =>
    ou((doCadastro ?? "").trim() || (doRascunho ?? "").trim());

  const pendencias: string[] = [];
  const obrigatorio = (nome: string, valor: string) => {
    if (valor === VAZIO) pendencias.push(nome);
    return valor;
  };

  const identificacao: LinhaFicha[] = [
    { rotulo: "Nome completo", valor: ou(col.nome) },
    { rotulo: "Data de nascimento", valor: col.dataNascimento ? formatarData(col.dataNascimento) : v(null, form.dataNascimento) },
    { rotulo: "Nome da mãe", valor: obrigatorio("nome da mãe", v(col.nomeMae, form.nomeMae)) },
    { rotulo: "Nome do pai", valor: v(col.nomePai, form.nomePai) },
    { rotulo: "Sexo", valor: SEXOS[(col.sexo ?? form.sexo ?? "").trim()] ?? VAZIO },
    { rotulo: "Estado civil", valor: rotulo(ESTADOS_CIVIS, col.estadoCivil || form.estadoCivil) },
    { rotulo: "Nacionalidade", valor: v(col.nacionalidade, form.nacionalidade) },
    { rotulo: "Naturalidade", valor: v(col.naturalidade, form.naturalidade) },
    { rotulo: "Escolaridade", valor: rotulo(ESCOLARIDADES, col.escolaridade || form.escolaridade) },
    { rotulo: "Telefone", valor: v(col.telefone, form.telefone) },
    { rotulo: "E-mail", valor: v(col.email, form.email) },
  ];

  const documentos: LinhaFicha[] = [
    { rotulo: "CPF", valor: obrigatorio("CPF", col.cpf ? formatarDocumento(col.cpf) : VAZIO) },
    { rotulo: "RG", valor: obrigatorio("RG", v(col.rg, form.rg)) },
    { rotulo: "PIS / NIS", valor: (col.pis || form.pis) ? formatarPis(col.pis || form.pis) : VAZIO },
    { rotulo: "CTPS — número", valor: v(col.ctpsNumero, form.ctpsNumero) },
    { rotulo: "CTPS — série", valor: v(col.ctpsSerie, form.ctpsSerie) },
    { rotulo: "CTPS — UF", valor: v(col.ctpsUf, form.ctpsUf) },
    { rotulo: "Título de eleitor", valor: v(col.tituloEleitor, form.tituloEleitor) },
    { rotulo: "Certificado de reservista", valor: v(col.reservista, form.reservista) },
  ];

  const endereco: LinhaFicha[] = [
    { rotulo: "Logradouro", valor: obrigatorio("endereço", v(col.endereco, form.endereco)) },
    { rotulo: "Número", valor: v(col.numero, form.numero) },
    { rotulo: "Complemento", valor: v(col.complemento, form.complemento) },
    { rotulo: "Bairro", valor: v(col.bairro, form.bairro) },
    { rotulo: "Cidade", valor: v(col.cidade, form.cidade) },
    { rotulo: "Estado", valor: v(col.estado, form.estado) },
    { rotulo: "CEP", valor: v(col.cep, form.cep) },
  ];

  const contrato: LinhaFicha[] = [
    { rotulo: "Cargo", valor: ou(col.cargo?.nome) },
    { rotulo: "CBO", valor: ou(col.cargo?.cbo) },
    { rotulo: "Salário", valor: col.salario === null || col.salario === undefined ? VAZIO : formatarMoeda(Number(col.salario)) },
    { rotulo: "Data de admissão", valor: col.dataAdmissao ? formatarData(col.dataAdmissao) : VAZIO },
    { rotulo: "Jornada", valor: ou(textoJornada({ entrada: col.jornadaEntrada, saida: col.jornadaSaida, dias: col.jornadaDias })) },
    { rotulo: "Empregador", valor: `${a.empresa.nomeFantasia?.trim() || a.empresa.nome}${a.empresa.cnpj ? ` · CNPJ ${a.empresa.cnpj}` : ""}` },
  ];

  const bancarios: LinhaFicha[] = [
    { rotulo: "Banco", valor: v(col.banco, form.banco) },
    { rotulo: "Agência", valor: v(col.agencia, form.agencia) },
    { rotulo: "Conta", valor: v(col.conta, form.conta) },
    { rotulo: "Tipo de conta", valor: rotulo(TIPOS_CONTA, col.contaTipo || form.contaTipo) },
    { rotulo: "Chave PIX", valor: v(col.pixChave, form.pixChave) },
  ];

  const prova: LinhaFicha[] = [
    { rotulo: "Assinado por", valor: ou(a.assinaturaNome) },
    { rotulo: "Data e hora", valor: a.assinaturaEm ? formatarDataHora(a.assinaturaEm) : VAZIO },
    { rotulo: "Endereço de IP", valor: ou(a.assinaturaIp) },
    { rotulo: "Consentimento (LGPD)", valor: a.consentimentoEm ? formatarDataHora(a.consentimentoEm) : VAZIO },
  ];

  return {
    empresa: {
      nome: a.empresa.nomeFantasia?.trim() || a.empresa.nome,
      cnpj: a.empresa.cnpj ?? "",
      cidade: [a.empresa.cidade, a.empresa.estado].filter(Boolean).join("/"),
    },
    colaborador: { nome: col.nome, cpf: col.cpf ? formatarDocumento(col.cpf) : VAZIO },
    geradoEm: formatarDataHora(agora),
    identificacao, documentos, endereco, contrato, bancarios, prova,
    dependentes: [],
    pendencias,
  };
}

/** Os dependentes do colaborador, do banco, no formato da tabela da ficha. */
async function dependentesDa(colaboradorId: string): Promise<DependenteFicha[]> {
  const linhas = await prisma.colaboradorDependente.findMany({
    where: { colaboradorId },
    orderBy: [{ nascimento: "asc" }, { nome: "asc" }],
    select: { nome: true, nascimento: true, cpf: true, parentesco: true, irrf: true, salarioFamilia: true },
  });
  return linhas.map((d) => ({
    nome: d.nome,
    parentesco: rotulo(PARENTESCOS, d.parentesco),
    nascimento: d.nascimento ? formatarData(d.nascimento) : "",
    cpf: d.cpf ? formatarDocumento(d.cpf) : "",
    irrf: d.irrf,
    salarioFamilia: d.salarioFamilia,
  }));
}

/** A Ficha de Admissão em PDF. */
export async function fichaDaAdmissao(
  admissaoId: string, empresaId: string, agora: Date = new Date(),
): Promise<ArquivoGerado & { paginas: number }> {
  const a = await exigirPronta(admissaoId, empresaId);
  const dados = blocosDaFicha(a, agora);
  dados.dependentes = await dependentesDa(a.colaborador.id);
  return gerarFichaPdf(dados);
}

/* ───────────────────────── o contrato ───────────────────────── */

export const MSG_SEM_CONTRATO = "Esta admissão não tem contrato assinado.";

/** O PDF do contrato assinado: o texto congelado, a prova e a selfie. */
export async function contratoDaAdmissao(
  admissaoId: string, empresaId: string, agora: Date = new Date(),
): Promise<ArquivoGerado & { paginas: number }> {
  const a = await exigirPronta(admissaoId, empresaId);
  if (!a.contratoTexto) throw new ErroEntrega(MSG_SEM_CONTRATO, 409);
  return gerarContratoPdf({
    empresa: { nome: a.empresa.nomeFantasia?.trim() || a.empresa.nome },
    colaborador: { nome: a.colaborador.nome, cpf: a.colaborador.cpf ? formatarDocumento(a.colaborador.cpf) : VAZIO },
    geradoEm: formatarDataHora(agora),
    texto: a.contratoTexto,
    assinatura: {
      nome: a.assinaturaNome,
      em: a.assinaturaEm ? formatarDataHora(a.assinaturaEm) : null,
      ip: a.assinaturaIp,
      navegador: a.assinaturaUserAgent,
    },
    selfie: a.selfie,
  });
}

/**
 * Guarda o PDF do contrato assinado NOS ANEXOS do colaborador, para ele aparecer na seção
 * Documentos da ficha junto com o resto dos papéis da pessoa — um lugar só, como manda a casa.
 *
 * Chamado logo depois da assinatura. Nunca derruba a assinatura: se o PDF não puder ser gerado, a
 * assinatura já está gravada e o contrato continua disponível pela rota, que o gera na hora.
 * Idempotente: assinar é uma vez só, mas uma segunda chamada não duplica o anexo.
 */
export async function guardarContratoNosAnexos(
  admissaoId: string, empresaId: string, agora: Date = new Date(),
): Promise<{ id: string } | null> {
  const a = await carregar(admissaoId, empresaId);
  if (!a || !a.contratoTexto || !a.assinaturaEm) return null;

  const jaTem = await prisma.colaboradorDocumento.findFirst({
    where: { colaboradorId: a.colaborador.id, excluidoEm: null, tipo: TIPO_CONTRATO_ASSINADO },
    select: { id: true },
  });
  if (jaTem) return jaTem;

  const pdf = await contratoDaAdmissao(admissaoId, empresaId, agora);
  const criado = await prisma.colaboradorDocumento.create({
    data: {
      colaboradorId: a.colaborador.id,
      // `tipo` é o protocolo: um id próprio, que não colide com documento pedido pela empresa
      tipo: TIPO_CONTRATO_ASSINADO,
      categoria: "contrato",
      nome: pdf.nomeArquivo.replace(/\.pdf$/i, ""),
      arquivoUrl: `data:application/pdf;base64,${Buffer.from(pdf.bytes).toString("base64")}`,
      arquivoTipo: "application/pdf",
      tamanho: pdf.bytes.length,
      origem: "ADMISSAO",
      criadoEm: agora,
    },
    select: { id: true },
  });
  return criado;
}

/* ───────────────────────── o pacote ───────────────────────── */

export const MSG_SEM_DOCUMENTOS = "O colaborador não enviou nenhum documento nesta admissão.";

/** A extensão que combina com o que os BYTES dizem ser — nunca a que o nome prometia. */
const EXTENSAO: Record<string, string> = {
  "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png",
  "image/webp": ".webp", "image/heic": ".heic", "image/gif": ".gif",
};

/**
 * O pacote com o que o colaborador enviou, mais a ficha e o contrato — é o que o contador precisa,
 * numa coisa só. Os nomes dizem o que cada arquivo é, porque é por nome que o escritório arquiva.
 */
export async function pacoteDaAdmissao(
  admissaoId: string, empresaId: string, agora: Date = new Date(),
): Promise<ArquivoGerado & { arquivos: number }> {
  const a = await exigirPronta(admissaoId, empresaId);
  const cfg = await prisma.admissaoConfig.findUnique({ where: { empresaId }, select: { documentos: true } });
  const pedidos = documentosDaEmpresa(cfg?.documentos);
  const porId = new Map(pedidos.map((d) => [d.id, d.rotulo]));

  const linhas = await prisma.colaboradorDocumento.findMany({
    where: { colaboradorId: a.colaborador.id, excluidoEm: null, tipo: { in: pedidos.map((d) => d.id) } },
    orderBy: { criadoEm: "asc" },
    select: { tipo: true, nome: true, arquivoUrl: true, criadoEm: true },
  });

  const enviados: ArquivoZip[] = [];
  for (const l of linhas) {
    const bytes = l.arquivoUrl ? decodificarDataUrl(l.arquivoUrl) : null;
    if (!bytes) continue; // documento sem arquivo guardado não entra (e não quebra o pacote)
    const tipo = identificarTipo(bytes, l.nome) ?? "";
    const rot = porId.get(l.tipo) ?? l.tipo;
    enviados.push({
      nome: `Documentos enviados/${rot}${EXTENSAO[tipo] ?? ""}`,
      bytes,
      data: l.criadoEm,
    });
  }
  if (!enviados.length) throw new ErroEntrega(MSG_SEM_DOCUMENTOS, 409);

  // A ficha e o contrato vão junto: o contador recebe o pacote inteiro, não três downloads soltos.
  const ficha = await fichaDaAdmissao(admissaoId, empresaId, agora);
  const arquivos: ArquivoZip[] = [{ nome: ficha.nomeArquivo, bytes: ficha.bytes, data: agora }, ...enviados];
  if (a.contratoTexto) {
    const contrato = await contratoDaAdmissao(admissaoId, empresaId, agora);
    arquivos.splice(1, 0, { nome: contrato.nomeArquivo, bytes: contrato.bytes, data: agora });
  }

  return {
    bytes: montarZip(arquivos, agora),
    arquivos: arquivos.length,
    nomeArquivo: `Admissao - ${a.colaborador.nome}.zip`.replace(/\s+/g, " "),
  };
}
