/**
 * PMOC — Etapa 3: desenha o DOCUMENTO do plano em PDF, no servidor (pdf-lib: JavaScript puro, sem
 * navegador nem binário nativo — cabe numa função da Vercel).
 *
 * Tamanho: o texto usa as fontes padrão do PDF (Helvetica), que não são embutidas — o documento
 * sem anexo fica em dezenas de KB. A logo só entra se for PNG ou JPG pequena. A ART é anexada ao
 * fim (as páginas do PDF dela, ou a imagem numa página); se o total passar do limite de resposta da
 * hospedagem, o documento sai sem o arquivo e diz que a ART segue em arquivo separado.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { acento, neutro, status } from "@/lib/ui/tokens";
import { identificarTipo } from "@/lib/anexos";
import { rotuloMes, type ModeloDocumento } from "@/lib/pmoc-documento";
import { nomeComPmoc } from "@/lib/pmoc-cronograma";

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

const A4: [number, number] = [595.28, 841.89];
const MARGEM = 42;
const RODAPE = 34;

const cor = (hex: string): RGB => {
  const n = parseInt(hex.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const C = {
  acento: cor(acento.DEFAULT), acentoClaro: cor(acento.claro), texto: cor(neutro.texto), apoio: cor(neutro.secundario),
  borda: cor(neutro.borda), linha: cor(neutro.linha), fundo: cor(neutro.fundo), branco: rgb(1, 1, 1),
  ok: cor(status.ok.texto), okClaro: cor(status.ok.claro), atrasado: cor(status.atrasado.texto), atrasadoClaro: cor(status.atrasado.claro),
  previsto: cor(status.previsto.texto), previstoClaro: cor(status.previsto.claro),
};
/** Fundo e letra de cada serviço na tabela do cronograma (repete depois do 5º) */
const TONS: { fundo: RGB; letra: RGB }[] = [
  { fundo: C.acentoClaro, letra: cor(acento.hover) },
  { fundo: cor(status.atencao.claro), letra: cor(status.atencao.texto) },
  { fundo: C.okClaro, letra: C.ok },
  { fundo: C.previstoClaro, letra: C.previsto },
  { fundo: C.atrasadoClaro, letra: C.atrasado },
];

/** Troca o que a Helvetica do PDF não escreve (ela cobre o português, não setas nem emojis) */
const TROCAS: Record<string, string> = { "→": "->", "←": "<-", "≤": "<=", "≥": ">=", "≠": "<>", "✓": "", "✔": "", " ": " ", "\t": " ", "‑": "-", "−": "-" };

class Desenho {
  pagina!: PDFPage;
  /** Distância do topo da folha até onde o próximo conteúdo entra */
  y = 0;
  largura = A4[0];
  altura = A4[1];
  paisagem = false;
  /** Páginas do documento (as da ART, anexadas depois, não entram aqui) */
  paginas: PDFPage[] = [];
  private escreve: Set<number>;
  /** Chamado quando uma tabela continua noutra folha: redesenha o cabeçalho dela */
  aoQuebrar: (() => void) | null = null;

  constructor(readonly doc: PDFDocument, readonly normal: PDFFont, readonly negrito: PDFFont, readonly m: ModeloDocumento) {
    this.escreve = new Set(normal.getCharacterSet());
  }

  limpo(texto: string): string {
    let out = "";
    for (const ch of String(texto ?? "")) {
      if (ch === "\n") { out += ch; continue; }
      const t = TROCAS[ch] ?? ch;
      for (const c of t) out += this.escreve.has(c.codePointAt(0)!) ? c : "";
    }
    return out;
  }

  novaPagina(paisagem = false) {
    this.paisagem = paisagem;
    [this.largura, this.altura] = paisagem ? [A4[1], A4[0]] : A4;
    this.pagina = this.doc.addPage([this.largura, this.altura]);
    this.paginas.push(this.pagina);
    // Cabeçalho corrido (a capa desenha o seu por cima do topo)
    this.escrever(this.m.empresa.nome, MARGEM, 30, { tamanho: 8, cor: C.apoio });
    const titulo = this.caber(nomeComPmoc(this.m.nome), this.largura / 2, 8, this.normal);
    this.escrever(titulo, this.largura - MARGEM - this.normal.widthOfTextAtSize(titulo, 8), 30, { tamanho: 8, cor: C.apoio });
    this.reta(MARGEM, 38, this.largura - MARGEM, 38, C.borda);
    this.y = 58;
  }

  get util() { return this.largura - 2 * MARGEM; }
  get fim() { return this.altura - MARGEM - RODAPE; }

  /** Garante `altura` livre na folha; se não couber, abre outra (na mesma orientação) */
  garantir(altura: number) {
    if (this.y + altura <= this.fim) return;
    this.novaPagina(this.paisagem);
    this.aoQuebrar?.();
  }

  escrever(texto: string, x: number, yTopo: number, op: { tamanho?: number; fonte?: PDFFont; cor?: RGB } = {}) {
    const tamanho = op.tamanho ?? 10;
    const t = this.limpo(texto).replace(/\n/g, " ");
    if (!t) return;
    this.pagina.drawText(t, { x, y: this.altura - yTopo - tamanho * 0.78, size: tamanho, font: op.fonte ?? this.normal, color: op.cor ?? C.texto });
  }
  reta(x1: number, y1: number, x2: number, y2: number, c: RGB = C.borda, espessura = 0.6) {
    this.pagina.drawLine({ start: { x: x1, y: this.altura - y1 }, end: { x: x2, y: this.altura - y2 }, thickness: espessura, color: c });
  }
  caixa(x: number, yTopo: number, largura: number, altura: number, fundo?: RGB, borda?: RGB) {
    this.pagina.drawRectangle({ x, y: this.altura - yTopo - altura, width: largura, height: altura, color: fundo, borderColor: borda, borderWidth: borda ? 0.6 : 0 });
  }

  /** Quebra o texto em linhas que cabem em `largura` (respeita as quebras de linha do texto) */
  linhas(texto: string, largura: number, tamanho: number, fonte: PDFFont = this.normal): string[] {
    const out: string[] = [];
    for (const paragrafo of this.limpo(texto).split("\n")) {
      let atual = "";
      for (const palavra of paragrafo.split(/\s+/).filter(Boolean)) {
        let resto = palavra;
        // palavra maior que a coluna: parte onde couber
        while (fonte.widthOfTextAtSize(resto, tamanho) > largura && resto.length > 1) {
          let n = resto.length - 1;
          while (n > 1 && fonte.widthOfTextAtSize(resto.slice(0, n), tamanho) > largura) n--;
          if (atual) { out.push(atual); atual = ""; }
          out.push(resto.slice(0, n)); resto = resto.slice(n);
        }
        const tentativa = atual ? `${atual} ${resto}` : resto;
        if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura) atual = tentativa;
        else { out.push(atual); atual = resto; }
      }
      out.push(atual);
    }
    return out.length ? out : [""];
  }

  /** Uma linha só, cortada com reticências se não couber */
  caber(texto: string, largura: number, tamanho: number, fonte: PDFFont = this.normal): string {
    const t = this.limpo(texto).replace(/\n/g, " ");
    if (fonte.widthOfTextAtSize(t, tamanho) <= largura) return t;
    let n = t.length;
    while (n > 1 && fonte.widthOfTextAtSize(`${t.slice(0, n)}...`, tamanho) > largura) n--;
    return `${t.slice(0, n).trimEnd()}...`;
  }

  /** Texto corrido a partir de `this.y`, quebrando de folha quando precisa */
  paragrafo(texto: string, op: { tamanho?: number; fonte?: PDFFont; cor?: RGB; x?: number; largura?: number; entrelinha?: number; depois?: number } = {}) {
    const tamanho = op.tamanho ?? 10, entrelinha = op.entrelinha ?? tamanho * 1.45, x = op.x ?? MARGEM;
    for (const linha of this.linhas(texto, op.largura ?? this.util - (x - MARGEM), tamanho, op.fonte)) {
      this.garantir(entrelinha);
      this.escrever(linha, x, this.y, op);
      this.y += entrelinha;
    }
    this.y += op.depois ?? 0;
  }

  /** Título de seção: numeração, nome e a linha do acento embaixo */
  secao(numero: number, titulo: string) {
    this.garantir(60);
    this.escrever(`${numero}. ${titulo}`, MARGEM, this.y, { tamanho: 14, fonte: this.negrito });
    this.y += 22;
    this.reta(MARGEM, this.y, MARGEM + 46, this.y, C.acento, 2);
    this.reta(MARGEM + 46, this.y, this.largura - MARGEM, this.y, C.borda);
    this.y += 14;
  }

  /**
   * Tabela com cabeçalho que se repete a cada folha. `colunas`: largura e título; cada célula é
   * quebrada em linhas dentro da coluna, e a linha da tabela nunca é partida entre folhas.
   */
  tabela(colunas: { titulo: string; largura: number; negrito?: boolean; direita?: boolean }[], linhas: string[][], op: { tamanho?: number } = {}) {
    const tamanho = op.tamanho ?? 8.5, recuo = 5, entrelinha = tamanho * 1.35;
    const x0 = MARGEM;
    const cabecalho = () => {
      this.caixa(x0, this.y, this.util, 18, C.fundo, C.borda);
      let x = x0;
      for (const c of colunas) { this.escrever(c.titulo.toUpperCase(), x + recuo, this.y + 5.5, { tamanho: 7, fonte: this.negrito, cor: C.apoio }); x += c.largura; }
      this.y += 18;
    };
    this.garantir(18 + entrelinha * 2);
    cabecalho();
    const anterior = this.aoQuebrar;
    this.aoQuebrar = cabecalho;
    for (const linha of linhas) {
      const celulas = linha.map((v, i) => this.linhas(v, colunas[i].largura - 2 * recuo, tamanho, colunas[i].negrito ? this.negrito : this.normal));
      const altura = Math.max(...celulas.map((c) => c.length)) * entrelinha + 7;
      this.garantir(altura);
      let x = x0;
      celulas.forEach((linhasDaCelula, i) => {
        linhasDaCelula.forEach((t, n) => {
          const fonte = colunas[i].negrito ? this.negrito : this.normal;
          const dx = colunas[i].direita ? colunas[i].largura - recuo - fonte.widthOfTextAtSize(t, tamanho) : recuo;
          this.escrever(t, x + dx, this.y + 4 + n * entrelinha, { tamanho, fonte });
        });
        x += colunas[i].largura;
      });
      this.y += altura;
      this.reta(x0, this.y, x0 + this.util, this.y, C.linha);
    }
    this.aoQuebrar = anterior;
    this.y += 10;
  }

  rodapes(total: number) {
    this.paginas.forEach((p, i) => {
      this.pagina = p;
      [this.largura, this.altura] = [p.getWidth(), p.getHeight()];
      const y = this.altura - MARGEM - 8;
      this.reta(MARGEM, y - 8, this.largura - MARGEM, y - 8, C.borda);
      this.escrever(`${this.m.empresa.nome} · Documento eletrônico — Frivo`, MARGEM, y, { tamanho: 7.5, cor: C.apoio });
      const pag = `Página ${i + 1} de ${total}`;
      this.escrever(pag, this.largura - MARGEM - this.normal.widthOfTextAtSize(pag, 7.5), y, { tamanho: 7.5, cor: C.apoio });
      const meio = `Emitido em ${this.m.geradoEm}`;
      this.escrever(meio, (this.largura - this.normal.widthOfTextAtSize(meio, 7.5)) / 2, y, { tamanho: 7.5, cor: C.apoio });
    });
  }
}

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

function capa(d: Desenho, logo: PDFImage | null) {
  const m = d.m;
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

function cronograma(d: Desenho, numero: number) {
  const m = d.m;
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

function planejamento(d: Desenho, numero: number) {
  const m = d.m;
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

function assinaturas(d: Desenho) {
  const m = d.m;
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
function paginaDaArt(d: Desenho, imagem: PDFImage) {
  d.novaPagina();
  d.escrever(d.m.art.numero ? `Anexo — ART nº ${d.m.art.numero}` : "Anexo — ART", MARGEM, d.y, { tamanho: 14, fonte: d.negrito });
  d.y += 28;
  const alturaLivre = d.fim - d.y;
  const escala = Math.min(d.util / imagem.width, alturaLivre / imagem.height, 1.5);
  const w = imagem.width * escala, h = imagem.height * escala;
  d.pagina.drawImage(imagem, { x: MARGEM + (d.util - w) / 2, y: d.altura - d.y - h, width: w, height: h });
  d.y += h;
}

function avisoArtFora(d: Desenho, motivo: "GRANDE" | "ILEGIVEL") {
  d.novaPagina();
  d.escrever(d.m.art.numero ? `Anexo — ART nº ${d.m.art.numero}` : "Anexo — ART", MARGEM, d.y, { tamanho: 14, fonte: d.negrito });
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
  const d = new Desenho(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold), m);

  capa(d, await embutirLogo(doc, m.empresa.logo));

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

  cronograma(d, 3);
  planejamento(d, 4);
  assinaturas(d);

  // ART: a imagem vira uma página do documento; o PDF entra depois, com as páginas como são
  let entrou: DocumentoPdf["art"] = null, fora: DocumentoPdf["artFora"] = null;
  let pdfDaArt: PDFDocument | null = null;
  if (art) {
    const tipo = identificarTipo(art.bytes, art.nome ?? "");
    if (semArt) fora = semArt;
    else {
      try {
        if (tipo === "image/jpeg" || tipo === "image/png") { paginaDaArt(d, tipo === "image/png" ? await doc.embedPng(art.bytes) : await doc.embedJpg(art.bytes)); entrou = "IMAGEM"; }
        else if (tipo === "application/pdf") { pdfDaArt = await PDFDocument.load(art.bytes); entrou = "PDF"; }
        else fora = "ILEGIVEL";
      } catch { fora = "ILEGIVEL"; entrou = null; pdfDaArt = null; }
    }
    if (fora) avisoArtFora(d, fora);
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
