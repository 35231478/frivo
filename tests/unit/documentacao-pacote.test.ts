/**
 * DOCUMENTAÇÃO DA EQUIPE — as regras puras do pacote.
 *
 * O que se prova:
 *  - advertência e dados bancários NUNCA são oferecidos nem aceitos num pacote para cliente;
 *  - o que já vem marcado é segurança e medicina do trabalho (o que o cliente pede para liberar);
 *  - o diagnóstico: em dia entra; vencido SEM renovação segura o pacote; vencido COM renovação
 *    fica de fora sem alarde; gaveta vazia vira "falta"; vence hoje ainda vale;
 *  - papel sem data de vencimento não conta como renovação de um ASO vencido;
 *  - o pacote só leva quem foi marcado — documento de outro colaborador não entra por tabela;
 *  - as pastas: por colaborador, por tipo, e os dois — e barra no nome não vira pasta;
 *  - o link: validade só da lista (nunca eterno), revogado ganha de expirado;
 *  - os destinatários: Para obrigatório, cópia sem repetir quem já está no Para, teto de endereços.
 */
import { describe, expect, it } from "vitest";
import {
  CATEGORIAS_ENVIAVEIS, CATEGORIAS_PADRAO, CATEGORIAS_PROIBIDAS, DESTINATARIOS_MAX, VALIDADES_DIAS,
  VALIDADE_MAX_DIAS, VALIDADE_PADRAO_DIAS,
  caminhoNoPacote, caminhoPublicoDocumentacao, categoriaEnviavel, categoriasEnviaveisPorGrupo,
  conferirDestinatarios, diagnosticar, expiraEm, limparEmails, mensagemDeVencidos, organizacaoValida,
  situacaoDoLink, validadeDoLink, viaValida, type DocumentoCandidato,
} from "@/lib/documentacao/pacote";

/** 16/11/2026, 09:00 em Brasília */
const AGORA = new Date("2026-11-16T12:00:00.000Z");
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const MARINA = { id: "t1", nome: "Marina Alves" };
const JOAO = { id: "t2", nome: "João Lima" };

let n = 0;
const DOC = (extra: Partial<DocumentoCandidato> = {}): DocumentoCandidato => ({
  id: `d${++n}`, colaboradorId: "t1", categoria: "aso", nome: "ASO periódico",
  dataVencimento: dia("2027-06-01"), tamanho: 1000, temArquivo: true, ...extra,
});

describe("o que pode sair para o cliente", () => {
  it("advertência e dados bancários nunca — nem oferecidos, nem aceitos", () => {
    expect(CATEGORIAS_PROIBIDAS).toEqual(expect.arrayContaining(["disciplinar", "dados_bancarios"]));
    for (const proibida of CATEGORIAS_PROIBIDAS) {
      expect(CATEGORIAS_ENVIAVEIS.map((c) => c.id)).not.toContain(proibida);
      expect(categoriaEnviavel(proibida), proibida).toBe(false);
    }
    expect(categoriasEnviaveisPorGrupo().flatMap((g) => g.itens.map((i) => i.id))).not.toContain("disciplinar");
  });

  it("gaveta que não existe não é enviável", () => {
    expect(categoriaEnviavel("inventada")).toBe(false);
    expect(categoriaEnviavel(null)).toBe(false);
    expect(categoriaEnviavel("aso")).toBe(true);
  });

  it("o padrão marcado é segurança e medicina do trabalho — o que libera a entrada na obra", () => {
    expect(CATEGORIAS_PADRAO).toEqual(expect.arrayContaining(["aso", "nr_10", "nr_35", "ficha_epi"]));
    expect(CATEGORIAS_PADRAO, "contrato e documento pessoal só se o cliente pedir").not.toContain("contrato");
    expect(CATEGORIAS_PADRAO).not.toContain("documento_pessoal");
  });

  it("os grupos vêm na ordem do que o cliente mais pede: SMT primeiro", () => {
    expect(categoriasEnviaveisPorGrupo()[0].grupo).toBe("SMT");
  });
});

describe("o diagnóstico do pacote", () => {
  it("documento em dia entra, com o rótulo da gaveta", () => {
    const d = diagnosticar([MARINA], ["aso"], [DOC()], AGORA);
    expect(d.itens).toHaveLength(1);
    expect(d.itens[0]).toMatchObject({ colaboradorNome: "Marina Alves", categoria: "aso", categoriaRotulo: "ASO (exame)", venceEmBreve: false });
    expect(d.liberado).toBe(true);
  });

  it("documento sem validade entra (nem todo papel vence)", () => {
    const d = diagnosticar([MARINA], ["ficha_epi"], [DOC({ categoria: "ficha_epi", dataVencimento: null })], AGORA);
    expect(d.itens).toHaveLength(1);
    expect(d.vencidos).toEqual([]);
  });

  it("vencido SEM renovação segura o pacote — e não entra", () => {
    const vencido = DOC({ dataVencimento: dia("2026-11-01") });
    const d = diagnosticar([MARINA], ["aso"], [vencido], AGORA);
    expect(d.itens).toEqual([]);
    expect(d.vencidos).toHaveLength(1);
    expect(d.vencidos[0]).toMatchObject({ colaboradorNome: "Marina Alves", categoria: "aso", documentoId: vencido.id });
    expect(d.liberado).toBe(false);
  });

  it("vence HOJE ainda vale: o dia inteiro é do documento", () => {
    const d = diagnosticar([MARINA], ["aso"], [DOC({ dataVencimento: dia("2026-11-16") })], AGORA);
    expect(d.vencidos).toEqual([]);
    expect(d.itens[0].venceEmBreve).toBe(true);
  });

  it("vencido COM renovação na mesma gaveta fica de fora sem segurar o pacote", () => {
    const antigo = DOC({ nome: "ASO 2025", dataVencimento: dia("2026-01-10") });
    const novo = DOC({ nome: "ASO 2026", dataVencimento: dia("2027-01-10") });
    const d = diagnosticar([MARINA], ["aso"], [antigo, novo], AGORA);
    expect(d.itens.map((i) => i.documentoId)).toEqual([novo.id]);
    expect(d.vencidos, "o ASO antigo não trava quem já refez o exame").toEqual([]);
    expect(d.liberado).toBe(true);
  });

  it("papel SEM data de vencimento não renova um ASO vencido", () => {
    const vencido = DOC({ dataVencimento: dia("2026-01-10") });
    const semData = DOC({ nome: "Comprovante do agendamento", dataVencimento: null });
    const d = diagnosticar([MARINA], ["aso"], [vencido, semData], AGORA);
    expect(d.vencidos.map((v) => v.documentoId)).toEqual([vencido.id]);
    expect(d.liberado).toBe(false);
  });

  it("renovação é por pessoa: o ASO em dia do João não salva o vencido da Marina", () => {
    const d = diagnosticar([MARINA, JOAO], ["aso"], [
      DOC({ dataVencimento: dia("2026-01-10") }),
      DOC({ colaboradorId: "t2", dataVencimento: dia("2027-01-10") }),
    ], AGORA);
    expect(d.vencidos.map((v) => v.colaboradorNome)).toEqual(["Marina Alves"]);
  });

  it("renovação é por gaveta: NR-10 em dia não salva o ASO vencido", () => {
    const d = diagnosticar([MARINA], ["aso", "nr_10"], [
      DOC({ dataVencimento: dia("2026-01-10") }),
      DOC({ categoria: "nr_10", dataVencimento: dia("2027-01-10") }),
    ], AGORA);
    expect(d.vencidos.map((v) => v.categoria)).toEqual(["aso"]);
    expect(d.itens.map((i) => i.categoria)).toEqual(["nr_10"]);
  });

  it("gaveta marcada sem documento vira FALTA (avisa, não segura)", () => {
    const d = diagnosticar([MARINA, JOAO], ["aso"], [DOC()], AGORA);
    expect(d.faltando).toEqual([expect.objectContaining({ colaboradorNome: "João Lima", categoria: "aso" })]);
    expect(d.liberado, "falta não trava: a pessoa vê a lista e decide").toBe(true);
  });

  it("registro sem arquivo guardado não é documento: conta como falta", () => {
    const d = diagnosticar([MARINA], ["aso"], [DOC({ temArquivo: false })], AGORA);
    expect(d.itens).toEqual([]);
    expect(d.faltando).toHaveLength(1);
  });

  it("só entra quem foi marcado, e só as gavetas marcadas", () => {
    const d = diagnosticar([MARINA], ["aso"], [
      DOC(),
      DOC({ colaboradorId: "t2" }),                       // de outra pessoa
      DOC({ categoria: "contrato", dataVencimento: null }), // de outra gaveta
      DOC({ categoria: null }),                            // legado sem gaveta: não é reclassificado
    ], AGORA);
    expect(d.itens).toHaveLength(1);
    expect(d.itens[0].colaboradorId).toBe("t1");
    expect(d.itens[0].categoria).toBe("aso");
  });

  it("gaveta proibida marcada à força é ignorada pelo diagnóstico", () => {
    const d = diagnosticar([MARINA], ["disciplinar"], [DOC({ categoria: "disciplinar", dataVencimento: null })], AGORA);
    expect(d.itens).toEqual([]);
    expect(d.liberado).toBe(false);
  });

  it("pacote vazio não é liberado", () => {
    expect(diagnosticar([MARINA], ["aso"], [], AGORA).liberado).toBe(false);
  });

  it("a mensagem do bloqueio diz o que venceu, de quem, e o que fazer", () => {
    const d = diagnosticar([MARINA], ["aso"], [DOC({ dataVencimento: dia("2026-01-10") })], AGORA);
    const msg = mensagemDeVencidos(d.vencidos);
    expect(msg).toContain("ASO (exame) de Marina Alves");
    expect(msg).toContain("Renove o documento ou tire o colaborador do pacote");
    expect(mensagemDeVencidos([])).toBe("");
  });

  it("com muitos vencidos, a mensagem resume em vez de virar parede", () => {
    const pessoas = ["A", "B", "C", "D", "E"].map((x, i) => ({ id: `p${i}`, nome: `Pessoa ${x}` }));
    const docs = pessoas.map((p) => DOC({ colaboradorId: p.id, dataVencimento: dia("2026-01-10") }));
    expect(mensagemDeVencidos(diagnosticar(pessoas, ["aso"], docs, AGORA).vencidos)).toContain("e mais 2");
  });
});

describe("as pastas do pacote", () => {
  const item = { colaboradorNome: "Marina Alves", categoriaRotulo: "ASO (exame)", nome: "ASO periódico.pdf" };

  it("por colaborador: a pasta é a pessoa, e o arquivo diz o tipo", () => {
    expect(caminhoNoPacote(item, "POR_COLABORADOR")).toBe("Marina Alves/ASO (exame) - ASO periódico.pdf");
  });

  it("por tipo: a pasta é o tipo, e o arquivo diz de quem é", () => {
    expect(caminhoNoPacote(item, "POR_TIPO")).toBe("ASO (exame)/Marina Alves - ASO periódico.pdf");
  });

  it("os dois: pessoa e, dentro, o tipo", () => {
    expect(caminhoNoPacote(item, "COLABORADOR_E_TIPO")).toBe("Marina Alves/ASO (exame)/ASO periódico.pdf");
  });

  it("barra no nome não cria pasta que ninguém pediu", () => {
    const torto = { colaboradorNome: "Ana/Clara", categoriaRotulo: "NR-10", nome: "curso 2026/2027.pdf" };
    expect(caminhoNoPacote(torto, "POR_COLABORADOR").split("/")).toHaveLength(2);
    expect(caminhoNoPacote(torto, "POR_COLABORADOR")).toBe("Ana-Clara/NR-10 - curso 2026-2027.pdf");
  });

  it("organização inventada não é aceita", () => {
    expect(organizacaoValida("POR_TIPO")).toBe(true);
    expect(organizacaoValida("QUALQUER")).toBe(false);
  });
});

describe("o link", () => {
  it("a validade é só da lista — fora dela vira o padrão, nunca eterno", () => {
    for (const d of VALIDADES_DIAS) expect(validadeDoLink(d)).toBe(d);
    for (const torto of [0, -1, 365, 9999, "sempre", null, undefined, 8]) {
      expect(validadeDoLink(torto), String(torto)).toBe(VALIDADE_PADRAO_DIAS);
    }
    expect(Math.max(...VALIDADES_DIAS)).toBe(VALIDADE_MAX_DIAS);
    expect(VALIDADE_MAX_DIAS, "prazo curto: é dado de pessoa fora da empresa").toBeLessThanOrEqual(30);
  });

  it("expira no prazo pedido", () => {
    expect(expiraEm(7, AGORA).toISOString()).toBe("2026-11-23T12:00:00.000Z");
  });

  it("as situações: sem link, ativo, expirado — e revogado ganha de tudo", () => {
    const futuro = new Date("2026-11-20T12:00:00.000Z"), passado = new Date("2026-11-10T12:00:00.000Z");
    expect(situacaoDoLink({ token: null }, AGORA)).toBe("SEM_LINK");
    expect(situacaoDoLink({ token: "t", expiraEm: futuro }, AGORA)).toBe("ATIVO");
    expect(situacaoDoLink({ token: "t", expiraEm: passado }, AGORA)).toBe("EXPIRADO");
    expect(situacaoDoLink({ token: "t", expiraEm: AGORA }, AGORA), "no instante do prazo já não vale").toBe("EXPIRADO");
    expect(situacaoDoLink({ token: "t", expiraEm: futuro, revogadoEm: passado }, AGORA)).toBe("REVOGADO");
    expect(situacaoDoLink({ token: "t", expiraEm: null }, AGORA), "link sem prazo não existe").toBe("EXPIRADO");
  });

  it("o caminho público termina no token (a barra é o que o middleware libera)", () => {
    expect(caminhoPublicoDocumentacao("abc")).toBe("/documentacao/abc");
  });

  it("via inventada não é aceita", () => {
    expect(["LINK", "ZIP", "EMAIL"].every(viaValida)).toBe(true);
    expect(viaValida("WHATSAPP")).toBe(false);
  });
});

describe("os destinatários", () => {
  it("aceita lista ou texto separado por vírgula e ponto e vírgula, sem repetir", () => {
    expect(limparEmails("a@x.com, b@x.com; A@X.com\n c@x.com")).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
    expect(limparEmails(["a@x.com", "", "  b@x.com "])).toEqual(["a@x.com", "b@x.com"]);
  });

  it("sem Para não há envio", () => {
    expect(conferirDestinatarios([], ["c@x.com"])).toEqual({ ok: false, erro: "Informe pelo menos um e-mail de destino." });
  });

  it("vários no Para e na Cópia — e quem está no Para não se repete na Cópia", () => {
    const r = conferirDestinatarios(["a@x.com", "b@x.com"], ["B@x.com", "c@x.com"]);
    expect(r).toEqual({ ok: true, valor: { para: ["a@x.com", "b@x.com"], cc: ["c@x.com"] } });
  });

  it("endereço torto é recusado com o próprio endereço na mensagem", () => {
    const r = conferirDestinatarios(["sem-arroba"], []);
    expect(r).toEqual({ ok: false, erro: "E-mail inválido: sem-arroba" });
    expect(conferirDestinatarios(["a@x.com"], ["b@x"]).ok).toBe(false);
  });

  it("tem teto: é o contato do cliente, não uma lista de distribuição", () => {
    const muitos = Array.from({ length: DESTINATARIOS_MAX + 1 }, (_, i) => `p${i}@x.com`);
    expect(conferirDestinatarios(muitos, []).ok).toBe(false);
    expect(conferirDestinatarios(muitos.slice(0, DESTINATARIOS_MAX), []).ok).toBe(true);
  });
});
