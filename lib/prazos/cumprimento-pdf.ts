/**
 * RELATÓRIO DE CUMPRIMENTO DE PRAZOS em PDF — o documento que a empresa manda ao cliente para
 * provar o que foi prometido e o que foi cumprido no período.
 *
 * O desenho (folha, seção, tabela, rodapé) vem de lib/pdf/desenho, a mesma maquinaria do documento
 * do PMOC e da Ficha de Admissão. As contas vêm todas de ./cumprimento: nada é recalculado aqui.
 *
 * O documento é honesto por construção: os casos SEM REGISTRO aparecem com nome e número, ficam
 * FORA do percentual, e o papel diz por quê. Um relatório que escondesse isso — ou que o somasse
 * como descumprido — mentiria para os dois lados.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { C, Desenho, MARGEM } from "@/lib/pdf/desenho";
import type { ArquivoGerado } from "@/lib/pdf/resposta";
import {
  AJUDA_PRAZO, LEGENDA_ESTADO, NOTA_SEM_REGISTRO, PRAZOS, ROTULO_ESTADO, ROTULO_PRAZO,
  medidos, textoMedidos, textoPercentual, textoSemRegistro,
  type Contagem, type EstadoCumprimento, type LinhaCumprimento, type ResumoCumprimento,
} from "./cumprimento";

export interface DadosCumprimentoPdf {
  empresa: { nome: string; cnpj: string };
  /** A quem o documento se dirige; sem cliente escolhido, o relatório é da operação inteira */
  cliente: { nome: string; documento: string } | null;
  contratoNumero: string | null;
  /** "1º a 30 de novembro de 2026" — o período por extenso, como a tela mostra */
  periodo: string;
  geradoEm: string;
  resumo: ResumoCumprimento;
  linhas: LinhaCumprimento[];
  /** dd/mm/aaaa de cada abertura, já no fuso de Brasília (a lib de fuso é de quem chama) */
  aberturaDe: (l: LinhaCumprimento) => string;
}

/** O traço que ocupa o lugar do prazo que o contrato não promete. */
const VAZIO = "—";
const celula = (e: EstadoCumprimento | null) => (e ? ROTULO_ESTADO[e] : VAZIO);

/** Teto de linhas no papel: acima disso o documento vira lista telefônica e ninguém lê. */
export const LINHAS_NO_PDF = 300;

function capa(d: Desenho, dados: DadosCumprimentoPdf) {
  d.novaPagina();
  d.caixa(0, 0, d.largura, 92, C.acentoClaro);
  d.escrever(dados.empresa.nome, MARGEM, 22, { tamanho: 9, fonte: d.negrito, cor: C.acento });
  d.escrever("Relatório de cumprimento de prazos", MARGEM, 40, { tamanho: 20, fonte: d.negrito });
  d.escrever(dados.periodo, MARGEM, 66, { tamanho: 9, cor: C.apoio });
  d.y = 112;

  d.escrever(dados.cliente?.nome ?? "Todos os clientes", MARGEM, d.y, { tamanho: 15, fonte: d.negrito });
  d.y += 22;
  const identificacao = [dados.cliente?.documento, dados.contratoNumero && `Contrato ${dados.contratoNumero}`].filter(Boolean).join(" · ");
  if (identificacao) { d.escrever(identificacao, MARGEM, d.y, { tamanho: 10, cor: C.apoio }); d.y += 16; }
  d.y += 12;
}

/** O número que resume tudo, grande, com o que entrou e o que ficou de fora logo abaixo. */
function destaque(d: Desenho, c: Contagem) {
  const altura = 76;
  d.garantir(altura + 10);
  d.caixa(MARGEM, d.y, d.util, altura, C.fundo, C.borda);
  d.escrever("CUMPRIMENTO NO PERÍODO", MARGEM + 16, d.y + 14, { tamanho: 7.5, fonte: d.negrito, cor: C.apoio });
  d.escrever(textoPercentual(c), MARGEM + 16, d.y + 28, { tamanho: 30, fonte: d.negrito, cor: medidos(c) === 0 ? C.apoio : C.acento });

  const dir = MARGEM + 200;
  d.escrever(textoMedidos(c), dir, d.y + 30, { tamanho: 11, fonte: d.negrito });
  d.escrever(`${c.descumpridos} ${c.descumpridos === 1 ? "descumprido" : "descumpridos"}`, dir, d.y + 48, { tamanho: 9.5, cor: c.descumpridos ? C.atrasado : C.apoio });
  const semRegistro = textoSemRegistro(c);
  if (semRegistro) d.escrever(semRegistro, dir + 120, d.y + 48, { tamanho: 9.5, cor: C.apoio });
  d.y += altura + 18;
}

/** Um quadro por prazo prometido: comparecer, resolver e o prazo de execução. */
function porPrazo(d: Desenho, resumo: ResumoCumprimento) {
  d.secao(1, "O que foi prometido e o que foi cumprido");
  d.tabela(
    [
      { titulo: "Prazo", largura: 150, negrito: true },
      { titulo: "Cumpridos", largura: 72, direita: true },
      { titulo: "Descumpridos", largura: 82, direita: true },
      { titulo: "Sem registro", largura: 80, direita: true },
      { titulo: "Cumprimento", largura: d.util - 384, direita: true },
    ],
    PRAZOS.map((p) => {
      const c = resumo[p];
      return [ROTULO_PRAZO[p], String(c.cumpridos), String(c.descumpridos), c.semRegistro ? String(c.semRegistro) : VAZIO, textoPercentual(c)];
    }),
  );
  d.paragrafo(
    `${AJUDA_PRAZO.comparecer.replace("Prazo de atendimento do contrato: e", "“Comparecer” e")} ${AJUDA_PRAZO.resolver.replace("Prazo de atendimento do contrato: e", "“Resolver” e")} “${ROTULO_PRAZO.execucao}”: ${AJUDA_PRAZO.execucao.replace("O compromisso", "o compromisso")}`,
    { tamanho: 8.5, cor: C.apoio, depois: 6 },
  );
  d.paragrafo(NOTA_SEM_REGISTRO, { tamanho: 8.5, cor: C.apoio, depois: 14 });
}

/** Chamado a chamado: o cliente confere o que é dele. */
function detalhe(d: Desenho, dados: DadosCumprimentoPdf) {
  d.secao(2, "Chamado a chamado");
  if (!dados.linhas.length) {
    d.paragrafo("Nenhum prazo a relatar no período.", { tamanho: 10, cor: C.apoio, depois: 12 });
    return;
  }
  const mostradas = dados.linhas.slice(0, LINHAS_NO_PDF);
  const largura = (d.util - 86 - 70 * 3) / (dados.cliente ? 1 : 2);
  const colunas = [
    { titulo: "Nº", largura: 86, negrito: true },
    { titulo: "Abertura", largura: largura },
    ...(dados.cliente ? [] : [{ titulo: "Cliente", largura }]),
    { titulo: "Comparecer", largura: 70 },
    { titulo: "Resolver", largura: 70 },
    { titulo: "Execução", largura: 70 },
  ];
  d.tabela(colunas, mostradas.map((l) => [
    l.numero, dados.aberturaDe(l),
    ...(dados.cliente ? [] : [l.clienteNome]),
    celula(l.comparecer), celula(l.resolver), celula(l.execucao),
  ]));
  if (dados.linhas.length > mostradas.length) {
    d.paragrafo(`Mostrando os ${mostradas.length} primeiros de ${dados.linhas.length} chamados do período. Os percentuais acima consideram todos.`,
      { tamanho: 8.5, cor: C.apoio, depois: 10 });
  }
}

/** O que cada palavra quer dizer — para o cliente ler sozinho, sem telefonar perguntando. */
function legenda(d: Desenho, resumo: ResumoCumprimento) {
  d.secao(3, "Como ler este relatório");
  d.campos([
    { rotulo: ROTULO_ESTADO.CUMPRIDO, valor: LEGENDA_ESTADO.CUMPRIDO },
    { rotulo: ROTULO_ESTADO.DESCUMPRIDO, valor: LEGENDA_ESTADO.DESCUMPRIDO },
    { rotulo: ROTULO_ESTADO.SEM_REGISTRO, valor: LEGENDA_ESTADO.SEM_REGISTRO },
    { rotulo: "Percentual de cumprimento", valor: `Prazos cumpridos dividido pelos prazos medidos (cumpridos + descumpridos). No período: ${textoPercentual(resumo.geral)}.` },
  ]);
}

/** O relatório de cumprimento de prazos em PDF. */
export async function gerarCumprimentoPdf(dados: DadosCumprimentoPdf): Promise<ArquivoGerado> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Cumprimento de prazos — ${dados.cliente?.nome ?? dados.empresa.nome}`);
  pdf.setProducer("Frivo");
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const d = new Desenho(pdf, normal, negrito, {
    empresa: dados.empresa.nome, titulo: "Cumprimento de prazos", geradoEm: dados.geradoEm,
  });

  capa(d, dados);
  destaque(d, dados.resumo.geral);
  porPrazo(d, dados.resumo);
  detalhe(d, dados);
  legenda(d, dados.resumo);
  d.rodapes(d.paginas.length);

  const alvo = dados.cliente?.nome ?? dados.empresa.nome;
  return { bytes: await pdf.save(), nomeArquivo: `Cumprimento de prazos — ${alvo} — ${dados.periodo}.pdf` };
}
