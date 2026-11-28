/**
 * Leva I.2 — grupo D: as regras puras.
 *  11. a legenda do sistema de cada foto (o que "Restaurar legenda do sistema" devolve) e quando o botão aparece;
 *  12. quando a nota descartada pode ser restaurada e a mensagem da chave já importada de novo;
 *  13/14. filtros lembrados com parâmetros da tela (a `aba`), o `de` que é data, o período do Diário e o filtro
 *      "Só com alertas" dos checklists;
 *  15. para onde cada aviso de veículos/leads do sino leva (1 → o item; mais → a lista já filtrada) e o "lido"
 *      que volta a contar quando chega outro registro.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { legendaDoSistema, podeRestaurarLegenda, MSG_SEM_LEGENDA_SISTEMA } from "@/lib/os/galeria";
import { MSG_DESCARTE_JA_RESTAURADO, MSG_DESCARTE_SEM_XML, motivoNaoRestaurarNota, msgNotaJaImportadaDeNovo } from "@/lib/cadastros/regras-arquivar";
import { abriuLimpa, comNavegacao, filtroDeHoje, lembrado, paraLembrar } from "@/lib/listagem/filtros-lembrados";
import { hrefChecklistsComAlertas, hrefDocumentosVencendo, hrefLeadsSite, umOuLista } from "@/lib/alertas/destinos-sino";
import { assinaturaDoAviso, AVISOS_DO_NUMERO } from "@/lib/alertas/lidos";
import { lerFiltrosVeiculos, whereAviso } from "@/lib/veiculo-listagem";

const RAIZ = path.resolve(__dirname, "../..");
const fonte = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

describe("11. legenda do sistema", () => {
  it("execução com item do checklist ou momento; serviço adicional; anexo e execução sem nada: não tem", () => {
    expect(legendaDoSistema({ origem: "EXECUCAO", item: "Limpeza dos filtros", momento: "ANTES" })).toBe("Checklist: Limpeza dos filtros");
    expect(legendaDoSistema({ origem: "EXECUCAO", momento: "ANTES" })).toBe("Antes do serviço");
    expect(legendaDoSistema({ origem: "EXECUCAO", momento: "DEPOIS", item: null })).toBe("Depois do serviço");
    expect(legendaDoSistema({ origem: "EXECUCAO", momento: null, item: null })).toBeNull();
    expect(legendaDoSistema({ origem: "ADICIONAL", servico: "Troca do controle remoto" })).toBe("Serviço adicional: Troca do controle remoto");
    expect(legendaDoSistema({ origem: "ANEXO" })).toBeNull();
  });
  it("o botão só aparece quando há uma legenda do sistema diferente da atual", () => {
    expect(podeRestaurarLegenda({ legenda: "Evaporadora suja", legendaSistema: "Antes do serviço" })).toBe(true);
    expect(podeRestaurarLegenda({ legenda: "Antes do serviço", legendaSistema: "Antes do serviço" })).toBe(false);
    expect(podeRestaurarLegenda({ legenda: "Fachada", legendaSistema: null })).toBe(false);
    expect(podeRestaurarLegenda({ legenda: "Fachada" })).toBe(false);
    expect(MSG_SEM_LEGENDA_SISTEMA).not.toMatch(/você/i);
  });
});

describe("12. restaurar nota descartada", () => {
  it("só o descarte com XML e ainda não restaurado", () => {
    expect(motivoNaoRestaurarNota({ temXml: true, restauradaEm: null })).toBeNull();
    expect(motivoNaoRestaurarNota({ temXml: false, restauradaEm: null })).toBe(MSG_DESCARTE_SEM_XML);
    expect(motivoNaoRestaurarNota({ temXml: true, restauradaEm: new Date() })).toBe(MSG_DESCARTE_JA_RESTAURADO);
    expect(MSG_DESCARTE_SEM_XML).toContain("importe o XML de novo");
  });
  it("a chave já importada de novo: mensagem clara, com a NF e a data", () => {
    expect(msgNotaJaImportadaDeNovo({ numero: "4521", serie: "1", em: "20/11/2026" }))
      .toBe("A NF 4521/1 já foi importada de novo em 20/11/2026. Abra a nota importada.");
  });
});

describe("13/14. filtros lembrados por aba e na URL", () => {
  it("a `aba` é da tela: não conta para 'abriu limpa', não é guardada e fica como está ao restaurar", () => {
    expect(abriuLimpa("aba=diario", ["aba"])).toBe(true);
    expect(abriuLimpa("aba=diario")).toBe(false);
    expect(abriuLimpa("aba=diario&de=2026-11-01", ["aba"])).toBe(false);
    expect(paraLembrar("aba=preenchidos&situacao=inativos&pagina=3", ["aba"])).toBe("situacao=inativos");
    expect(comNavegacao("situacao=inativos&q=frv", "aba=preenchidos", ["aba"])).toBe("situacao=inativos&q=frv&aba=preenchidos");
    expect(filtroDeHoje(lembrado("aba=diario&de=2026-11-01&ate=2026-11-07", "2026-11-28", ["aba"]), "2026-11-28")).toBe("de=2026-11-01&ate=2026-11-07");
  });
  it("o `de` que é DATA é filtro (guardado); o `de` de onde veio, não", () => {
    expect(paraLembrar("de=2026-11-01&ate=2026-11-30")).toBe("de=2026-11-01&ate=2026-11-30");
    expect(paraLembrar("de=contas-pagar&status=IMPORTADA")).toBe("status=IMPORTADA");
  });
  it("as três listas filtradas no navegador usam o filtro na URL + lembrados (o mesmo hook)", () => {
    for (const f of ["app/(dashboard)/qrcodes/qrcodes-client.tsx", "components/veiculos/checklists-preenchidos.tsx", "components/financeiro/despesas-campo-view.tsx", "components/veiculos/checklist-diario.tsx"]) {
      expect(fonte(f), f).toContain("useListagemUrl(");
    }
    expect(fonte("app/(dashboard)/qrcodes/qrcodes-client.tsx")).toContain('useFiltroUrl("vinculo", navegar)');
    expect(fonte("components/financeiro/despesas-campo-view.tsx")).toContain('useFiltroUrl("situacao", navegar, { vazio: "PENDENTE" })');
  });
  it("as 5 tabelas feitas à mão viraram TabelaPro (sem <table> próprio)", () => {
    for (const f of ["components/financeiro/faturamento-contratos-view.tsx", "components/admin/empresas-admin.tsx", "components/colaborador/documentos-colaborador.tsx",
      "components/veiculos/checklist-diario.tsx", "components/estoque/separacao-os.tsx"]) {
      expect(fonte(f), f).toContain("<TabelaPro");
      expect(fonte(f), f).not.toMatch(/<table[\s>]/);
    }
  });
  it("Diário: o período da URL (inválido ou invertido se corrige; sem ele, os últimos 7 dias)", async () => {
    const { periodoDiario } = await import("@/components/veiculos/checklist-diario");
    const sp = (q: string) => new URLSearchParams(q);
    expect(periodoDiario(sp(""), "2026-11-28")).toEqual({ de: "2026-11-22", ate: "2026-11-28" });
    expect(periodoDiario(sp("de=2026-11-01&ate=2026-11-10"), "2026-11-28")).toEqual({ de: "2026-11-01", ate: "2026-11-10" });
    expect(periodoDiario(sp("de=2026-11-10&ate=2026-11-01"), "2026-11-28")).toEqual({ de: "2026-11-01", ate: "2026-11-10" });
    expect(periodoDiario(sp("de=ontem&ate=2026-11-10"), "2026-11-28")).toEqual({ de: "2026-11-04", ate: "2026-11-10" });
  });
  it("Checklists preenchidos: busca e 'Só com alertas'", async () => {
    const { filtrarChecklists } = await import("@/components/veiculos/checklists-preenchidos");
    const c = (id: string, status: string, placa: string) => ({ id, status, veiculo: { placa, modelo: "Fiorino" }, colaborador: { nome: "João" }, template: { nome: "Diário" } });
    const lista = [c("a", "CONCLUIDO", "FRV1A01"), c("b", "COM_ALERTAS", "FRV1A02"), c("c", "COM_ALERTAS", "XYZ9Z99")];
    expect(filtrarChecklists(lista, "", true).map((x) => x.id)).toEqual(["b", "c"]);
    expect(filtrarChecklists(lista, "frv", true).map((x) => x.id)).toEqual(["b"]);
    expect(filtrarChecklists(lista, " frv ", false).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("15. o sino leva ao item", () => {
  it("1 → o registro; mais de um → a lista já filtrada pelo aviso; 1 sem id → a lista", () => {
    expect(hrefDocumentosVencendo(1, "v1")).toBe("/veiculos/v1/editar?aba=documentos");
    expect(hrefDocumentosVencendo(3, "v1")).toBe("/veiculos?aviso=documentos&status=todos");
    expect(hrefDocumentosVencendo(1, null)).toBe("/veiculos?aviso=documentos&status=todos");
    expect(hrefChecklistsComAlertas(1, "v2")).toBe("/veiculos/v2/editar?aba=checklists");
    expect(hrefChecklistsComAlertas(2, "v2")).toBe("/veiculos/checklist?aba=preenchidos&alertas=1");
    expect(hrefLeadsSite(1, "o9")).toBe("/orcamentos/o9");
    expect(hrefLeadsSite(4, "o9")).toBe("/leads-site?status=novos");
    expect(umOuLista(0, "x", (id) => `/r/${id}`, "/l")).toBe("/l");
  });
  it("o filtro da frota `documentos` (o que o sino conta) existe na URL: vencido OU vencendo", () => {
    expect(lerFiltrosVeiculos({ aviso: "documentos" }).aviso).toBe("documentos");
    const w = whereAviso("documentos", new Date("2026-11-28T15:00:00Z")) as any;
    expect(w.OR).toHaveLength(2);
    expect(w.OR[0].documentos.some.dataVencimento.lt).toBeInstanceOf(Date);
    expect(w.OR[0].documentos.some.dataVencimento.gte).toBeUndefined(); // o vencido também entra
  });
  it("o 'lido' volta a contar quando chega outro registro (o id entra na assinatura)", () => {
    expect(AVISOS_DO_NUMERO.checklistsComAlertas).toBe("checklistAlertaId");
    expect(AVISOS_DO_NUMERO.documentosVencendo).toBe("documentoVencendoVeiculoId");
    expect(AVISOS_DO_NUMERO.leadsSite).toBe("leadSiteId");
    expect(assinaturaDoAviso({ leadsSite: 1, leadSiteId: "o1" }, "leadsSite")).not.toBe(assinaturaDoAviso({ leadsSite: 1, leadSiteId: "o2" }, "leadsSite"));
  });
  it("o sino usa os destinos (e a ficha do veículo abre na aba pedida)", () => {
    const h = fonte("components/layout/header.tsx");
    expect(h).toContain("hrefDocumentosVencendo(alertas?.documentosVencendo, alertas?.documentoVencendoVeiculoId)");
    expect(h).toContain("hrefChecklistsComAlertas(alertas?.checklistsComAlertas, alertas?.checklistAlertaVeiculoId)");
    expect(h).toContain("hrefLeadsSite(alertas?.leadsSite, alertas?.leadSiteId)");
    expect(fonte("app/(dashboard)/veiculos/[id]/editar/page.tsx")).toContain("<VeiculoForm abaInicial={aba}");
    expect(fonte("app/(dashboard)/leads-site/page.tsx")).toContain('{ key: "novos", label: "Novos em 24h", status: null }');
  });
});
