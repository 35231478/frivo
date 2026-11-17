/**
 * O PDF DO DOCUMENTO GERADO por modelo — ficha de entrega de EPI, termo de responsabilidade,
 * advertência, aditivo.
 *
 * Três partes: o texto da empresa já preenchido (congelado na emissão), a tabela de itens quando o
 * documento tem lista (a ficha de EPI tem, com o CA de cada equipamento), e a prova da assinatura
 * — a mesma do contrato da admissão: nome digitado, data e hora, IP, navegador e a foto tirada na
 * hora.
 *
 * O desenho (folha, seção, campos em duas colunas, tabela que repete o cabeçalho ao quebrar,
 * rodapé numerado) vem de lib/pdf/desenho, a mesma maquinaria do PMOC e da Ficha de Admissão.
 *
 * Enquanto o papel não é assinado ele sai com a tarja PRÉVIA: um documento que parece final sem
 * assinatura é pior do que nenhum documento.
 */

import { PDFDocument, StandardFonts } from "pdf-lib";
import { C, Desenho, MARGEM } from "@/lib/pdf/desenho";
import { embutirFoto } from "@/lib/pdf/imagem";
import type { ArquivoGerado } from "@/lib/pdf/resposta";
import { camposPreenchidos, type CampoPreenchido, type ItemDocumento } from "@/lib/documentos/modelos";

const VAZIO = "—";
const ou = (v: string | null | undefined) => (v ?? "").trim() || VAZIO;

export interface DadosDocumentoPdf {
  empresa: { nome: string; cnpj?: string | null };
  colaborador: { nome: string; cpf: string };
  /** O título do papel: o nome do modelo ("Ficha de entrega de EPI") */
  titulo: string;
  /** "Emitido em …" do rodapé */
  geradoEm: string;
  /** O texto da empresa, já preenchido e congelado */
  texto: string;
  itens: ItemDocumento[];
  /** O tipo do papel (EPI, TERMO, ADVERTENCIA, ADITIVO, OUTRO): decide o quadro de dados. */
  tipo: string | null;
  /** O que o usuário preencheu na hora de gerar, cru, como foi guardado. */
  valores: Record<string, unknown> | null;
  assinatura: {
    nome: string | null;
    em: string | null;
    ip: string | null;
    navegador: string | null;
  } | null;
  /** Foto tirada na assinatura (data URL) */
  selfie: string | null;
  /** O documento pede assinatura? (um aditivo arquivado pode não pedir) */
  exigeAssinatura: boolean;
}

/**
 * As colunas da tabela de itens. Exportadas porque o teste as MEDE com a fonte de verdade: um
 * cabeçalho que não cabe vaza por cima da coluna vizinha (e, na última, por cima da margem) sem
 * que nada apareça no texto extraído do PDF.
 *
 * As larguras: a descrição é o que mais cresce, então fica com a maior fatia; o CA é curto mas é
 * o que a fiscalização procura, então tem coluna própria e nunca quebra; a quantidade vai à
 * direita, como número; a entrega é uma data, de largura conhecida.
 */
export const colunasItens = (util: number) => [
  { titulo: "Item", largura: util - 260, negrito: true },
  { titulo: "Nº do CA", largura: 90 },
  { titulo: "Qtd.", largura: 56, direita: true },
  { titulo: "Entrega", largura: 114 },
];

/** A tabela dos itens entregues. O CA é coluna própria: é por ele que a fiscalização começa. */
function tabelaDeItens(d: Desenho, numero: number, titulo: string, itens: ItemDocumento[]) {
  d.secao(numero, titulo);
  d.tabela(
    colunasItens(d.util),
    itens.map((i) => [i.descricao, ou(i.ca), String(i.quantidade), ou(formatarDia(i.entregaEm))]),
  );
}

/**
 * O quadro do documento: os campos que a pessoa preencheu na hora de gerar, cada um com o seu
 * rótulo. O texto da empresa é a narrativa — este quadro é o fato, no mesmo lugar em todo papel do
 * mesmo tipo: a data do ocorrido de uma advertência, a previsão de devolução de um termo, o "como
 * era → como fica" de um aditivo. Sem ele, o que a empresa não citou no texto se perdia.
 *
 * Campo de texto longo (o motivo de uma advertência) não cabe em meia coluna: vai embaixo, inteiro.
 */
function quadroDoTipo(d: Desenho, numero: number, campos: CampoPreenchido[]) {
  const curtos = campos.filter((c) => c.formato !== "textoLongo");
  const longos = campos.filter((c) => c.formato === "textoLongo");

  d.secao(numero, "Dados do documento");
  if (curtos.length) d.campos(curtos.map((c) => ({ rotulo: c.rotulo, valor: c.valor })));
  for (const campo of longos) {
    d.garantir(40);
    d.escrever(campo.rotulo.toUpperCase(), MARGEM, d.y, { tamanho: 7, fonte: d.negrito, cor: C.apoio });
    d.y += 13;
    d.paragrafo(campo.valor, { tamanho: 9.5, entrelinha: 14, depois: 8 });
  }
}

/** "AAAA-MM-DD" → "DD/MM/AAAA". Sem data, devolve vazio (o chamador põe o travessão). */
function formatarDia(dia: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

export async function gerarDocumentoPdf(dados: DadosDocumentoPdf): Promise<ArquivoGerado & { paginas: number }> {
  const assinado = !!dados.assinatura?.em;
  const titulo = `${dados.titulo} — ${dados.colaborador.nome}`;

  const doc = await PDFDocument.create();
  doc.setTitle(titulo);
  doc.setAuthor(dados.empresa.nome);
  doc.setSubject(dados.titulo);
  doc.setCreator("Frivo"); doc.setProducer("Frivo"); doc.setLanguage("pt-BR");

  const d = new Desenho(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
    { empresa: dados.empresa.nome, titulo, geradoEm: dados.geradoEm },
  );

  d.novaPagina();
  d.escrever(dados.titulo, MARGEM, d.y, { tamanho: 18, fonte: d.negrito });
  d.y += 26;
  d.escrever(`${dados.colaborador.nome} · CPF ${dados.colaborador.cpf}`, MARGEM, d.y, { tamanho: 10, cor: C.apoio });
  d.y += 24;

  // Enquanto não está assinado, o papel diz isso em cima — não embaixo, onde ninguém lê.
  if (dados.exigeAssinatura && !assinado) {
    d.escrever("PRÉVIA — AINDA NÃO ASSINADO", MARGEM, d.y, { tamanho: 9, fonte: d.negrito, cor: C.atrasado });
    d.y += 20;
  }

  // O texto da empresa, parágrafo a parágrafo, preservando as linhas em branco
  for (const paragrafo of String(dados.texto ?? "").split(/\n{2,}/)) {
    d.paragrafo(paragrafo, { tamanho: 10, entrelinha: 15, depois: 10 });
  }

  let secao = 0;
  const campos = camposPreenchidos(dados.tipo, dados.valores);
  if (campos.length) {
    d.y += 6;
    quadroDoTipo(d, ++secao, campos);
  }
  if (dados.itens.length) {
    d.y += 6;
    // O termo de responsabilidade também lista o que está sob guarda — mas lá não é "entrega de EPI"
    tabelaDeItens(d, ++secao, dados.tipo === "TERMO" ? "Material sob guarda" : "Itens entregues", dados.itens);
  }

  if (dados.exigeAssinatura) {
    d.y += 6;
    d.secao(++secao, assinado ? "Prova da assinatura" : "Assinatura");
    if (assinado) {
      d.campos([
        { rotulo: "Assinado por", valor: ou(dados.assinatura?.nome) },
        { rotulo: "Data e hora", valor: ou(dados.assinatura?.em) },
        { rotulo: "Endereço de IP", valor: ou(dados.assinatura?.ip) },
        { rotulo: "Navegador", valor: ou(dados.assinatura?.navegador) },
      ]);

      const foto = await embutirFoto(doc, dados.selfie);
      if (foto) {
        // nunca esticar: uma foto pequena (ou um ícone mandado no lugar dela) viraria um bloco
        // gigante no papel assinado
        const largura = Math.min(190, d.util, foto.width);
        const altura = (foto.height / foto.width) * largura;
        d.garantir(altura + 26);
        d.escrever("FOTO TIRADA NA ASSINATURA", MARGEM, d.y, { tamanho: 7, fonte: d.negrito, cor: C.apoio });
        d.y += 14;
        d.pagina.drawImage(foto, { x: MARGEM, y: d.altura - d.y - altura, width: largura, height: altura });
        d.y += altura + 12;
      }

      d.paragrafo(
        "Documento assinado eletronicamente pelo colaborador, com registro de data, hora e endereço de IP.",
        { tamanho: 8, cor: C.apoio },
      );
    } else {
      d.paragrafo(
        "Este documento ainda não foi assinado. A assinatura é registrada no sistema, com data, hora, "
        + "endereço de IP e a foto tirada na entrega.",
        { tamanho: 9, cor: C.apoio },
      );
    }
  }

  d.rodapes(d.paginas.length);
  return {
    bytes: await doc.save(),
    paginas: doc.getPageCount(),
    nomeArquivo: `${dados.titulo} - ${dados.colaborador.nome}.pdf`.replace(/\s+/g, " "),
  };
}
