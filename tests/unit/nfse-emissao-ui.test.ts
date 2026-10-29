// @vitest-environment happy-dom
/**
 * NFS-e PR3 — tela: o card "Notas fiscais (NFS-e)" (medição e OS) e o modal "Emitir NFS-e", num DOM
 * de verdade:
 *  - cada nota com status, nº + código de verificação e PDF/XML (só autorizada), motivo da rejeição
 *    com o convite a reemitir, "Atualizar status" enquanto processa, Homologação, conta a receber;
 *  - o botão só com Financeiro › Fiscal; OS sem medição explica o caminho;
 *  - o modal: ambiente, tomador, o que falta (com o link), item sem serviço → escolher o serviço,
 *    "vão sair N notas" (uma por código), discriminação editável com o limite, o envio e o 409;
 *  - a tela consulta sozinha enquanto alguma nota processa; a OS abre a emissão com origem OS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/x", useSearchParams: () => new URLSearchParams(),
}));

const FISCAL = montarPermissoes({ financeiro: ["visualizar", "medicoes", "fiscal"] });
const base = {
  ambiente: "HOMOLOGACAO", codigoLc116: "14.01", codigoTributacao: "140101", aliquotaIss: 5, issRetido: false, valorServicos: 400, valorDesconto: 40,
  discriminacao: "x", protocolo: "p-1", numero: null, codigoVerificacao: null, autorizadaEm: null, motivo: null, criadoEm: "2026-10-29T13:00:00Z",
  medicao: { id: "m1", numero: "MED-2026-0012" }, contaReceber: { id: "cr1", numero: "CR-0001" }, emitidaPor: { nome: "Ana" },
  itens: [{ descricao: "Higienização", valorTotal: 300 }, { descricao: "Manutenção", valorTotal: 100 }],
  eventos: [{ tipo: "ENVIO", status: "PROCESSANDO", mensagem: "Enviada ao PlugNotas (Homologação (testes)) · protocolo p-1.", criadoEm: "2026-10-29T13:00:00Z", usuario: { nome: "Ana" } }],
};
const AUTORIZADA = { ...base, id: "n1", status: "CONCLUIDO", statusLabel: "Autorizada", numero: "1001", codigoVerificacao: "AB12-CD34" };
const REJEITADA = { ...base, id: "n2", status: "REJEITADO", statusLabel: "Rejeitada", codigoTributacao: "140601", codigoLc116: "14.06", valorDesconto: 0, valorServicos: 600, motivo: "Código de tributação inválido para o município" };
const PROCESSANDO = { ...base, id: "n3", status: "PROCESSANDO", statusLabel: "Processando na prefeitura", contaReceber: null };

const PREVIA = {
  medicao: { id: "m1", numero: "MED-2026-0012", status: "PC_RECEBIDO" }, ambiente: "HOMOLOGACAO", ambienteLabel: "Homologação (testes)",
  tomador: { nome: "Condomínio Jardim", cpfCnpj: "11222333000181" }, pendencias: [], itensSemServico: [], jaEmNota: 0, produtos: { quantidade: 1, valor: 100 },
  grupos: [
    { chave: "g1", rotulo: "Código 140101 (LC 116 14.01)", codigoLc116: "14.01", codigoTributacao: "140101", aliquota: 5, retido: false, valorServicos: 400, valorDesconto: 40, discriminacao: "Higienização | Ref.: Medição MED-2026-0012",
      itens: [{ id: "i1", descricao: "Higienização", quantidade: 2, valorTotal: 300, desconto: 30 }, { id: "i3", descricao: "Manutenção", quantidade: 1, valorTotal: 100, desconto: 10 }] },
    { chave: "g2", rotulo: "Código 140601 (LC 116 14.06)", codigoLc116: "14.06", codigoTributacao: "140601", aliquota: 2.5, retido: true, valorServicos: 600, valorDesconto: 0, discriminacao: "Instalação",
      itens: [{ id: "i2", descricao: "Instalação", quantidade: 1, valorTotal: 600, desconto: 0 }] },
  ],
};

let root: Root;
let caixa: HTMLDivElement;
let lista: any;
let previa: any;
let postEmitir: { status: number; corpo: any };
let enviados: { url: string; corpo: any }[];
beforeEach(() => {
  lista = { medicaoId: "m1", podeEmitir: true, notas: [AUTORIZADA, REJEITADA, PROCESSANDO] };
  previa = structuredClone(PREVIA);
  postEmitir = { status: 201, corpo: { notas: [] } };
  enviados = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, "http://localhost");
    const json = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
    if (init?.method === "POST") {
      enviados.push({ url: u.pathname, corpo: init.body ? JSON.parse(String(init.body)) : null });
      if (u.pathname === "/api/fiscal/notas") return json(postEmitir.status, postEmitir.corpo);
      return json(200, { ok: true });
    }
    if (u.pathname === "/api/cadastros/servicos") return json(200, [{ id: "sMan", nome: "Manutenção", codigo: "MAN", ativo: true }]);
    if (u.pathname === "/api/fiscal/notas") return json(200, u.searchParams.get("previa") === "1" ? { ...lista, previa } : lista);
    return json(404, {});
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ""; });

const esperar = () => act(async () => {
  // com relógio falso (teste da consulta automática), andar 0 ms resolve as promessas pendentes
  for (let i = 0; i < 10; i++) await (vi.isFakeTimers() ? vi.advanceTimersByTimeAsync(0) : new Promise((r) => setTimeout(r, 0)));
});
const texto = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
async function clicar(el: Element | null | undefined) { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); }
async function digitar(el: HTMLElement, v: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
  await esperar();
}
const nota = (id: string) => document.querySelector(`[data-nota="${id}"]`) as HTMLElement;
const modal = () => document.querySelector("[data-emitir-nfse]") as HTMLElement | null;
const confirmar = () => document.querySelector('[data-acao="confirmar-emissao"]') as HTMLButtonElement;

async function montar(props: Record<string, unknown> = { medicaoId: "m1", origem: "MEDICAO" }, componente: "NotasFiscais" | "OsFinanceiro" = "NotasFiscais", permissoes = FISCAL) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const mod = componente === "NotasFiscais" ? await import("@/components/fiscal/nfse-notas") : await import("@/components/os/os-financeiro");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement((mod as any)[componente], props) })); });
  await esperar();
}
const abrirModal = async () => { await montar(); await clicar(document.querySelector('[data-acao="emitir-nfse"]')); };

describe("as notas da medição", () => {
  it("autorizada: nº, código de verificação, PDF/XML pelo nosso servidor; valor com desconto; Homologação; conta a receber", async () => {
    await montar();
    const n = nota("n1");
    expect(texto(n.querySelector("p"))).toBe("Código 140101 (LC 116 14.01)AutorizadaHomologação");
    expect(texto(n.querySelector("[data-autorizada]"))).toContain("NFS-e nº 1001Código de verificação AB12-CD34");
    expect((n.querySelector('[data-baixar="pdf"]') as HTMLAnchorElement).getAttribute("href")).toBe("/api/fiscal/notas/n1/arquivo?tipo=pdf");
    expect((n.querySelector('[data-baixar="xml"]') as HTMLAnchorElement).getAttribute("href")).toBe("/api/fiscal/notas/n1/arquivo?tipo=xml");
    expect(texto(n)).toContain("R$ 360,00");
    expect(texto(n)).toContain("serviços R$ 400,00 − desconto R$ 40,00");
    expect((n.querySelector('a[href^="/financeiro/contas-receber"]') as HTMLAnchorElement).getAttribute("href")).toBe("/financeiro/contas-receber?q=CR-0001");
    expect(n.querySelector('[data-acao="atualizar-status"]')).toBeNull();
    expect(n.querySelector("[data-motivo]")).toBeNull();
    // itens e histórico
    expect(texto(n.querySelector("[data-historico]"))).toContain("Higienização");
    expect(texto(n.querySelector("[data-historico]"))).toContain("Ana — Enviada ao PlugNotas (Homologação (testes)) · protocolo p-1.");
  });

  it("rejeitada: o motivo e o convite a corrigir e emitir de novo; sem PDF", async () => {
    await montar();
    const n = nota("n2");
    expect(n.getAttribute("data-status")).toBe("REJEITADO");
    expect(texto(n.querySelector("[data-motivo]"))).toBe("Código de tributação inválido para o municípioCorrija o que a prefeitura apontou e use “Emitir NFS-e” de novo: estes serviços voltaram a ficar livres.");
    expect(n.querySelector("[data-motivo]")!.getAttribute("role")).toBe("alert");
    expect(n.querySelector("[data-baixar]")).toBeNull();
    expect(texto(n)).toContain("Código 140601 (LC 116 14.06)");
  });

  it("processando: 'Atualizar status' consulta o PlugNotas e recarrega", async () => {
    await montar();
    const antes = (fetch as any).mock.calls.length;
    lista = { ...lista, notas: [AUTORIZADA, REJEITADA, { ...PROCESSANDO, status: "CONCLUIDO", statusLabel: "Autorizada", numero: "1003" }] };
    // processando: sem nº, sem PDF/XML e sem motivo
    expect(nota("n3").querySelector("[data-autorizada]")).toBeNull();
    expect(nota("n3").querySelector("[data-baixar]")).toBeNull();
    expect(nota("n3").querySelector("[data-motivo]")).toBeNull();
    await clicar(nota("n3").querySelector('[data-acao="atualizar-status"]'));
    expect(enviados.at(-1)).toEqual({ url: "/api/fiscal/notas/n3/consultar", corpo: null });
    expect((fetch as any).mock.calls.length - antes).toBe(2);
    expect(nota("n3").getAttribute("data-status")).toBe("CONCLUIDO");
    expect(texto(nota("n3"))).toContain("NFS-e nº 1003");
  });

  it("enquanto alguma nota processa, a tela consulta sozinha (a cada 6 s); resolvida, para", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await montar();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_900); });
    expect(enviados).toEqual([]);
    lista = { ...lista, notas: [AUTORIZADA, { ...PROCESSANDO, status: "CONCLUIDO", statusLabel: "Autorizada", numero: "1003" }] };
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await esperar();
    expect(enviados.map((e) => e.url)).toEqual(["/api/fiscal/notas/n3/consultar"]);
    expect(nota("n3").getAttribute("data-status")).toBe("CONCLUIDO");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(enviados).toHaveLength(1);
  });

  it("consulta sozinha por no máximo ~3 min (30 rodadas); depois avisa para usar o botão", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await montar();
    for (let i = 0; i < 31; i++) { await act(async () => { await vi.advanceTimersByTimeAsync(6_000); }); await esperar(); }
    expect(enviados).toHaveLength(30);
    expect(texto(document.querySelector("[data-nfse-notas]"))).toContain("A prefeitura ainda está processando. Use “Atualizar status” daqui a pouco.");
    // o botão volta a contar do zero
    await clicar(nota("n3").querySelector('[data-acao="atualizar-status"]'));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await esperar();
    expect(enviados).toHaveLength(32);
  });

  it("sem Financeiro › Fiscal: sem o botão e sem o convite a reemitir", async () => {
    lista = { ...lista, podeEmitir: false };
    await montar();
    expect(document.querySelector('[data-acao="emitir-nfse"]')).toBeNull();
    expect(texto(nota("n2").querySelector("[data-motivo]"))).toBe("Código de tributação inválido para o município");
  });

  it("OS ainda sem medição: explica que a nota sai da medição; sem botão", async () => {
    lista = { medicaoId: null, podeEmitir: true, notas: [] };
    await montar({ osId: "os1", origem: "OS" });
    expect((fetch as any).mock.calls[0][0]).toBe("/api/fiscal/notas?osId=os1");
    expect(texto(document.querySelector("[data-sem-medicao]"))).toBe("A NFS-e sai da medição (o documento de cobrança). Gere a medição desta OS e aprove-a para emitir a nota.");
    expect(document.querySelector('[data-acao="emitir-nfse"]')).toBeNull();
  });

  it("erro ao carregar (ou resposta sem a lista): mostra a mensagem, não quebra a tela", async () => {
    lista = { erro: "Sem permissão para esta ação" } as any;
    await montar();
    expect(texto(caixa)).toBe("Sem permissão para esta ação");
    act(() => root.unmount()); caixa.remove();
    lista = {} as any;
    await montar();
    expect(texto(caixa)).toBe("Não foi possível carregar as notas.");
  });

  it("medição sem notas: avisa", async () => {
    lista = { ...lista, notas: [] };
    await montar();
    expect(texto(document.querySelector("[data-nfse-notas]"))).toContain("Nenhuma nota emitida ainda.");
  });
});

describe("o modal Emitir NFS-e", () => {
  it("homologação, tomador, 'vão sair 2 notas', cada nota com código, itens, valor, ISS e a discriminação", async () => {
    await abrirModal();
    expect(texto(document.querySelector('[role="dialog"] h3'))).toBe("Emitir NFS-e — medição MED-2026-0012");
    expect(texto(modal()!.querySelector("[data-ambiente]"))).toBe("Homologação (testes): a nota vai para o ambiente de testes do PlugNotas e não tem valor fiscal.");
    expect(texto(modal())).toContain("Tomador: Condomínio Jardim · 11.222.333/0001-81");
    expect(texto(modal()!.querySelector("[data-varias-notas]"))).toBe("Vão sair 2 notas, uma por código de serviço: a prefeitura não aceita códigos diferentes (nem regras de ISS diferentes) na mesma nota.");
    const g = [...modal()!.querySelectorAll("[data-grupo]")];
    expect(g.map((x) => x.getAttribute("data-grupo"))).toEqual(["140101", "140601"]);
    expect(texto(g[0].querySelector("p"))).toBe("Nota 1 de 2 — Código 140101 (LC 116 14.01)");
    expect(texto(g[0])).toContain("R$ 360,00 (R$ 400,00 − desconto R$ 40,00)");
    expect(texto(g[1])).toContain("ISS 2,5% · retido pelo tomador");
    expect((g[0].querySelector("textarea") as HTMLTextAreaElement).value).toBe("Higienização | Ref.: Medição MED-2026-0012");
    expect(texto(modal())).toContain("Produtos (R$ 100,00) não entram na NFS-e.");
    expect(texto(confirmar())).toBe("Emitir 2 notas (homologação)");
    expect(confirmar().disabled).toBe(false);
  });

  it("uma nota só: sem o aviso de várias; texto do botão no singular", async () => {
    previa.grupos = [previa.grupos[0]];
    previa.produtos = { quantidade: 0, valor: 0 };
    previa.jaEmNota = 2;
    await abrirModal();
    expect(modal()!.querySelector("[data-varias-notas]")).toBeNull();
    expect(texto(modal()!.querySelector("[data-grupo] p"))).toBe("Código 140101 (LC 116 14.01)");
    expect(texto(confirmar())).toBe("Emitir a nota (homologação)");
    expect(texto(modal())).toContain("2 itens já estão em nota emitida ou em processamento.");
    expect(texto(modal())).not.toContain("Produtos");
  });

  it("emitir: manda a discriminação ajustada de cada nota e a origem; fecha e recarrega a lista", async () => {
    await abrirModal();
    await digitar(modal()!.querySelector('[data-discriminacao="g2"]') as HTMLTextAreaElement, "Instalação de split | conforme proposta");
    await clicar(confirmar());
    expect(enviados.at(-1)).toEqual({ url: "/api/fiscal/notas", corpo: {
      medicaoId: "m1", origem: "MEDICAO", ordemServicoId: null,
      discriminacoes: { g1: "Higienização | Ref.: Medição MED-2026-0012", g2: "Instalação de split | conforme proposta" },
    } });
    expect(modal()).toBeNull();
  });

  it("discriminação vazia ou acima de 2000: contador em vermelho e botão travado", async () => {
    await abrirModal();
    const t = modal()!.querySelector('[data-discriminacao="g1"]') as HTMLTextAreaElement;
    await digitar(t, "   ");
    expect(confirmar().disabled).toBe(true);
    expect(t.parentElement!.querySelector("span:last-child")!.className).toContain("text-atrasado-texto");
    await digitar(t, "x".repeat(2001));
    expect(texto(t.parentElement!.querySelector("span:last-child"))).toBe("2001/2000");
    expect(confirmar().disabled).toBe(true);
    await digitar(t, "x".repeat(2000));
    expect(confirmar().disabled).toBe(false);
  });

  it("o que falta: lista com o link para corrigir; item sem serviço → escolher o serviço liga e recarrega", async () => {
    previa.pendencias = [
      { area: "tomador", texto: "Endereço do cliente: CEP.", link: "/clientes/c1/editar", rotuloLink: "Editar o cliente" },
      { area: "item", itemId: "i9", texto: "Item “Visita”: escolha o serviço do catálogo (de onde vêm os dados fiscais)." },
      { area: "emitente", texto: "A integração com o PlugNotas não está configurada neste servidor (falta o token). Avise o suporte." },
    ];
    previa.itensSemServico = [{ id: "i9", descricao: "Visita", valorTotal: 80 }];
    await abrirModal();
    const p = modal()!.querySelector("[data-pendencias]")!;
    expect([...p.querySelectorAll("[data-pendencia]")].map((li) => [li.getAttribute("data-pendencia"), texto(li)])).toEqual([
      ["tomador", "• Endereço do cliente: CEP.Editar o cliente"],
      ["emitente", "• A integração com o PlugNotas não está configurada neste servidor (falta o token). Avise o suporte."],
    ]);
    expect((p.querySelector('a[href="/clientes/c1/editar"]') as HTMLAnchorElement).target).toBe("_blank");
    expect(confirmar().disabled).toBe(true);
    const sel = p.querySelector('[data-item-sem-servico="i9"] select') as HTMLSelectElement;
    expect(texto(p.querySelector('[data-item-sem-servico="i9"]'))).toContain("Visita · R$ 80,00");
    previa.pendencias = []; previa.itensSemServico = [];
    await digitar(sel, "sMan");
    expect(enviados.at(-1)).toEqual({ url: "/api/fiscal/notas/vincular-servico", corpo: { medicaoId: "m1", itemId: "i9", servicoId: "sMan" } });
    expect(modal()!.querySelector("[data-pendencias]")).toBeNull();
    expect(confirmar().disabled).toBe(false);
  });

  it("409 com o que falta (mudou entre a prévia e o envio): mostra a mensagem e a lista; o modal fica", async () => {
    postEmitir = { status: 409, corpo: { erro: "Falta corrigir alguns dados antes de emitir.", pendencias: [{ area: "medicao", texto: "A medição MED-2026-0012 está cancelada.", link: "/financeiro/medicoes/m1", rotuloLink: "Abrir a medição" }] } };
    await abrirModal();
    await clicar(confirmar());
    expect(texto(modal()!.querySelector('[role="alert"]'))).toBe("Falta corrigir alguns dados antes de emitir.");
    expect(texto(modal()!.querySelector("[data-pendencias]"))).toContain("A medição MED-2026-0012 está cancelada.");
    expect(confirmar().disabled).toBe(true);
  });

  it("nada a emitir: avisa e trava", async () => {
    previa.grupos = [];
    await abrirModal();
    expect(texto(modal())).toContain("Nada a emitir: os serviços desta medição já estão em notas.");
    expect(confirmar().disabled).toBe(true);
  });

  it("Produção: o aviso muda e o botão não diz homologação", async () => {
    previa.ambiente = "PRODUCAO"; previa.ambienteLabel = "Produção";
    await abrirModal();
    expect(texto(modal()!.querySelector("[data-ambiente]"))).toBe("Produção: a nota vale de verdade.");
    expect(texto(confirmar())).toBe("Emitir 2 notas");
  });
});

describe("pela central de notas (Corrigir e reemitir → ?nfse=emitir)", () => {
  it("a medição abre a emissão UMA vez: depois de emitir, a lista recarrega e o modal não volta", async () => {
    await montar({ medicaoId: "m1", origem: "MEDICAO", abrirEmissao: true });
    expect(modal()).toBeTruthy();
    await clicar(confirmar());
    expect(enviados.at(-1)!.corpo).toMatchObject({ medicaoId: "m1", origem: "MEDICAO" });
    expect(modal()).toBeNull();
    const listagens = (fetch as any).mock.calls.filter((c: any[]) => String(c[0]) === "/api/fiscal/notas?medicaoId=m1").length;
    expect(listagens).toBeGreaterThanOrEqual(2); // recarregou depois de emitir…
    expect(modal()).toBeNull(); // …e não reabriu
  });

  it("sem permissão de emitir, não abre (só a lista)", async () => {
    lista = { ...lista, podeEmitir: false };
    await montar({ medicaoId: "m1", origem: "MEDICAO", abrirEmissao: true });
    expect(modal()).toBeNull();
    expect(document.querySelector("[data-nfse-notas]")).toBeTruthy();
  });
});

describe("pela OS", () => {
  it("o botão do cabeçalho abre a emissão já na aba Financeiro, com origem OS e a OS no envio", async () => {
    const aoAbrir = vi.fn();
    await montar({ osId: "os1", medicoes: [], itensOrcamento: [], abrirNfse: true, onAbriuNfse: aoAbrir }, "OsFinanceiro");
    expect(aoAbrir).toHaveBeenCalledTimes(1);
    expect(modal()).toBeTruthy();
    await clicar(confirmar());
    expect(enviados.at(-1)!.corpo).toMatchObject({ medicaoId: "m1", origem: "OS", ordemServicoId: "os1" });
  });

  it("na OS, quem não vê Medições nem o Fiscal não vê o bloco de notas (nem chama a API); Medições basta para ver", async () => {
    await montar({ osId: "os1", medicoes: [], itensOrcamento: [] }, "OsFinanceiro", montarPermissoes({ ordens: ["visualizar"] }));
    expect(document.querySelector("[data-nfse-notas]")).toBeNull();
    expect((fetch as any).mock.calls.filter((c: any[]) => String(c[0]).startsWith("/api/fiscal"))).toEqual([]);
    act(() => root.unmount()); caixa.remove();
    lista = { ...lista, podeEmitir: false };
    await montar({ osId: "os1", medicoes: [], itensOrcamento: [] }, "OsFinanceiro", montarPermissoes({ financeiro: ["visualizar", "medicoes"] }));
    expect(document.querySelector("[data-nfse-notas]")).toBeTruthy();
  });

  it("sem pedir: o modal não abre sozinho", async () => {
    await montar({ osId: "os1", medicoes: [], itensOrcamento: [] }, "OsFinanceiro");
    expect(modal()).toBeNull();
    expect(document.querySelector('[data-acao="emitir-nfse"]')).toBeTruthy();
  });
});
