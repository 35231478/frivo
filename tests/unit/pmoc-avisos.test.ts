/**
 * PMOC — Etapa 3: regras PURAS dos avisos de vencimento, da configuração e do envio ao cliente
 * (lib/pmoc-avisos), com o relógio em 12/11/2026, 12:00 de Brasília.
 */
import { describe, expect, it } from "vitest";
import { filtroStatusPmoc, situacaoPmoc, TAMANHO_MAX_ART } from "@/lib/pmoc";
import {
  ACAO_AVISO, ACAO_ENVIO, CONFIG_PMOC_PADRAO, avisoDoPlano, bloqueioEnvio, caminhoPublicoDocumento, configPmocSchema, detalheAviso, envioSchema, mensagemEnvio, textoAviso,
} from "@/lib/pmoc-avisos";
import { mudancaDaArt } from "@/lib/pmoc-server";

const AGORA = new Date("2026-11-12T15:00:00.000Z");
const plano = (dataExpiracao: string, extra: object = {}) => ({ status: "PUBLICADO", ativo: true, dataInicio: "2025-11-01", dataExpiracao, ...extra });

describe("aviso de vencimento do PMOC", () => {
  it("vencendo: do dia em que faltam N dias até o dia da expiração (que ainda é vigente); expirado: do dia seguinte em diante", () => {
    expect(avisoDoPlano(plano("2026-12-13"), 30, AGORA)).toBeNull();                              // faltam 31
    expect(avisoDoPlano(plano("2026-12-12"), 30, AGORA)).toEqual({ tipo: "VENCENDO", dias: 30 }); // faltam 30: entra
    expect(avisoDoPlano(plano("2026-11-13"), 30, AGORA)).toEqual({ tipo: "VENCENDO", dias: 1 });
    expect(avisoDoPlano(plano("2026-11-12"), 30, AGORA)).toEqual({ tipo: "VENCENDO", dias: 0 });  // expira hoje: ainda vigente
    expect(avisoDoPlano(plano("2026-11-11"), 30, AGORA)).toEqual({ tipo: "EXPIRADO", dias: 1 });
    expect(avisoDoPlano(plano("2026-10-13"), 30, AGORA)).toEqual({ tipo: "EXPIRADO", dias: 30 });
  });

  it("a antecedência é configurável: o mesmo plano avisa ou não conforme os dias da empresa (padrão: 30)", () => {
    const p = plano("2026-12-02"); // faltam 20
    expect(avisoDoPlano(p, 20, AGORA)).toEqual({ tipo: "VENCENDO", dias: 20 });
    expect(avisoDoPlano(p, 19, AGORA)).toBeNull();
    expect(avisoDoPlano(p, 365, AGORA)).toEqual({ tipo: "VENCENDO", dias: 20 });
    expect(avisoDoPlano(p, undefined, AGORA)).toEqual({ tipo: "VENCENDO", dias: 20 });
    expect(avisoDoPlano(plano("2026-12-13"), undefined, AGORA)).toBeNull();
    expect(CONFIG_PMOC_PADRAO).toEqual({ diasAviso: 30, textoPadrao: null });
    // o selo e o filtro da lista usam a mesma conta
    expect(situacaoPmoc(p, AGORA, 20).vencendo).toBe(true);
    expect(situacaoPmoc(p, AGORA, 19).vencendo).toBe(false);
    expect(situacaoPmoc(p, AGORA).vencendo).toBe(true);
    expect(filtroStatusPmoc("VENCENDO", AGORA, 20)).toEqual({ status: "PUBLICADO", dataExpiracao: { gte: new Date("2026-11-12T00:00:00Z"), lte: new Date("2026-12-02T00:00:00Z") } });
    expect(filtroStatusPmoc("VENCENDO", AGORA)).toEqual({ status: "PUBLICADO", dataExpiracao: { gte: new Date("2026-11-12T00:00:00Z"), lte: new Date("2026-12-12T00:00:00Z") } });
    expect(filtroStatusPmoc("EXPIRADO", AGORA)).toEqual({ status: "PUBLICADO", dataExpiracao: { lt: new Date("2026-11-12T00:00:00Z") } });
  });

  it("rascunho e plano inativo não avisam — nem vencendo, nem expirado", () => {
    for (const expira of ["2026-11-20", "2026-11-01"]) {
      expect(avisoDoPlano(plano(expira, { status: "RASCUNHO" }), 30, AGORA)).toBeNull();
      expect(avisoDoPlano(plano(expira, { ativo: false }), 30, AGORA)).toBeNull();
    }
  });

  it("o dia vira em Brasília, não em UTC: às 23h de Brasília do dia da expiração o plano ainda é vigente", () => {
    const p = plano("2026-11-12");
    expect(avisoDoPlano(p, 30, new Date("2026-11-13T02:00:00.000Z"))).toEqual({ tipo: "VENCENDO", dias: 0 }); // 23h do dia 12 em Brasília
    expect(avisoDoPlano(p, 30, new Date("2026-11-13T03:30:00.000Z"))).toEqual({ tipo: "EXPIRADO", dias: 1 });   // 00h30 do dia 13
  });

  it("textos: o do sino e o do histórico, no singular e no plural", () => {
    expect(textoAviso({ tipo: "VENCENDO", dias: 12 }, "2026-11-24")).toBe("Expira em 12 dias (24/11/2026)");
    expect(textoAviso({ tipo: "VENCENDO", dias: 1 }, "2026-11-13")).toBe("Expira amanhã (13/11/2026)");
    expect(textoAviso({ tipo: "VENCENDO", dias: 0 }, "2026-11-12")).toBe("Expira hoje (12/11/2026)");
    expect(textoAviso({ tipo: "EXPIRADO", dias: 1 }, "2026-11-11")).toBe("Expirou ontem (11/11/2026)");
    expect(textoAviso({ tipo: "EXPIRADO", dias: 40 }, "2026-10-03")).toBe("Expirou há 40 dias (03/10/2026)");
    expect(ACAO_AVISO).toEqual({ VENCENDO: "Aviso: plano perto de expirar", EXPIRADO: "Aviso: plano expirado" });
    expect(detalheAviso("VENCENDO", "2026-12-02", 20)).toBe("O plano expira em 02/12/2026 (faltam 20 dias).");
    expect(detalheAviso("VENCENDO", "2026-11-13", 1)).toBe("O plano expira em 13/11/2026 (faltam 1 dia).");
    expect(detalheAviso("VENCENDO", "2026-11-12", 0)).toBe("O plano expira hoje, 12/11/2026.");
    expect(detalheAviso("EXPIRADO", "2026-11-11", 1)).toBe("O plano expirou em 11/11/2026.");
  });
});

describe("configuração do PMOC por empresa", () => {
  it("antecedência: inteiro de 1 a 365; texto: opcional, sem espaços nas pontas, vazio vira 'usar o do sistema'", () => {
    expect(configPmocSchema.parse({ diasAviso: 1 })).toEqual({ diasAviso: 1, textoPadrao: null });
    expect(configPmocSchema.parse({ diasAviso: 365, textoPadrao: "  Texto  " })).toEqual({ diasAviso: 365, textoPadrao: "Texto" });
    expect(configPmocSchema.parse({ diasAviso: 30, textoPadrao: " \n " }).textoPadrao).toBeNull();
    const erro = (v: object) => configPmocSchema.safeParse(v).error?.issues[0].message;
    expect(erro({ diasAviso: 0 })).toBe("A antecedência vai de 1 a 365 dias.");
    expect(erro({ diasAviso: 366 })).toBe("A antecedência vai de 1 a 365 dias.");
    expect(erro({ diasAviso: 1.5 })).toBe("Use um número inteiro de dias.");
    expect(erro({ diasAviso: NaN })).toBe("Informe com quantos dias de antecedência avisar.");
    expect(erro({ diasAviso: 30, textoPadrao: "x".repeat(20_001) })).toBe("O texto padrão vai até 20.000 caracteres.");
  });
});

describe("envio do documento ao cliente", () => {
  it("só plano publicado e ativo vai ao cliente", () => {
    expect(bloqueioEnvio({ status: "PUBLICADO", ativo: true })).toBeNull();
    expect(bloqueioEnvio({ status: "RASCUNHO", ativo: true })).toBe("Publique o plano antes de enviar ao cliente.");
    expect(bloqueioEnvio({ status: "PUBLICADO", ativo: false })).toBe("PMOC inativo: reative antes de enviar ao cliente.");
    expect(bloqueioEnvio({ status: "RASCUNHO", ativo: false })).toBe("PMOC inativo: reative antes de enviar ao cliente.");
  });

  it("a mensagem: saudação pelo primeiro nome do contato, o plano sem 'PMOC' em dobro, a vigência, o link e a empresa do usuário", () => {
    const base = { empresa: "Clima Total", url: "https://app/relatorio/pmoc/abc", vigencia: "12/11/2026 a 11/11/2027" };
    expect(mensagemEnvio({ ...base, contato: "  Maria   Lima ", nomePmoc: "PMOC 2027 — Hospital" }))
      .toBe("Prezado(a) Maria,\n\nSegue o documento do PMOC 2027 — Hospital (vigência: 12/11/2026 a 11/11/2027):\nhttps://app/relatorio/pmoc/abc\n\nAtenciosamente,\nClima Total");
    expect(mensagemEnvio({ ...base, contato: null, nomePmoc: "Hospital Santa Clara" })).toMatch(/^Prezados,\n\nSegue o documento do PMOC Hospital Santa Clara \(/);
    expect(mensagemEnvio({ ...base, contato: "  ", nomePmoc: "pmoc do anexo" })).toContain("Segue o documento do pmoc do anexo (");
    expect(mensagemEnvio({ ...base, nomePmoc: "x", empresa: "Ar Puro" })).not.toMatch(/Clima Total|Termofrio/);
  });

  it("canais aceitos, o caminho público e o que cada envio escreve no histórico", () => {
    for (const canal of ["WHATSAPP", "EMAIL", "LINK"]) expect(envioSchema.parse({ canal })).toEqual({ canal });
    expect(envioSchema.safeParse({ canal: "SMS" }).success).toBe(false);
    expect(envioSchema.safeParse(null).success).toBe(false);
    expect(caminhoPublicoDocumento("abc_DEF-123")).toBe("/relatorio/pmoc/abc_DEF-123"); // /relatorio/ já é público no sistema
    expect(ACAO_ENVIO).toEqual({ WHATSAPP: "Documento enviado por WhatsApp", EMAIL: "Documento enviado por e-mail", LINK: "Link do documento copiado" });
  });
});

describe("arquivo da ART", () => {
  it("o limite é 3 MB: em base64 cabe no pedido (4,5 MB na hospedagem) e, com o documento, na resposta do PDF", () => {
    expect(TAMANHO_MAX_ART).toBe(3 * 1024 * 1024);
    expect(Math.ceil(TAMANHO_MAX_ART / 3) * 4).toBeLessThan(4.5 * 1024 * 1024);
  });

  it("o que mudou vai para o histórico: anexado, trocado, excluído — e nada quando o arquivo não mudou", () => {
    expect(mudancaDaArt({ artArquivo: "data:…", artArquivoNome: "ART.pdf" }, null)).toEqual({ acao: "Arquivo da ART anexado", detalhes: "ART.pdf" });
    expect(mudancaDaArt({ artArquivo: "data:…", artArquivoNome: "nova.pdf" }, "ART.pdf")).toEqual({ acao: "Arquivo da ART trocado", detalhes: "nova.pdf" });
    expect(mudancaDaArt({ artArquivo: "data:…" }, null)).toEqual({ acao: "Arquivo da ART anexado", detalhes: "ART" });
    expect(mudancaDaArt({ removerArt: true }, "ART.pdf")).toEqual({ acao: "Arquivo da ART excluído", detalhes: "ART.pdf" });
    expect(mudancaDaArt({ removerArt: true }, null)).toBeNull();
    expect(mudancaDaArt({}, "ART.pdf")).toBeNull();
    expect(mudancaDaArt({ artArquivo: null }, "ART.pdf")).toBeNull();
  });
});
