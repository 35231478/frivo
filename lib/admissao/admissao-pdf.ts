/**
 * A FICHA DE ADMISSÃO e o CONTRATO ASSINADO em PDF — o que o RH baixa e manda ao contador.
 *
 * A ficha segue os blocos do eSocial (evento S-2200, "Cadastramento Inicial do Vínculo e Admissão"):
 * identificação, documentos, endereço, contrato de trabalho, dependentes e dados bancários. Não é o
 * XML do eSocial — é a ficha em papel que o escritório de contabilidade usa para lançar o evento,
 * com os campos na ordem em que ele os procura.
 *
 * Nada aqui inventa dado. Campo que o colaborador não preencheu sai como "—", e não em branco: um
 * traço diz "foi perguntado e não veio", o vazio deixa a dúvida de se o sistema esqueceu.
 *
 * O desenho (folha, seção, tabela, rodapé) vem de lib/pdf/desenho, a mesma maquinaria do documento
 * do PMOC.
 */

import { PDFDocument, StandardFonts } from "pdf-lib";
import { C, Desenho, MARGEM } from "@/lib/pdf/desenho";
import { embutirFoto } from "@/lib/pdf/imagem";
import type { ArquivoGerado } from "@/lib/pdf/resposta";

/** O traço que ocupa o lugar do campo não preenchido. */
export const VAZIO = "—";

export const ou = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t || VAZIO;
};

/* ───────────────────────── o que a ficha mostra ───────────────────────── */

export interface LinhaFicha { rotulo: string; valor: string }

export interface DependenteFicha {
  nome: string; parentesco: string; nascimento: string; cpf: string;
  irrf: boolean; salarioFamilia: boolean;
}

export interface DadosFicha {
  /** Cabeçalho: quem emite */
  empresa: { nome: string; cnpj: string; cidade: string };
  colaborador: { nome: string; cpf: string };
  /** "Emitido em …" do rodapé */
  geradoEm: string;
  /** Os blocos do S-2200, na ordem em que o contador procura */
  identificacao: LinhaFicha[];
  documentos: LinhaFicha[];
  endereco: LinhaFicha[];
  contrato: LinhaFicha[];
  dependentes: DependenteFicha[];
  bancarios: LinhaFicha[];
  /** Marcos da admissão digital: quando foi assinada, por quem, de onde */
  prova: LinhaFicha[];
  /** Avisos honestos no fim (ex.: campos que ficaram sem resposta) */
  pendencias: string[];
}

/* ───────────────────────── o desenho ───────────────────────── */

function capaDaFicha(d: Desenho, dados: DadosFicha) {
  d.novaPagina();
  // Faixa do topo, por cima do cabeçalho corrido
  d.caixa(0, 0, d.largura, 92, C.acentoClaro);
  d.escrever(dados.empresa.nome, MARGEM, 22, { tamanho: 9, fonte: d.negrito, cor: C.acento });
  d.escrever("Ficha de Admissão", MARGEM, 40, { tamanho: 20, fonte: d.negrito });
  d.escrever("Dados para o eSocial — evento S-2200", MARGEM, 66, { tamanho: 9, cor: C.apoio });
  d.y = 112;

  d.escrever(dados.colaborador.nome, MARGEM, d.y, { tamanho: 15, fonte: d.negrito });
  d.y += 22;
  d.escrever(`CPF ${dados.colaborador.cpf}`, MARGEM, d.y, { tamanho: 10, cor: C.apoio });
  d.y += 26;
}

/** Uma seção com título numerado e os campos dela. Seção vazia não aparece. */
function bloco(d: Desenho, numero: number, titulo: string, linhas: LinhaFicha[]) {
  if (!linhas.length) return;
  d.secao(numero, titulo);
  d.campos(linhas);
}

/**
 * As colunas da tabela de dependentes. Exportada porque cada CABEÇALHO precisa caber na sua
 * coluna: o título sai em maiúsculas e, se não couber, vaza por cima da coluna vizinha (ou da
 * margem, na última). Um teste mede isso com a fonte de verdade.
 */
export const colunasDependentes = (util: number) => [
  { titulo: "Nome", largura: 158, negrito: true },
  { titulo: "Parentesco", largura: 84 },
  { titulo: "Nascimento", largura: 70 },
  { titulo: "CPF", largura: 86 },
  { titulo: "IRRF", largura: 34 },
  { titulo: "Sal. família", largura: util - 432 },
];

function blocoDependentes(d: Desenho, numero: number, dependentes: DependenteFicha[]) {
  d.secao(numero, "Dependentes");
  if (!dependentes.length) {
    d.paragrafo("Nenhum dependente declarado.", { cor: C.apoio, depois: 8 });
    return;
  }
  d.tabela(
    colunasDependentes(d.util),
    dependentes.map((p) => [
      p.nome, p.parentesco, ou(p.nascimento), ou(p.cpf),
      p.irrf ? "Sim" : "Não", p.salarioFamilia ? "Sim" : "Não",
    ]),
  );
}

async function desenharFicha(dados: DadosFicha): Promise<{ bytes: Uint8Array; paginas: number }> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Ficha de Admissão — ${dados.colaborador.nome}`);
  doc.setAuthor(dados.empresa.nome);
  doc.setSubject("Ficha de Admissão (eSocial S-2200)");
  doc.setCreator("Frivo"); doc.setProducer("Frivo"); doc.setLanguage("pt-BR");

  const d = new Desenho(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
    { empresa: dados.empresa.nome, titulo: `Ficha de Admissão — ${dados.colaborador.nome}`, geradoEm: dados.geradoEm },
  );

  capaDaFicha(d, dados);
  bloco(d, 1, "Identificação", dados.identificacao);
  bloco(d, 2, "Documentos", dados.documentos);
  bloco(d, 3, "Endereço", dados.endereco);
  bloco(d, 4, "Contrato de trabalho", dados.contrato);
  blocoDependentes(d, 5, dados.dependentes);
  bloco(d, 6, "Dados bancários", dados.bancarios);
  bloco(d, 7, "Assinatura do colaborador", dados.prova);

  if (dados.pendencias.length) {
    d.garantir(60);
    d.y += 6;
    d.escrever("Campos sem resposta", MARGEM, d.y, { tamanho: 10, fonte: d.negrito, cor: C.atrasado });
    d.y += 18;
    d.paragrafo(
      `O colaborador não preencheu: ${dados.pendencias.join(", ")}. Estes campos aparecem como ${VAZIO} na ficha.`,
      { tamanho: 9, cor: C.apoio },
    );
  }

  d.rodapes(d.paginas.length);
  return { bytes: await doc.save(), paginas: doc.getPageCount() };
}

/** O nome do arquivo que o RH recebe — o contador arquiva por nome, então ele diz o que é. */
export const nomeDaFicha = (nomeColaborador: string) =>
  `Ficha de Admissao - ${nomeColaborador}.pdf`.replace(/\s+/g, " ");

export async function gerarFichaPdf(dados: DadosFicha): Promise<ArquivoGerado & { paginas: number }> {
  const r = await desenharFicha(dados);
  return { ...r, nomeArquivo: nomeDaFicha(dados.colaborador.nome) };
}

/* ───────────────────────── o contrato assinado ───────────────────────── */

export interface DadosContratoPdf {
  empresa: { nome: string };
  colaborador: { nome: string; cpf: string };
  geradoEm: string;
  /** O texto congelado no momento da assinatura — nunca o modelo de agora */
  texto: string;
  assinatura: {
    nome: string | null;
    em: string | null;
    ip: string | null;
    navegador: string | null;
  };
  /** A selfie tirada na assinatura (data URL), se houver */
  selfie: string | null;
}


/**
 * O contrato como prova: o texto que a pessoa leu e aceitou, mais quem assinou, quando, de onde e
 * a foto tirada na hora. É este arquivo que responde "o que foi assinado?" dois anos depois.
 */
export async function gerarContratoPdf(dados: DadosContratoPdf): Promise<ArquivoGerado & { paginas: number }> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Contrato assinado — ${dados.colaborador.nome}`);
  doc.setAuthor(dados.empresa.nome);
  doc.setSubject("Contrato de trabalho assinado eletronicamente");
  doc.setCreator("Frivo"); doc.setProducer("Frivo"); doc.setLanguage("pt-BR");

  const d = new Desenho(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
    { empresa: dados.empresa.nome, titulo: `Contrato assinado — ${dados.colaborador.nome}`, geradoEm: dados.geradoEm },
  );

  d.novaPagina();
  d.escrever("Contrato de trabalho", MARGEM, d.y, { tamanho: 18, fonte: d.negrito });
  d.y += 26;
  d.escrever(`${dados.colaborador.nome} · CPF ${dados.colaborador.cpf}`, MARGEM, d.y, { tamanho: 10, cor: C.apoio });
  d.y += 28;

  // O texto congelado, como foi aceito. Parágrafo a parágrafo, preservando as linhas em branco.
  for (const paragrafo of String(dados.texto ?? "").split(/\n{2,}/)) {
    d.paragrafo(paragrafo, { tamanho: 10, entrelinha: 15, depois: 10 });
  }

  d.y += 10;
  d.secao(1, "Prova da assinatura");
  d.campos([
    { rotulo: "Assinado por", valor: ou(dados.assinatura.nome) },
    { rotulo: "Data e hora", valor: ou(dados.assinatura.em) },
    { rotulo: "Endereço de IP", valor: ou(dados.assinatura.ip) },
    { rotulo: "Navegador", valor: ou(dados.assinatura.navegador) },
  ]);

  const selfie = await embutirFoto(doc, dados.selfie);
  if (selfie) {
    const largura = Math.min(190, d.util);
    const altura = (selfie.height / selfie.width) * largura;
    d.garantir(altura + 26);
    d.escrever("FOTO TIRADA NA ASSINATURA", MARGEM, d.y, { tamanho: 7, fonte: d.negrito, cor: C.apoio });
    d.y += 14;
    d.pagina.drawImage(selfie, { x: MARGEM, y: d.altura - d.y - altura, width: largura, height: altura });
    d.y += altura + 12;
  }

  d.paragrafo(
    "Documento assinado eletronicamente pelo colaborador, por link próprio, com registro de data, hora e endereço de IP.",
    { tamanho: 8, cor: C.apoio },
  );

  d.rodapes(d.paginas.length);
  return {
    bytes: await doc.save(),
    paginas: doc.getPageCount(),
    nomeArquivo: `Contrato assinado - ${dados.colaborador.nome}.pdf`.replace(/\s+/g, " "),
  };
}
