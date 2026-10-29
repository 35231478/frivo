/**
 * Tela central "Notas fiscais de serviço" — regras puras: período (mês ‹ › e intervalo, no relógio
 * de Brasília), filtros da URL, data da nota, `where` (período pela data fiscal, busca, situação,
 * ambiente) e as ações que cada status permite (nada de botão que não funciona).
 */
import { describe, expect, it } from "vitest";
import {
  acoesDaNota, AMBIENTES_FILTRO, dataDaNota, GRUPOS_SITUACAO, hrefOrigem, lerFiltros, lerPeriodo, mesAtual, mesVizinho,
  motivoSemArquivo, rotuloMes, TOM_STATUS_NOTA, whereBusca, whereNotas, wherePeriodo,
} from "@/lib/nfse/central";

const agora = new Date("2026-10-29T12:00:00Z");
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("período", () => {
  it("padrão = mês corrente em Brasília (00:00 BRT = 03:00 UTC)", () => {
    const p = lerPeriodo({}, agora);
    expect([p.tipo, p.mes, p.rotulo, iso(p.gte), iso(p.lt)]).toEqual(["mes", "2026-10", "Outubro de 2026", "2026-10-01T03:00:00.000Z", "2026-11-01T03:00:00.000Z"]);
    // 1º/11 às 01:00 UTC ainda é 31/10 em Brasília
    expect(mesAtual(new Date("2026-11-01T01:00:00Z"))).toBe("2026-10");
    expect(mesAtual(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11");
  });

  it("?mes=AAAA-MM; inválido = mês corrente; dezembro vira o ano", () => {
    const p = lerPeriodo({ mes: "2026-12" }, agora);
    expect([p.mes, iso(p.gte), iso(p.lt), p.rotulo]).toEqual(["2026-12", "2026-12-01T03:00:00.000Z", "2027-01-01T03:00:00.000Z", "Dezembro de 2026"]);
    for (const ruim of ["2026-13", "2026-00", "26-10", "2026-1", "abc"]) expect(lerPeriodo({ mes: ruim }, agora).mes).toBe("2026-10");
  });

  it("mês vizinho e rótulo", () => {
    expect([mesVizinho("2026-01", -1), mesVizinho("2026-12", 1), mesVizinho("2026-10", 1), mesVizinho("x", 1)]).toEqual(["2025-12", "2027-01", "2026-11", "x"]);
    expect([rotuloMes("2026-03"), rotuloMes("lixo")]).toEqual(["Março de 2026", "lixo"]);
  });

  it("intervalo personalizado (dias de Brasília, `ate` inclusivo) vence o mês; invertido é trocado", () => {
    const p = lerPeriodo({ de: "2026-10-05", ate: "2026-10-20", mes: "2026-01" }, agora);
    expect([p.tipo, p.mes, p.de, p.ate, iso(p.gte), iso(p.lt), p.rotulo]).toEqual(
      ["intervalo", null, "2026-10-05", "2026-10-20", "2026-10-05T03:00:00.000Z", "2026-10-21T03:00:00.000Z", "05/10/2026 a 20/10/2026"]);
    const t = lerPeriodo({ de: "2026-10-20", ate: "2026-10-05" }, agora);
    expect([t.de, t.ate]).toEqual(["2026-10-05", "2026-10-20"]);
  });

  it("só um lado do intervalo; datas que não existem são ignoradas", () => {
    expect(lerPeriodo({ de: "2026-10-05" }, agora)).toMatchObject({ tipo: "intervalo", lt: null, rotulo: "A partir de 05/10/2026" });
    expect(lerPeriodo({ ate: "2026-10-05" }, agora)).toMatchObject({ tipo: "intervalo", gte: null, rotulo: "Até 05/10/2026" });
    expect(lerPeriodo({ de: "2026-02-31", ate: "2026-13-01" }, agora)).toMatchObject({ tipo: "mes", mes: "2026-10" });
    expect(lerPeriodo({ de: "2026-02-31", ate: "2026-03-01" }, agora)).toMatchObject({ tipo: "intervalo", de: null, ate: "2026-03-01" });
  });
});

describe("filtros da URL", () => {
  it("situação e ambiente só da lista; busca aparada e limitada; paginação do padrão", () => {
    expect(lerFiltros({ situacao: "falha", ambiente: "PRODUCAO", q: "  Hospital  ", pagina: "2", por: "25" }, agora))
      .toMatchObject({ situacao: "falha", ambiente: "PRODUCAO", q: "Hospital", pagina: 2, porPagina: 25 });
    expect(lerFiltros({ situacao: "toString", ambiente: "prod", q: "x".repeat(300) }, agora))
      .toMatchObject({ situacao: null, ambiente: null, pagina: 1, porPagina: 50 });
    expect(lerFiltros({ q: "x".repeat(300) }, agora).q).toHaveLength(100);
    expect([...AMBIENTES_FILTRO]).toEqual(["HOMOLOGACAO", "PRODUCAO"]);
  });

  it("grupos de situação dos cards", () => {
    expect(Object.fromEntries(Object.entries(GRUPOS_SITUACAO).map(([k, g]) => [k, [g.rotulo, [...g.status]]]))).toEqual({
      transmissao: ["Em transmissão", ["ENVIANDO", "PROCESSANDO"]],
      emitidas: ["Emitidas", ["CONCLUIDO"]],
      falha: ["Com falha", ["REJEITADO", "INTERROMPIDO"]],
      canceladas: ["Canceladas", ["CANCELADO"]],
    });
  });
});

describe("where", () => {
  const gte = new Date("2026-10-01T03:00:00Z"), lt = new Date("2026-11-01T03:00:00Z");

  it("período pela data fiscal: autorizada pela autorização; as outras pelo envio", () => {
    expect(wherePeriodo({ gte, lt })).toEqual({ OR: [{ autorizadaEm: { gte, lt } }, { autorizadaEm: null, criadoEm: { gte, lt } }] });
    expect(wherePeriodo({ gte, lt: null })).toEqual({ OR: [{ autorizadaEm: { gte } }, { autorizadaEm: null, criadoEm: { gte } }] });
    expect(wherePeriodo({ gte: null, lt: null })).toEqual({});
    expect(dataDaNota({ autorizadaEm: "2026-10-02", criadoEm: "2026-09-30" })).toBe("2026-10-02");
    expect(dataDaNota({ autorizadaEm: null, criadoEm: "2026-09-30" })).toBe("2026-09-30");
  });

  it("busca: número, tomador, OS, medição; CPF/CNPJ só com 3+ dígitos (sem pontuação)", () => {
    expect(whereBusca("")).toEqual({});
    expect(whereBusca("Hosp").OR).toHaveLength(4);
    const b = whereBusca("60.701.190");
    expect(b.OR).toHaveLength(5);
    expect(b.OR![4]).toEqual({ tomadorCpfCnpj: { contains: "60701190" } });
    expect(whereBusca("12").OR).toHaveLength(4);
    expect(whereBusca("123").OR![4]).toEqual({ tomadorCpfCnpj: { contains: "123" } });
    expect(b.OR!.slice(0, 4)).toEqual([
      { numero: { contains: "60.701.190", mode: "insensitive" } },
      { tomadorNome: { contains: "60.701.190", mode: "insensitive" } },
      { medicao: { numero: { contains: "60.701.190", mode: "insensitive" } } },
      { ordemServico: { numero: { contains: "60.701.190", mode: "insensitive" } } },
    ]);
  });

  it("where completo: empresa + período + busca + situação + ambiente", () => {
    const f = lerFiltros({ situacao: "falha", ambiente: "HOMOLOGACAO", q: "x" }, agora);
    const w = whereNotas("e1", f);
    expect(w.empresaId).toBe("e1");
    expect(w.AND[2]).toEqual({ status: { in: ["REJEITADO", "INTERROMPIDO"] } });
    expect(w.AND[3]).toEqual({ ambiente: "HOMOLOGACAO" });
    expect(whereNotas("e1", lerFiltros({}, agora)).AND.slice(1)).toEqual([{}, {}, {}]);
  });
});

describe("ações por nota", () => {
  const base = { medicaoId: "m1", ordemServicoId: null, temPdf: true, temXml: true };

  it("autorizada: PDF/XML (se o PlugNotas disponibilizou), cancelar 'em breve'; sem reconsultar nem reemitir", () => {
    expect(acoesDaNota({ ...base, status: "CONCLUIDO" })).toEqual({
      origem: "/financeiro/medicoes/m1", pdf: true, xml: true, reconsultar: false, cancelar: "em-breve", reemitir: null,
    });
    expect(acoesDaNota({ ...base, status: "CONCLUIDO", temPdf: false, temXml: false })).toMatchObject({ pdf: false, xml: false });
  });

  it("em transmissão: só reconsultar (sem arquivos, sem cancelar)", () => {
    for (const status of ["ENVIANDO", "PROCESSANDO"]) {
      expect(acoesDaNota({ ...base, status })).toMatchObject({ pdf: false, xml: false, reconsultar: true, cancelar: null, reemitir: null });
    }
  });

  it("rejeitada/interrompida: corrigir e reemitir pela medição (abre a emissão); sem medição, não", () => {
    for (const status of ["REJEITADO", "INTERROMPIDO"]) {
      expect(acoesDaNota({ ...base, status })).toMatchObject({ reemitir: "/financeiro/medicoes/m1?nfse=emitir#nfse", reconsultar: false, cancelar: null, pdf: false });
    }
    expect(acoesDaNota({ ...base, medicaoId: null, status: "REJEITADO" }).reemitir).toBeNull();
  });

  it("cancelada: nada além de ver e abrir a origem", () => {
    expect(acoesDaNota({ ...base, status: "CANCELADO" })).toEqual({ origem: "/financeiro/medicoes/m1", pdf: false, xml: false, reconsultar: false, cancelar: null, reemitir: null });
  });

  it("origem: a OS quando a nota partiu dela; senão a medição; sem nada, null", () => {
    expect(hrefOrigem({ medicaoId: "m1", ordemServicoId: "os1", origem: "OS" })).toBe("/ordens/os1");
    expect(hrefOrigem({ medicaoId: "m1", ordemServicoId: "os1", origem: "MEDICAO" })).toBe("/financeiro/medicoes/m1");
    expect(hrefOrigem({ medicaoId: null, ordemServicoId: "os1", origem: "MEDICAO" })).toBe("/ordens/os1");
    expect(hrefOrigem({ medicaoId: null, ordemServicoId: null })).toBeNull();
  });

  it("dica do arquivo indisponível e a cor de cada status", () => {
    expect(motivoSemArquivo("PROCESSANDO", "pdf")).toBe("Disponível após a autorização da nota.");
    expect(motivoSemArquivo("CONCLUIDO", "pdf")).toBe("O PlugNotas ainda não disponibilizou o PDF desta nota.");
    expect(motivoSemArquivo("CONCLUIDO", "xml")).toBe("O PlugNotas ainda não disponibilizou o XML desta nota.");
    expect(TOM_STATUS_NOTA).toEqual({ ENVIANDO: "atencao", PROCESSANDO: "atencao", CONCLUIDO: "ok", REJEITADO: "atrasado", INTERROMPIDO: "atrasado", CANCELADO: "previsto" });
  });
});
