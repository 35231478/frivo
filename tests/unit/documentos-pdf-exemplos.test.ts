/**
 * O PAPEL CABE NA FOLHA, E O EXEMPLO É USÁVEL.
 *
 * Duas coisas que nenhum teste de rota pega:
 *
 *  1. **A tabela de itens da ficha de EPI.** Um cabeçalho que não cabe na coluna vaza por cima da
 *     vizinha — e, na última, por cima da margem da folha. No texto extraído do PDF tudo parece
 *     certo (foi assim que a tabela de dependentes da admissão passou batida). Então mede-se com a
 *     fonte de verdade, a mesma que o pdf-lib usa para desenhar.
 *  2. **Os modelos-exemplo.** Um exemplo que cita campo que o sistema não conhece ensina errado:
 *     a empresa usa, gera o papel e o `{{campo}}` sai cru no documento assinado.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { A4, MARGEM } from "@/lib/pdf/desenho";
import { colunasItens } from "@/lib/documentos/documento-pdf";
import { AVISO_EXEMPLO, EXEMPLOS, exemploDoTipo } from "@/lib/documentos/exemplos";
import {
  TIPOS, TIPOS_DOCUMENTO, camposDesconhecidosDoModelo, camposPreenchidos, tipoDe, valoresDoTipo, VALOR_MAX,
} from "@/lib/documentos/modelos";

const UTIL = A4[0] - 2 * MARGEM;
const RECUO = 5, CORPO = 7; // os mesmos de `Desenho.tabela`

describe("a tabela de itens cabe na folha", () => {
  it("a soma das colunas é exatamente a largura útil — nem sobra faixa, nem vaza", () => {
    const soma = colunasItens(UTIL).reduce((s, c) => s + c.largura, 0);
    expect(soma).toBe(UTIL);
  });

  it("cada cabeçalho cabe na sua coluna, medido com a fonte de verdade", async () => {
    const doc = await PDFDocument.create();
    const negrito = await doc.embedFont(StandardFonts.HelveticaBold);

    for (const c of colunasItens(UTIL)) {
      const largura = negrito.widthOfTextAtSize(c.titulo.toUpperCase(), CORPO) + 2 * RECUO;
      expect(largura, `cabeçalho "${c.titulo}"`).toBeLessThanOrEqual(c.largura);
    }
  });

  it("uma data e um CA longo cabem nas suas colunas, sem quebrar em duas linhas", async () => {
    const doc = await PDFDocument.create();
    const normal = await doc.embedFont(StandardFonts.Helvetica);
    const colunas = colunasItens(UTIL);
    const cabe = (texto: string, i: number) =>
      normal.widthOfTextAtSize(texto, 8.5) + 2 * RECUO <= colunas[i].largura;

    expect(cabe("CA 12345/2026", 1), "nº do CA").toBe(true);
    expect(cabe("31/12/2027", 3), "data de entrega").toBe(true);
    expect(cabe("9999", 2), "quantidade no teto").toBe(true);
  });
});

describe("o rodapé não escreve por cima de si mesmo", () => {
  /**
   * "Clima Total Refrigeração e Climatização · Documento eletrônico — Frivo" passava por cima do
   * "Emitido em …" do meio da folha. Mede-se o que sobra até o meio, com a fonte de verdade.
   */
  async function desenho(empresa: string) {
    const { Desenho } = await import("@/lib/pdf/desenho");
    const doc = await PDFDocument.create();
    return new Desenho(
      doc,
      await doc.embedFont(StandardFonts.Helvetica),
      await doc.embedFont(StandardFonts.HelveticaBold),
      { empresa, titulo: "Ficha de entrega de EPI", geradoEm: "17/11/2026 09:12" },
    );
  }

  it("com nome de empresa longo, a esquerda é cortada e não alcança o meio", async () => {
    const empresa = "Clima Total Refrigeração, Climatização e Serviços de Engenharia LTDA";
    const d = await desenho(empresa);
    d.novaPagina();
    d.rodapes(1);

    const TAM = 7.5, VAO = 10;
    const meio = `Emitido em 17/11/2026 09:12`;
    const xMeio = (A4[0] - d.normal.widthOfTextAtSize(meio, TAM)) / 2;
    const esquerda = d.cortar(`${empresa} · Documento eletrônico — Frivo`, xMeio - MARGEM - VAO, TAM);

    expect(esquerda, "foi cortada").toMatch(/…$/);
    expect(MARGEM + d.normal.widthOfTextAtSize(esquerda, TAM))
      .toBeLessThanOrEqual(xMeio - VAO);
  });

  it("o que o rodapé REALMENTE escreve na folha já vem cortado", async () => {
    const { textoDoPdf } = await import("./pmoc-pdf-util");
    const { gerarDocumentoPdf } = await import("@/lib/documentos/documento-pdf");
    const empresa = "Clima Total Refrigeração, Climatização e Serviços de Engenharia LTDA";

    const pdf = await gerarDocumentoPdf({
      empresa: { nome: empresa, cnpj: "12.345.678/0001-90" },
      colaborador: { nome: "Marina Alves Pereira", cpf: "529.982.247-25" },
      titulo: "Ficha de entrega de EPI", geradoEm: "17/11/2026 09:12",
      texto: "Texto do documento.", tipo: "EPI", valores: { entregaEm: "2026-11-17" },
      itens: [{ descricao: "Luva de vaqueta", ca: "12345", quantidade: 2, entregaEm: "2026-11-17" }],
      assinatura: null, selfie: null, exigeAssinatura: true,
    });
    const escrito = await textoDoPdf(pdf.bytes);

    expect(escrito, "a linha inteira não cabe antes do meio").not.toContain(`${empresa} · Documento eletrônico — Frivo`);
    expect(escrito, "sai cortada, com reticências").toMatch(/Clima Total Refrigeração[^\n]*…/);
    expect(escrito, "o meio continua lá").toContain("Emitido em 17/11/2026 09:12");
  });

  it("empresa de nome curto sai inteira, sem reticências", async () => {
    const d = await desenho("Clima Total");
    expect(d.cortar("Clima Total · Documento eletrônico — Frivo", 300, 7.5)).not.toContain("…");
  });

  it("sem espaço nenhum, não escreve nada em vez de escrever por cima", async () => {
    const d = await desenho("Clima Total");
    expect(d.cortar("Clima Total · Documento eletrônico — Frivo", 2, 7.5)).toBe("");
  });
});

describe("a foto da assinatura", () => {
  it("foto pequena não é esticada: um ícone de 1px não vira um bloco de 190pt no papel", async () => {
    const { gerarDocumentoPdf } = await import("@/lib/documentos/documento-pdf");
    // PNG 1×1 válido (o mesmo que o teste de rota usa como foto)
    const selfie = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const comum = {
      empresa: { nome: "Clima Total", cnpj: "12.345.678/0001-90" },
      colaborador: { nome: "Marina Alves Pereira", cpf: "529.982.247-25" },
      titulo: "Ficha de entrega de EPI", geradoEm: "17/11/2026 09:12",
      texto: "Texto.", tipo: "EPI", valores: { entregaEm: "2026-11-17" }, itens: [],
      assinatura: { nome: "Marina", em: "17/11/2026 09:14", ip: "189.45.12.7", navegador: "Chrome" },
      exigeAssinatura: true,
    };

    const comFoto = await gerarDocumentoPdf({ ...comum, selfie });
    const semFoto = await gerarDocumentoPdf({ ...comum, selfie: null });
    expect(comFoto.paginas, "1 pixel esticado a 190pt empurrava o papel para uma segunda folha")
      .toBe(semFoto.paginas);
  });
});

describe("os modelos-exemplo", () => {
  it("há um exemplo para cada tipo, e nenhum sobrando", () => {
    expect(EXEMPLOS.map((e) => e.tipo).sort()).toEqual([...TIPOS_DOCUMENTO].sort());
    for (const t of TIPOS) expect(exemploDoTipo(t.id), t.id).toBeTruthy();
  });

  it("nenhum exemplo cita campo que o sistema não conhece", () => {
    for (const ex of EXEMPLOS) {
      expect(camposDesconhecidosDoModelo(ex.texto, ex.tipo), ex.tipo).toEqual([]);
    }
  });

  it("cada exemplo usa os campos OBRIGATÓRIOS do seu tipo — senão nasce travado no gerar", () => {
    for (const ex of EXEMPLOS) {
      const faltando = tipoDe(ex.tipo).campos
        .filter((c) => c.obrigatorio && !ex.texto.includes(`{{${c.id}}}`))
        .map((c) => c.id);
      expect(faltando, `${ex.tipo}: o exemplo não pergunta`).toEqual([]);
    }
  });

  it("todo exemplo se apresenta: nome, texto com parágrafos e os dados da empresa e da pessoa", () => {
    for (const ex of EXEMPLOS) {
      expect(ex.nome.length, ex.tipo).toBeGreaterThan(3);
      expect(ex.texto.split(/\n{2,}/).length, `${ex.tipo}: um parágrafo só não é documento`).toBeGreaterThan(2);
      expect(ex.texto, ex.tipo).toContain("{{empresa}}");
      expect(ex.texto, ex.tipo).toContain("{{nome}}");
    }
  });

  it("o aviso diz quem revisa — o sistema preenche campo, não confere cláusula", () => {
    expect(AVISO_EXEMPLO).toMatch(/contador|advogado/i);
    expect(AVISO_EXEMPLO.length).toBeLessThan(200);
  });
});

describe("o que é guardado e o que é mostrado", () => {
  const VALORES = { ocorridoEm: "2026-11-10", medida: "Advertência escrita", motivo: "  atraso  ", inventado: "x" };

  it("guarda só o que o tipo conhece, aparado e dentro do teto", () => {
    const guardado = valoresDoTipo("ADVERTENCIA", { ...VALORES, motivo: "y".repeat(VALOR_MAX + 500) });
    expect(Object.keys(guardado).sort()).toEqual(["medida", "motivo", "ocorridoEm"]);
    expect(guardado.motivo.length).toBe(VALOR_MAX);
  });

  it("campo em branco não é guardado (e some do quadro do PDF)", () => {
    const guardado = valoresDoTipo("ADVERTENCIA", { ...VALORES, diasSuspensao: "   " });
    expect(guardado.diasSuspensao).toBeUndefined();
  });

  it("os campos preenchidos saem na ordem do tipo, com a data pronta para ler", () => {
    const campos = camposPreenchidos("ADVERTENCIA", VALORES);
    expect(campos.map((c) => c.id)).toEqual(["ocorridoEm", "motivo", "medida"]);
    expect(campos[0].valor).toBe("10/11/2026");
    expect(campos[1].valor, "aparado").toBe("atraso");
    expect(campos[1].formato, "o motivo é longo: o PDF põe embaixo, inteiro").toBe("textoLongo");
  });

  it("tipo sem campo nenhum não desenha quadro", () => {
    expect(camposPreenchidos("OUTRO", { qualquer: "coisa" })).toEqual([]);
  });
});
