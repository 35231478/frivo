/**
 * PMOC — Etapa 3: desenha o DOCUMENTO do plano em PDF, no servidor (pdf-lib: JavaScript puro, sem
 * navegador nem binário nativo — cabe numa função da Vercel).
 *
 * Tamanho: o texto usa as fontes padrão do PDF (Helvetica), que não são embutidas — o documento
 * sem anexo fica em dezenas de KB. A logo só entra se for PNG ou JPG pequena. A ART é anexada ao
 * fim (as páginas do PDF dela, ou a imagem numa página); se o total passar do limite de resposta da
 * hospedagem, o documento sai sem o arquivo e diz que a ART segue em arquivo separado.
 */
import { PDFDocument, StandardFonts, type PDFImage, type RGB } from "pdf-lib";
import { acento, status } from "@/lib/ui/tokens";
import { identificarTipo } from "@/lib/anexos";
import { rotuloMes, type ModeloDocumento } from "@/lib/pmoc-documento";
import { nomeComPmoc } from "@/lib/pmoc-cronograma";
// A folha, o cabeçalho corrido, a seção, o parágrafo, a tabela e o rodapé moram em lib/pdf: esta
// maquinaria nasceu aqui e saiu quando a Ficha de Admissão passou a precisar da mesma coisa.
import { A4, C, Desenho, MARGEM, cor } from "@/lib/pdf/desenho";

/** Tamanho máximo do PDF entregue: a resposta de uma função da Vercel vai até 4,5 MB */
export const TAMANHO_MAX_DOCUMENTO = 4_000_000;
/** Logo maior que isto não entra (o documento não pode pesar por causa dela) */
export const TAMANHO_MAX_LOGO = 600_000;
/** Meses por tabela do cronograma (uma folha em paisagem) */
export const MESES_POR_TABELA = 12;

export interface ArquivoArt { nome: string | null; bytes: Uint8Array }
export interface DocumentoPdf {
  bytes: Uint8Array;
  paginas: number;
  /** Como a ART entrou: as páginas do PDF dela, a imagem numa página, ou não entrou */
  art: "PDF" | "IMAGEM" | null;
  /** Por que o arquivo da ART não entrou (quando havia arquivo) */
  artFora: "GRANDE" | "ILEGIVEL" | null;
  nomeArquivo: string;
}

/** Fundo e letra de cada serviço na tabela do cronograma (repete depois do 5º) */
const TONS: { fundo: RGB; letra: RGB }[] = [
  { fundo: C.acentoClaro, letra: cor(acento.hover) },
  { fundo: cor(status.atencao.claro), letra: cor(status.atencao.texto) },
  { fundo: C.okClaro, letra: C.ok },
  { fundo: C.previstoClaro, letra: C.previsto },
  { fundo: C.atrasadoClaro, letra: C.atrasado },
];


/** A logo da empresa, se for PNG ou JPG e pequena; qualquer outra coisa fica de fora (sem erro) */
async function embutirLogo(doc: PDFDocument, logo: string | null): Promise<PDFImage | null> {
  const m = logo ? /^data:[^;,]*(?:;[^;,]*)*;base64,([\s\S]+)$/.exec(logo) : null;
  if (!m) return null;
  try {
    const bytes = new Uint8Array(Buffer.from(m[1], "base64"));
    if (bytes.length > TAMANHO_MAX_LOGO) return null;
    const tipo = identificarTipo(bytes);
    if (tipo === "image/png") return await doc.embedPng(bytes);
    if (tipo === "image/jpeg") return await doc.embedJpg(bytes);
  } catch { /* logo ilegível: o documento sai com o nome da empresa */ }
  return null;
}

function capa(d: Desenho, m: ModeloDocumento, logo: PDFImage | null) {
  d.novaPagina();
  // Faixa do topo, por cima do cabeçalho corrido
  d.caixa(0, 0, d.largura, 190, C.acento);
  let x = MARGEM;
  if (logo) {
    const escala = Math.min(120 / logo.width, 48 / logo.height);
    const w = logo.width * escala, h = logo.height * escala;
    d.caixa(MARGEM, 34, w + 16, h + 16, C.branco);
    d.pagina.drawImage(logo, { x: MARGEM + 8, y: d.altura - 42 - h, width: w, height: h });
    x = MARGEM + w + 30;
  }
  d.escrever(d.caber(m.empresa.nome, d.largura - x - MARGEM, 13, d.negrito), x, 44, { tamanho: 13, fonte: d.negrito, cor: C.branco });
  m.empresa.linhas.slice(0, 2).forEach((l, i) => d.escrever(d.caber(l, d.largura - x - MARGEM, 8.5), x, 62 + i * 12, { tamanho: 8.5, cor: C.branco }));
  d.escrever("PMOC", MARGEM, 116, { tamanho: 34, fonte: d.negrito, cor: C.branco });
  d.escrever("Plano de Manutenção, Operação e Controle", MARGEM, 158, { tamanho: 12, cor: C.branco });

  d.y = 226;
  d.paragrafo(m.nome, { tamanho: 20, fonte: d.negrito, entrelinha: 26, depois: 6 });
  // Situação: pílula com a cor do status
  const tom = m.status === "VIGENTE" ? { f: C.okClaro, l: C.ok } : m.status === "EXPIRADO" ? { f: C.atrasadoClaro, l: C.atrasado } : { f: C.previstoClaro, l: C.previsto };
  const rotulo = d.limpo(`${m.statusRotulo} · ${m.vigencia}`);
  d.caixa(MARGEM, d.y, d.negrito.widthOfTextAtSize(rotulo, 9.5) + 18, 20, tom.f);
  d.escrever(rotulo, MARGEM + 9, d.y + 5.5, { tamanho: 9.5, fonte: d.negrito, cor: tom.l });
  d.y += 44;

  for (const grupo of m.identificacao) {
    d.escrever(grupo.grupo.toUpperCase(), MARGEM, d.y, { tamanho: 7.5, fonte: d.negrito, cor: C.acento });
    d.y += 13;
    for (const campo of grupo.campos) {
      const linhas = d.linhas(campo.valor, d.util - 150, 10.5);
      d.escrever(campo.rotulo, MARGEM, d.y + 1, { tamanho: 9, cor: C.apoio });
      linhas.forEach((l, i) => d.escrever(l, MARGEM + 150, d.y + i * 14, { tamanho: 10.5 }));
      d.y += linhas.length * 14 + 5;
      d.reta(MARGEM, d.y - 2, d.largura - MARGEM, d.y - 2, C.linha);
      d.y += 3;
    }
    d.y += 12;
  }
}

function cronograma(d: Desenho, m: ModeloDocumento, numero: number) {
  d.novaPagina(true);
  d.secao(numero, "Cronograma de manutenção");
  if (!m.itens.length) {
    d.paragrafo("Este plano ainda não tem cronograma cadastrado.", { cor: C.apoio });
    return;
  }
  d.paragrafo(`Serviços previstos, a quem se aplicam e a periodicidade de cada um. ${m.totalExecucoes} execuções previstas na vigência do plano.`, { tamanho: 9, cor: C.apoio, depois: 6 });
  d.tabela(
    [{ titulo: "Cód.", largura: 46, negrito: true }, { titulo: "Serviço", largura: 170 }, { titulo: "Aplica-se a", largura: 176 }, { titulo: "Equip.", largura: 48, direita: true },
      { titulo: "Periodicidade", largura: 90 }, { titulo: "Dia", largura: 34, direita: true }, { titulo: "Fim de semana", largura: 134 }, { titulo: "Início", largura: 59.9 }],
    m.itens.map((i) => [i.codigo, i.servico, i.aplicaSe, String(i.equipamentos), i.frequencia, String(i.dia), i.fimSemana, i.inicio]),
  );
  if (!m.meses.length) {
    d.paragrafo("Nenhuma execução prevista dentro da vigência do plano com este cronograma.", { cor: C.apoio });
    return;
  }

  const tomDe = new Map(m.servicos.map((s, i) => [s.codigo, TONS[i % TONS.length]]));
  const colEquip = 186, altura = 24;
  for (let inicio = 0; inicio < m.meses.length; inicio += MESES_POR_TABELA) {
    const meses = m.meses.slice(inicio, inicio + MESES_POR_TABELA);
    const colMes = (d.util - colEquip) / MESES_POR_TABELA;
    const cabecalho = () => {
      d.caixa(MARGEM, d.y, d.util, 18, C.fundo, C.borda);
      d.escrever("EQUIPAMENTO", MARGEM + 5, d.y + 5.5, { tamanho: 7, fonte: d.negrito, cor: C.apoio });
      meses.forEach((mes, i) => {
        const t = rotuloMes(mes).toUpperCase();
        d.escrever(t, MARGEM + colEquip + i * colMes + (colMes - d.negrito.widthOfTextAtSize(t, 7)) / 2, d.y + 5.5, { tamanho: 7, fonte: d.negrito, cor: C.apoio });
      });
      d.y += 18;
    };
    // Não começa uma tabela no pé da folha: cabeçalho + 3 linhas, no mínimo
    d.garantir(18 + altura * Math.min(3, m.cronograma.length) + 20);
    if (m.meses.length > MESES_POR_TABELA) {
      d.escrever(`${rotuloMes(meses[0])} a ${rotuloMes(meses[meses.length - 1])}`, MARGEM, d.y, { tamanho: 9, fonte: d.negrito });
      d.y += 15;
    }
    cabecalho();
    d.aoQuebrar = cabecalho;
    for (const linha of m.cronograma) {
      d.garantir(altura);
      d.escrever(d.caber(linha.tag === "—" ? linha.descricao : `${linha.tag} · ${linha.descricao}`, colEquip - 10, 8, d.negrito), MARGEM + 5, d.y + 4, { tamanho: 8, fonte: d.negrito });
      d.escrever(d.caber(linha.local, colEquip - 10, 6.5), MARGEM + 5, d.y + 14, { tamanho: 6.5, cor: C.apoio });
      linha.celulas.slice(inicio, inicio + MESES_POR_TABELA).forEach((c, i) => {
        if (!c) return;
        const x = MARGEM + colEquip + i * colMes, tom = tomDe.get(c.codigo) ?? TONS[0];
        d.caixa(x + 1.5, d.y + 2, colMes - 3, altura - 4, tom.fundo);
        d.escrever(c.codigo, x + (colMes - d.negrito.widthOfTextAtSize(c.codigo, 7.5)) / 2, d.y + 4.5, { tamanho: 7.5, fonte: d.negrito, cor: tom.letra });
        d.escrever(c.data, x + (colMes - d.normal.widthOfTextAtSize(c.data, 7)) / 2, d.y + 13.5, { tamanho: 7, cor: C.texto });
      });
      d.y += altura;
      d.reta(MARGEM, d.y, MARGEM + d.util, d.y, C.linha);
    }
    d.aoQuebrar = null;
    d.y += 12;
  }

  // Legenda e observações
  d.garantir(16 + m.observacoes.length * 12);
  let x = MARGEM;
  for (const s of m.servicos) {
    const tom = tomDe.get(s.codigo) ?? TONS[0];
    const rotulo = d.limpo(s.nome);
    const w = d.negrito.widthOfTextAtSize(s.codigo, 7.5) + 10;
    if (x + w + d.normal.widthOfTextAtSize(rotulo, 8) + 22 > d.largura - MARGEM) { x = MARGEM; d.y += 16; d.garantir(16); }
    d.caixa(x, d.y, w, 13, tom.fundo);
    d.escrever(s.codigo, x + 5, d.y + 3, { tamanho: 7.5, fonte: d.negrito, cor: tom.letra });
    d.escrever(rotulo, x + w + 5, d.y + 2.5, { tamanho: 8, cor: C.texto });
    x += w + d.normal.widthOfTextAtSize(rotulo, 8) + 22;
  }
  d.y += 22;
  for (const o of m.observacoes) d.paragrafo(o, { tamanho: 8, cor: C.apoio, entrelinha: 11, depois: 2 });
}

function planejamento(d: Desenho, m: ModeloDocumento, numero: number) {
  d.novaPagina();
  d.secao(numero, "Planejamento das atividades");
  if (!m.planejamento.length) {
    d.paragrafo("Nenhum equipamento ativo no plano.", { cor: C.apoio });
    return;
  }
  d.paragrafo("Atividades de manutenção, operação e controle de cada tipo de equipamento coberto. As atividades são executadas e registradas na ordem de serviço de cada manutenção, com a periodicidade do cronograma.", { tamanho: 9, cor: C.apoio, depois: 8 });
  for (const p of m.planejamento) {
    d.garantir(46);
    d.caixa(MARGEM, d.y, d.util, 20, C.acentoClaro);
    d.escrever(d.caber(p.tipo, d.util - 130, 10, d.negrito), MARGEM + 8, d.y + 5, { tamanho: 10, fonte: d.negrito, cor: cor(acento.hover) });
    const n = p.equipamentos === 1 ? "1 equipamento" : `${p.equipamentos} equipamentos`;
    d.escrever(n, d.largura - MARGEM - 8 - d.normal.widthOfTextAtSize(n, 8.5), d.y + 6, { tamanho: 8.5, cor: cor(acento.hover) });
    d.y += 28;
    if (!p.atividades.length && !p.formularios.length) d.paragrafo("Checklist deste tipo de equipamento ainda não cadastrado.", { tamanho: 9, cor: C.apoio, x: MARGEM + 8, depois: 4 });
    p.atividades.forEach((a, i) => {
      const linhas = d.linhas(a, d.util - 34, 9);
      d.garantir(linhas.length * 12.5 + 3);
      d.escrever(`${i + 1}.`, MARGEM + 8, d.y, { tamanho: 9, cor: C.apoio });
      linhas.forEach((l, k) => d.escrever(l, MARGEM + 28, d.y + k * 12.5, { tamanho: 9 }));
      d.y += linhas.length * 12.5 + 3;
    });
    for (const f of p.formularios) {
      d.y += 4;
      d.paragrafo(`Formulário "${f.nome}" — em ${f.servico}`, { tamanho: 9, fonte: d.negrito, x: MARGEM + 8, depois: 1 });
      if (f.campos.length) d.paragrafo(f.campos.join(" · "), { tamanho: 8.5, cor: C.apoio, x: MARGEM + 8, depois: 2 });
    }
    d.y += 12;
  }
}

/** O livro de ocorrências: o que foi achado na manutenção, com a gravidade e a situação de cada uma */
function ocorrencias(d: Desenho, m: ModeloDocumento, numero: number) {
  d.y += 14;
  d.secao(numero, "Ocorrências");
  if (!m.ocorrencias.length) {
    d.paragrafo("Nenhuma ocorrência registrada neste plano até a emissão deste documento.", { cor: C.apoio });
    return;
  }
  d.paragrafo(`Não conformidades encontradas na manutenção dos equipamentos do plano. ${m.resumoOcorrencias}.`, { tamanho: 9, cor: C.apoio, depois: 6 });
  d.tabela(
    [{ titulo: "Data", largura: 58 }, { titulo: "Equipamento", largura: 118, negrito: true }, { titulo: "Descrição", largura: d.util - 318 }, { titulo: "Gravidade", largura: 58 }, { titulo: "Situação", largura: 84 }],
    m.ocorrencias.map((o) => [o.data, o.equipamento, o.resolucao ? `${o.descricao}\nResolução: ${o.resolucao}` : o.descricao, o.gravidade, o.situacao]),
  );
}

function assinaturas(d: Desenho, m: ModeloDocumento) {
  d.garantir(120);
  d.y += 34;
  const largura = (d.util - 40) / 2;
  const bloco = (x: number, linha1: string, linha2: string) => {
    d.reta(x, d.y, x + largura, d.y, C.texto);
    d.escrever(d.caber(linha1, largura, 9.5, d.negrito), x, d.y + 6, { tamanho: 9.5, fonte: d.negrito });
    d.escrever(d.caber(linha2, largura, 8.5), x, d.y + 20, { tamanho: 8.5, cor: C.apoio });
  };
  bloco(MARGEM, m.rt.nome || "Responsável Técnico", ["Responsável Técnico", m.rt.crea ? `CREA ${m.rt.crea}` : "", m.art.numero ? `ART ${m.art.numero}` : ""].filter(Boolean).join(" · "));
  bloco(MARGEM + largura + 40, "Responsável pelo estabelecimento", m.identificacao[0]?.campos[0]?.valor ?? "");
  d.y += 44;
}

/** A ART numa página do documento, quando o arquivo é imagem */
function paginaDaArt(d: Desenho, m: ModeloDocumento, imagem: PDFImage) {
  d.novaPagina();
  d.escrever(m.art.numero ? `Anexo — ART nº ${m.art.numero}` : "Anexo — ART", MARGEM, d.y, { tamanho: 14, fonte: d.negrito });
  d.y += 28;
  const alturaLivre = d.fim - d.y;
  const escala = Math.min(d.util / imagem.width, alturaLivre / imagem.height, 1.5);
  const w = imagem.width * escala, h = imagem.height * escala;
  d.pagina.drawImage(imagem, { x: MARGEM + (d.util - w) / 2, y: d.altura - d.y - h, width: w, height: h });
  d.y += h;
}

function avisoArtFora(d: Desenho, m: ModeloDocumento, motivo: "GRANDE" | "ILEGIVEL") {
  d.novaPagina();
  d.escrever(m.art.numero ? `Anexo — ART nº ${m.art.numero}` : "Anexo — ART", MARGEM, d.y, { tamanho: 14, fonte: d.negrito });
  d.y += 30;
  d.paragrafo(motivo === "GRANDE"
    ? "O arquivo da Anotação de Responsabilidade Técnica é grande demais para ser incluído neste documento. Ele acompanha o plano em arquivo separado."
    : "O arquivo da Anotação de Responsabilidade Técnica não pôde ser incluído neste documento. Ele acompanha o plano em arquivo separado.", { cor: C.apoio });
}

/** `semArt`: o motivo de o arquivo da ART ficar de fora desta vez (null = tenta incluir) */
async function desenhar(m: ModeloDocumento, art: ArquivoArt | null, semArt: "GRANDE" | "ILEGIVEL" | null): Promise<Omit<DocumentoPdf, "nomeArquivo">> {
  const doc = await PDFDocument.create();
  doc.setTitle(nomeComPmoc(m.nome)); doc.setAuthor(m.empresa.nome); doc.setSubject("Plano de Manutenção, Operação e Controle");
  doc.setCreator("Frivo"); doc.setProducer("Frivo"); doc.setLanguage("pt-BR");
  const d = new Desenho(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold),
    { empresa: m.empresa.nome, titulo: nomeComPmoc(m.nome), geradoEm: m.geradoEm });

  capa(d, m, await embutirLogo(doc, m.empresa.logo));

  d.novaPagina();
  d.secao(1, "Apresentação e base normativa");
  for (const p of m.texto) d.paragrafo(p, { tamanho: 10, entrelinha: 14.5, depois: 8 });

  d.y += 8;
  d.secao(2, "Equipamentos cobertos");
  if (m.equipamentos.length) {
    d.tabela(
      [{ titulo: "TAG", largura: 62, negrito: true }, { titulo: "Equipamento", largura: 142 }, { titulo: "Tipo", largura: 96 }, { titulo: "Capacidade", largura: 76 }, { titulo: "Local / ambiente", largura: d.util - 376 }],
      m.equipamentos.map((e) => [e.tag, e.descricao, e.tipo, e.capacidade, e.local]),
    );
  } else d.paragrafo("Nenhum equipamento ativo neste plano.", { cor: C.apoio });
  if (m.inativos > 0) d.paragrafo(`${m.inativos === 1 ? "1 equipamento do plano está inativo" : `${m.inativos} equipamentos do plano estão inativos`} no cadastro e não entra${m.inativos === 1 ? "" : "m"} no cronograma.`, { tamanho: 8, cor: C.apoio });

  cronograma(d, m, 3);
  planejamento(d, m, 4);
  ocorrencias(d, m, 5);
  assinaturas(d, m);

  // ART: a imagem vira uma página do documento; o PDF entra depois, com as páginas como são
  let entrou: DocumentoPdf["art"] = null, fora: DocumentoPdf["artFora"] = null;
  let pdfDaArt: PDFDocument | null = null;
  if (art) {
    const tipo = identificarTipo(art.bytes, art.nome ?? "");
    if (semArt) fora = semArt;
    else {
      try {
        if (tipo === "image/jpeg" || tipo === "image/png") { paginaDaArt(d, m, tipo === "image/png" ? await doc.embedPng(art.bytes) : await doc.embedJpg(art.bytes)); entrou = "IMAGEM"; }
        else if (tipo === "application/pdf") { pdfDaArt = await PDFDocument.load(art.bytes); entrou = "PDF"; }
        else fora = "ILEGIVEL";
      } catch { fora = "ILEGIVEL"; entrou = null; pdfDaArt = null; }
    }
    if (fora) avisoArtFora(d, m, fora);
  }

  d.rodapes(d.paginas.length);
  if (pdfDaArt) {
    try { for (const p of await doc.copyPages(pdfDaArt, pdfDaArt.getPageIndices())) doc.addPage(p); }
    catch { return desenhar(m, art, "ILEGIVEL"); } // o PDF da ART não pôde ser copiado: sai o aviso no lugar
  }
  return { bytes: await doc.save(), paginas: doc.getPageCount(), art: entrou, artFora: fora };
}

/**
 * Gera o PDF do documento. Com o arquivo da ART, tenta anexá-lo; se o resultado passar de
 * `limite` (ou o arquivo não puder ser lido), o documento sai sem o anexo e diz isso numa página.
 */
export async function gerarPdfDocumento(m: ModeloDocumento, art: ArquivoArt | null = null, limite = TAMANHO_MAX_DOCUMENTO): Promise<DocumentoPdf> {
  let r = await desenhar(m, art, null);
  if (art && r.bytes.length > limite) r = await desenhar(m, art, "GRANDE");
  return { ...r, nomeArquivo: m.nomeArquivo };
}
