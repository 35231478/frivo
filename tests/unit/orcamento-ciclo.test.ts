/**
 * Ciclo do orçamento — regra pura (lib/orcamentos/ciclo.ts):
 *  - etapa derivada: Visualizado/Expirado vêm das datas de um ENVIADO (dia civil de Brasília);
 *  - marcos com data de cada transição (quem, IP, motivo, quantas vezes abriu);
 *  - filtro da lista por etapa; transições da equipe; IP da requisição.
 */
import { describe, expect, it } from "vitest";
import {
  ETAPAS_CICLO, LABELS_ETAPA, CLASSE_ETAPA, MOTIVOS_RECUSA, ROTULO_EVENTO, TRANSICOES_EQUIPE,
  dataDaEtapa, ehAberturaDaPagina, ehRobo, etapaCiclo, ipDaRequisicao, marcosCiclo, podeMudarStatus, podeResponder, whereEtapa,
} from "@/lib/orcamentos/ciclo";

// 15/10/2026 12:00 em Brasília (15:00 UTC)
const AGORA = new Date("2026-10-15T15:00:00Z");
const dia = (s: string) => new Date(`${s}T00:00:00Z`); // dia civil gravado (meia-noite UTC)

describe("etapaCiclo", () => {
  it("status gravado direto: rascunho, aprovado, recusado, cancelado, convertido", () => {
    expect(etapaCiclo({ status: "RASCUNHO" }, AGORA)).toBe("RASCUNHO");
    expect(etapaCiclo({ status: "APROVADO", validadeEm: dia("2026-01-01") }, AGORA)).toBe("APROVADO");
    expect(etapaCiclo({ status: "REPROVADO" }, AGORA)).toBe("RECUSADO");
    expect(etapaCiclo({ status: "CANCELADO" }, AGORA)).toBe("CANCELADO");
    expect(etapaCiclo({ status: "CONVERTIDA" }, AGORA)).toBe("CONVERTIDO");
    expect(etapaCiclo({ status: "QUALQUER" }, AGORA)).toBe("RASCUNHO");
  });

  it("ENVIADO: enviado → visualizado (abriu o link) → expirado (passou o último dia da validade)", () => {
    expect(etapaCiclo({ status: "ENVIADO", validadeEm: dia("2026-10-20") }, AGORA)).toBe("ENVIADO");
    expect(etapaCiclo({ status: "ENVIADO", validadeEm: null }, AGORA)).toBe("ENVIADO");
    expect(etapaCiclo({ status: "ENVIADO", validadeEm: dia("2026-10-20"), visualizadoEm: AGORA }, AGORA)).toBe("VISUALIZADO");
    // Vence HOJE: ainda vale até o fim do dia
    expect(etapaCiclo({ status: "ENVIADO", validadeEm: dia("2026-10-15") }, AGORA)).toBe("ENVIADO");
    // Venceu ontem: expirado, mesmo se o cliente tiver visto
    expect(etapaCiclo({ status: "ENVIADO", validadeEm: dia("2026-10-14"), visualizadoEm: AGORA }, AGORA)).toBe("EXPIRADO");
    // Dia civil de Brasília: 16/10 01:00 UTC ainda é 15/10 22:00 em Brasília
    expect(etapaCiclo({ status: "ENVIADO", validadeEm: dia("2026-10-15") }, new Date("2026-10-16T01:00:00Z"))).toBe("ENVIADO");
    expect(etapaCiclo({ status: "ENVIADO", validadeEm: dia("2026-10-15") }, new Date("2026-10-16T03:30:00Z"))).toBe("EXPIRADO");
  });

  it("podeResponder: só ENVIADO dentro da validade", () => {
    expect(podeResponder({ status: "ENVIADO", validadeEm: dia("2026-10-15") }, AGORA)).toBe(true);
    expect(podeResponder({ status: "ENVIADO", validadeEm: dia("2026-10-14") }, AGORA)).toBe(false);
    expect(podeResponder({ status: "RASCUNHO", validadeEm: dia("2026-10-20") }, AGORA)).toBe(false);
    expect(podeResponder({ status: "APROVADO" }, AGORA)).toBe(false);
  });

  it("toda etapa tem rótulo e classe; Reprovado virou Recusado", () => {
    for (const e of ETAPAS_CICLO) {
      expect(LABELS_ETAPA[e]).toBeTruthy();
      expect(CLASSE_ETAPA[e]).toMatch(/badge/);
    }
    expect(LABELS_ETAPA.RECUSADO).toBe("Recusado");
    expect(LABELS_ETAPA.VISUALIZADO).toBe("Visualizado");
    expect(LABELS_ETAPA.EXPIRADO).toBe("Expirado");
  });
});

describe("marcosCiclo e dataDaEtapa", () => {
  const base = {
    criadoEm: new Date("2026-10-01T12:00:00Z"),
    enviadoEm: new Date("2026-10-02T12:00:00Z"),
    visualizadoEm: new Date("2026-10-03T12:00:00Z"),
  };

  it("aprovado: criado → enviado → visualizado (aberto N vezes) → aprovado (por quem, IP), em ordem", () => {
    const o = { ...base, status: "APROVADO", visualizacoes: 3, assinadoEm: new Date("2026-10-04T12:00:00Z"), assinadoPor: "Juliana Ramos", aprovadoIp: "200.1.2.3" };
    const m = marcosCiclo(o, AGORA);
    expect(m.map((x) => x.etapa)).toEqual(["CRIADO", "ENVIADO", "VISUALIZADO", "APROVADO"]);
    expect(m[2].detalhe).toBe("aberto 3 vezes");
    expect(m[3].detalhe).toBe("Juliana Ramos · IP 200.1.2.3");
    expect(dataDaEtapa(o, AGORA)).toEqual(new Date("2026-10-04T12:00:00Z"));
  });

  it("uma visualização só não diz 'aberto 1 vezes'; aprovado sem IP mostra só o nome", () => {
    const o = { ...base, status: "APROVADO", visualizacoes: 1, assinadoEm: new Date("2026-10-04T12:00:00Z"), assinadoPor: "Juliana" };
    const m = marcosCiclo(o, AGORA);
    expect(m.find((x) => x.etapa === "VISUALIZADO")!.detalhe).toBeNull();
    expect(m.find((x) => x.etapa === "APROVADO")!.detalhe).toBe("Juliana");
  });

  it("convertido conta o aprovado; assinatura em orçamento recusado/rascunho não vira marco de aprovado", () => {
    const conv = marcosCiclo({ ...base, status: "CONVERTIDA", assinadoEm: new Date("2026-10-04T12:00:00Z") }, AGORA);
    expect(conv.some((x) => x.etapa === "APROVADO")).toBe(true);
    const r = marcosCiclo({ ...base, status: "RASCUNHO", assinadoEm: new Date("2026-10-04T12:00:00Z"), recusadoEm: new Date("2026-10-05T12:00:00Z") }, AGORA);
    expect(r.map((x) => x.etapa)).toEqual(["CRIADO", "ENVIADO", "VISUALIZADO"]);
  });

  it("recusado: por quem e o motivo entre aspas; data da etapa = data da recusa", () => {
    const o = { ...base, status: "REPROVADO", recusadoEm: new Date("2026-10-05T12:00:00Z"), recusadoPor: "Juliana", recusaMotivo: "Preço acima do orçado" };
    const m = marcosCiclo(o, AGORA);
    expect(m.at(-1)).toMatchObject({ etapa: "RECUSADO", detalhe: "Juliana · “Preço acima do orçado”" });
    expect(dataDaEtapa(o, AGORA)).toEqual(new Date("2026-10-05T12:00:00Z"));
    expect(marcosCiclo({ status: "REPROVADO", recusadoEm: new Date("2026-10-05T12:00:00Z") }, AGORA)[0].detalhe).toBeNull();
  });

  it("expirado: o marco é o dia seguinte ao último dia da validade", () => {
    const o = { ...base, status: "ENVIADO", validadeEm: dia("2026-10-10") };
    const m = marcosCiclo(o, AGORA);
    expect(m.at(-1)).toMatchObject({ etapa: "EXPIRADO" });
    expect(m.at(-1)!.em).toEqual(dia("2026-10-11"));
    expect(dataDaEtapa(o, AGORA)).toEqual(dia("2026-10-11"));
    // Dentro da validade não tem marco de expirado
    expect(marcosCiclo({ ...o, validadeEm: dia("2026-10-20") }, AGORA).some((x) => x.etapa === "EXPIRADO")).toBe(false);
  });

  it("ordena pelas datas e a data do enviado/visualizado é a da etapa atual", () => {
    expect(dataDaEtapa({ ...base, status: "ENVIADO", visualizadoEm: null }, AGORA)).toEqual(base.enviadoEm);
    expect(dataDaEtapa({ ...base, status: "ENVIADO" }, AGORA)).toEqual(base.visualizadoEm);
    expect(dataDaEtapa({ status: "RASCUNHO", criadoEm: base.criadoEm }, AGORA)).toBeNull();
    const fora = marcosCiclo({ status: "ENVIADO", criadoEm: new Date("2026-10-09T00:00:00Z"), enviadoEm: new Date("2026-10-08T00:00:00Z") }, AGORA);
    expect(fora.map((x) => x.etapa)).toEqual(["ENVIADO", "CRIADO"]);
  });
});

describe("whereEtapa (filtro da lista)", () => {
  const hoje = dia("2026-10-15");
  const naValidade = { OR: [{ validadeEm: null }, { validadeEm: { gte: hoje } }] };
  it("cada etapa vira o where certo; desconhecida = sem filtro", () => {
    expect(whereEtapa("RASCUNHO", hoje)).toEqual({ status: "RASCUNHO" });
    expect(whereEtapa("APROVADO", hoje)).toEqual({ status: "APROVADO" });
    expect(whereEtapa("RECUSADO", hoje)).toEqual({ status: "REPROVADO" });
    expect(whereEtapa("CANCELADO", hoje)).toEqual({ status: "CANCELADO" });
    expect(whereEtapa("CONVERTIDO", hoje)).toEqual({ status: "CONVERTIDA" });
    expect(whereEtapa("EXPIRADO", hoje)).toEqual({ status: "ENVIADO", validadeEm: { lt: hoje } });
    expect(whereEtapa("VISUALIZADO", hoje)).toEqual({ AND: [{ status: "ENVIADO", visualizadoEm: { not: null } }, naValidade] });
    expect(whereEtapa("ENVIADO", hoje)).toEqual({ AND: [{ status: "ENVIADO", visualizadoEm: null }, naValidade] });
    expect(whereEtapa("XYZ", hoje)).toBeNull();
  });
});

describe("transições da equipe", () => {
  it("aprovar nunca é da equipe; voltar para rascunho e registrar recusa, sim", () => {
    for (const de of ["RASCUNHO", "ENVIADO", "REPROVADO", "CANCELADO", "CONVERTIDA"]) expect(podeMudarStatus(de, "APROVADO")).toBe(false);
    expect(podeMudarStatus("ENVIADO", "RASCUNHO")).toBe(true);
    expect(podeMudarStatus("REPROVADO", "RASCUNHO")).toBe(true);
    expect(podeMudarStatus("ENVIADO", "REPROVADO")).toBe(true);
    expect(podeMudarStatus("RASCUNHO", "ENVIADO")).toBe(true);
    expect(podeMudarStatus("REPROVADO", "ENVIADO")).toBe(true);
    expect(podeMudarStatus("APROVADO", "RASCUNHO")).toBe(false);
    expect(podeMudarStatus("APROVADO", "REPROVADO")).toBe(false);
    expect(podeMudarStatus("RASCUNHO", "REPROVADO")).toBe(false);
    expect(podeMudarStatus("CONVERTIDA", "CANCELADO")).toBe(false);
    expect(podeMudarStatus("APROVADO", "CANCELADO")).toBe(true);
    expect(podeMudarStatus("ENVIADO", "INVENTADO")).toBe(false);
    expect(Object.keys(TRANSICOES_EQUIPE).sort()).toEqual(["CANCELADO", "ENVIADO", "RASCUNHO", "REPROVADO"]);
  });
});

describe("ipDaRequisicao", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  it("1º do X-Forwarded-For, senão X-Real-IP; IPv6; lixo vira null", () => {
    expect(ipDaRequisicao(h({ "x-forwarded-for": " 200.1.2.3 , 10.0.0.1" }))).toBe("200.1.2.3");
    expect(ipDaRequisicao(h({ "x-real-ip": "189.4.5.6" }))).toBe("189.4.5.6");
    expect(ipDaRequisicao(h({ "x-forwarded-for": "2804:14c::1" }))).toBe("2804:14c::1");
    expect(ipDaRequisicao(h({}))).toBeNull();
    expect(ipDaRequisicao(h({ "x-forwarded-for": "<script>" }))).toBeNull();
    expect(ipDaRequisicao(h({ "x-forwarded-for": "1." }))).toBeNull();
    expect(ipDaRequisicao(h({ "x-forwarded-for": "1".repeat(46) }))).toBeNull();
  });
});

describe("ehRobo (prévia de link não é o cliente abrindo)", () => {
  it("navegadores de gente contam; prévias, antivírus de e-mail, scripts e sem UA não", () => {
    expect(ehRobo("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36")).toBe(false);
    expect(ehRobo("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBe(false);
    for (const ua of ["WhatsApp/2.23.20.0 A", "facebookexternalhit/1.1", "Slackbot-LinkExpanding 1.0", "TelegramBot (like TwitterBot)",
      "Mozilla/5.0 (compatible; Googlebot/2.1)", "curl/8.4.0", "Mozilla/5.0 HeadlessChrome/129.0", "Microsoft Office Preview", "", null, undefined]) {
      expect(ehRobo(ua)).toBe(true);
    }
  });
});

describe("ehAberturaDaPagina (só a navegação de uma pessoa conta)", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0 Safari/537.36";
  it("navegação (document) ou navegador sem o cabeçalho contam; service worker, prefetch e robô não", () => {
    expect(ehAberturaDaPagina(h({ "user-agent": UA, "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" }))).toBe(true);
    expect(ehAberturaDaPagina(h({ "user-agent": UA }))).toBe(true);
    expect(ehAberturaDaPagina(h({ "user-agent": UA, "sec-fetch-dest": "empty" }))).toBe(false); // app guardando offline
    expect(ehAberturaDaPagina(h({ "user-agent": UA, "sec-fetch-dest": "document", "sec-purpose": "prefetch;prerender" }))).toBe(false);
    expect(ehAberturaDaPagina(h({ "user-agent": UA, purpose: "prefetch" }))).toBe(false);
    expect(ehAberturaDaPagina(h({ "user-agent": "WhatsApp/2.23", "sec-fetch-dest": "document" }))).toBe(false);
  });
});

it("motivos rápidos e rótulos de evento", () => {
  expect(MOTIVOS_RECUSA).toContain("Preço acima do orçado");
  for (const t of ["ENVIADO", "ENVIADO_EMAIL", "ENVIADO_WHATSAPP", "LINK_COPIADO", "VISUALIZADO", "APROVADO", "RECUSADO", "STATUS"]) expect(ROTULO_EVENTO[t]).toBeTruthy();
});
