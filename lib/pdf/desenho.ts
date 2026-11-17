/**
 * A MAQUINARIA DE DESENHO dos PDF do sistema (pdf-lib: JavaScript puro, sem navegador nem binário
 * nativo — cabe numa função da Vercel).
 *
 * Nasceu no documento do PMOC e saiu de lá quando a Ficha de Admissão precisou da mesma coisa:
 * folha A4, cabeçalho corrido, seção, parágrafo que quebra de página sozinho, tabela com cabeçalho
 * que se repete e rodapé numerado. Nada aqui sabe o que é um PMOC ou uma admissão — o que varia
 * entre documentos entra pelo `Cabecalho`.
 *
 * As cores vêm dos tokens da interface (lib/ui/tokens), para o papel e a tela falarem a mesma
 * língua. O texto usa as fontes padrão do PDF (Helvetica), que não são embutidas: um documento sem
 * anexo fica em dezenas de KB.
 */

import { rgb, type PDFDocument, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { acento, neutro, status } from "@/lib/ui/tokens";

export const A4: [number, number] = [595.28, 841.89];
export const MARGEM = 42;
export const RODAPE = 34;

export const cor = (hex: string): RGB => {
  const n = parseInt(hex.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

export const C = {
  acento: cor(acento.DEFAULT), acentoClaro: cor(acento.claro), texto: cor(neutro.texto), apoio: cor(neutro.secundario),
  borda: cor(neutro.borda), linha: cor(neutro.linha), fundo: cor(neutro.fundo), branco: rgb(1, 1, 1),
  ok: cor(status.ok.texto), okClaro: cor(status.ok.claro), atrasado: cor(status.atrasado.texto), atrasadoClaro: cor(status.atrasado.claro),
  previsto: cor(status.previsto.texto), previstoClaro: cor(status.previsto.claro),
};

/** Troca o que a Helvetica do PDF não escreve (ela cobre o português, não setas nem emojis) */
const TROCAS: Record<string, string> = { "→": "->", "←": "<-", "≤": "<=", "≥": ">=", "≠": "<>", "✓": "", "✔": "", " ": " ", "\t": " ", "‑": "-", "−": "-" };

/**
 * O que muda de um documento para outro: o que vai no alto de cada folha, o que vai no rodapé e a
 * data de emissão. É só isto que o PMOC e a admissão não têm em comum.
 */
export interface Cabecalho {
  /** Canto esquerdo do topo e começo do rodapé — normalmente o nome da empresa */
  empresa: string;
  /** Canto direito do topo — o nome do documento */
  titulo: string;
  /** "Emitido em …", no meio do rodapé */
  geradoEm: string;
}

export class Desenho {
  pagina!: PDFPage;
  /** Distância do topo da folha até onde o próximo conteúdo entra */
  y = 0;
  largura = A4[0];
  altura = A4[1];
  paisagem = false;
  /** Páginas do documento (as anexadas depois, como a ART do PMOC, não entram aqui) */
  paginas: PDFPage[] = [];
  private escreve: Set<number>;
  /** Chamado quando uma tabela continua noutra folha: redesenha o cabeçalho dela */
  aoQuebrar: (() => void) | null = null;

  constructor(readonly doc: PDFDocument, readonly normal: PDFFont, readonly negrito: PDFFont, readonly m: Cabecalho) {
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
    this.escrever(this.m.empresa, MARGEM, 30, { tamanho: 8, cor: C.apoio });
    const titulo = this.caber(this.m.titulo, this.largura / 2, 8, this.normal);
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
      for (const c of colunas) {
        // coluna de número tem o cabeçalho à direita também: "QTD." à esquerda de uma coluna de
        // números alinhados à direita fica solto, parecendo cabeçalho da coluna vizinha
        const titulo = c.titulo.toUpperCase();
        const dx = c.direita ? c.largura - recuo - this.negrito.widthOfTextAtSize(titulo, 7) : recuo;
        this.escrever(titulo, x + dx, this.y + 5.5, { tamanho: 7, fonte: this.negrito, cor: C.apoio });
        x += c.largura;
      }
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

  /**
   * Campos rotulados em duas colunas, com uma linha fina separando as faixas — o jeito da casa de
   * mostrar "rótulo em cima, valor embaixo" num documento. Nasceu na Ficha de Admissão e virou
   * método aqui quando o motor de Modelos de documento precisou do mesmo bloco.
   *
   * A altura da faixa é a do campo mais alto dela: o par nunca é partido entre duas folhas.
   */
  campos(linhas: { rotulo: string; valor: string }[], op: { colunas?: number } = {}) {
    const colunas = op.colunas ?? 2;
    const vao = 16;
    const largura = (this.util - vao * (colunas - 1)) / colunas;
    const tamanhoRotulo = 7, tamanhoValor = 9.5;

    for (let i = 0; i < linhas.length; i += colunas) {
      const dupla = linhas.slice(i, i + colunas);
      const alturas = dupla.map((l) => this.linhas(l.valor, largura, tamanhoValor).length * (tamanhoValor * 1.35));
      const altura = Math.max(...alturas) + tamanhoRotulo + 9;
      this.garantir(altura);

      const topo = this.y;
      dupla.forEach((linha, n) => {
        const x = MARGEM + n * (largura + vao);
        this.escrever(linha.rotulo.toUpperCase(), x, topo, { tamanho: tamanhoRotulo, fonte: this.negrito, cor: C.apoio });
        let y = topo + tamanhoRotulo + 5;
        for (const texto of this.linhas(linha.valor, largura, tamanhoValor)) {
          this.escrever(texto, x, y, { tamanho: tamanhoValor });
          y += tamanhoValor * 1.35;
        }
      });
      this.y = topo + altura;
      this.reta(MARGEM, this.y - 3, MARGEM + this.util, this.y - 3, C.linha);
    }
    this.y += 8;
  }

  /**
   * O rodapé de todas as folhas: empresa à esquerda, "Emitido em" no meio, paginação à direita.
   *
   * As três âncoras são fixas, mas o nome da empresa não: "Clima Total Refrigeração e
   * Climatização · Documento eletrônico — Frivo" passava por cima do "Emitido em" do meio. Então a
   * esquerda é CORTADA para caber no espaço que sobra até o meio — o que importa ali é saber de
   * quem é o papel, e isso o começo do nome já diz.
   */
  rodapes(total: number) {
    const TAM = 7.5, VAO = 10;
    this.paginas.forEach((p, i) => {
      this.pagina = p;
      [this.largura, this.altura] = [p.getWidth(), p.getHeight()];
      const y = this.altura - MARGEM - 8;
      this.reta(MARGEM, y - 8, this.largura - MARGEM, y - 8, C.borda);

      const meio = `Emitido em ${this.m.geradoEm}`;
      const larguraMeio = this.normal.widthOfTextAtSize(meio, TAM);
      const xMeio = (this.largura - larguraMeio) / 2;
      this.escrever(meio, xMeio, y, { tamanho: TAM, cor: C.apoio });

      const pag = `Página ${i + 1} de ${total}`;
      this.escrever(pag, this.largura - MARGEM - this.normal.widthOfTextAtSize(pag, TAM), y, { tamanho: TAM, cor: C.apoio });

      const esquerda = this.cortar(`${this.m.empresa} · Documento eletrônico — Frivo`, xMeio - MARGEM - VAO, TAM);
      if (esquerda) this.escrever(esquerda, MARGEM, y, { tamanho: TAM, cor: C.apoio });
    });
  }

  /** O texto que cabe em `largura`, com reticências quando sobra. Vazio quando nem isso cabe. */
  cortar(texto: string, largura: number, tamanho: number, fonte: PDFFont = this.normal): string {
    if (largura <= 0) return "";
    if (fonte.widthOfTextAtSize(texto, tamanho) <= largura) return texto;
    let corte = texto;
    while (corte && fonte.widthOfTextAtSize(`${corte}…`, tamanho) > largura) corte = corte.slice(0, -1);
    return corte ? `${corte.trimEnd()}…` : "";
  }
}
