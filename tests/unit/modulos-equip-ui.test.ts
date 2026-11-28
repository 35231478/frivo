// @vitest-environment happy-dom
/**
 * Loja de Módulos — leva EQUIPAMENTOS + QR CODES, as telas num DOM de verdade. O que se prova é o
 * mesmo PADRÃO DOS CAMPOS-PONTE das levas anteriores:
 *
 *   o campo que pertence a um módulo DESLIGADO some da tela do núcleo — em vez de ficar órfão,
 *   vazio, oferecendo um cadastro que aquela empresa não tem; e o que JÁ ESTÁ GRAVADO fica.
 *
 *  - Equipamentos desligado: some o vínculo na atividade da OS (adicionar, lista da unidade) e o
 *    "Escolher da lista" na execução — e o equipamento JÁ vinculado continua na tela;
 *  - QR Codes desligado: somem "Ler QR Code", "Gerar QR", "Etiqueta QR", a aba QR Code, o filtro e
 *    o atalho "Sem QR" da lista, a ação em massa e o KPI do dashboard — e o CÓDIGO do QR que o
 *    equipamento já tem continua à vista;
 *  - o menu perde Equipamentos e QR Codes e mantém o núcleo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ModulosProvider } from "@/components/providers/modulos-provider";
import { permissoesTotais } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 }); // tela larga: o menu lateral abre (Leva I: < 1280 px começa recolhido)
vi.mock("next-auth/react", () => ({ signOut: () => {}, useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/ordens/os1", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-auto-geocode", () => ({ useAutoGeocode: () => {} }));
vi.mock("@/components/ui/avisos", async (original) => ({
  ...(await original<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true),
}));

let raiz: Root;
let caixa: HTMLDivElement;

const RESPOSTAS: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(RESPOSTAS)) delete RESPOSTAS[k];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const chave = Object.keys(RESPOSTAS).find((k) => String(url).startsWith(k));
    const corpo = chave ? RESPOSTAS[chave] : [];
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => raiz?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const tela = () => txt(document.body);

/** Monta com os dois providers da casa: o que o usuário PODE e o que a empresa TEM. */
async function montar(el: ReactElement, desligados: string[] = []) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa); raiz = createRoot(caixa);
  await act(async () => {
    raiz.render(createElement(PermissoesProvider, { role: "ADMIN", permissoes: permissoesTotais(),
      children: createElement(ModulosProvider as any, { desligados }, el) }));
  });
  await esperar();
}
const remontar = async (el: ReactElement, desligados: string[]) => {
  act(() => raiz.unmount()); caixa.remove();
  await montar(el, desligados);
};

/* ═════════ a atividade da OS: o vínculo some, o vinculado fica ═════════ */

describe("Equipamentos desligado na OS: some o VÍNCULO, fica o que já está vinculado", () => {
  const EQUIP = (id: string, titulo: string) => ({
    vinculoId: `v-${id}`, feito: true, observacao: null,
    equipamento: { id, titulo, descricao: "", fabricante: "Carrier", tag: "QR-10001", numeroSerie: "SN-1", local: "UTI", unidade: "Bloco A", ativo: true, tipo: { id: "tp1", nome: "Split" } },
    itens: [], respostas: {}, fotos: [], formulario: null,
    faltas: { semResposta: [], semFoto: [], semObservacao: [], formulario: null }, completo: true,
  });
  const execucao = (equipamentos: unknown[]) => ({
    bloqueada: false, equipamentos,
    conclusao: { ok: true, semEquipamento: false, dispensa: null, pendencias: [], atendidos: equipamentos.length, naoAtendidos: 0, mensagem: null },
  });

  it("COM o módulo: 'Adicionar' está lá e abre a lista da unidade", async () => {
    RESPOSTAS["/api/ordens/os1/atividades/a1/execucao"] = execucao([EQUIP("eq1", "Split Carrier 42XQ")]);
    const { AtividadeEquipamentos } = await import("@/components/os/atividade-equipamentos");
    await montar(createElement(AtividadeEquipamentos as any, { osId: "os1", atividadeId: "a1", clienteId: "c1", unidadeId: "u1" }), []);
    expect($("[data-adicionar-equipamento]")).toBeTruthy();
    expect($('[data-equipamento-vinculado="eq1"]')).toBeTruthy();
  });

  it("SEM o módulo: 'Adicionar' some — e o equipamento já vinculado continua, com checklist e fotos", async () => {
    RESPOSTAS["/api/ordens/os1/atividades/a1/execucao"] = execucao([EQUIP("eq1", "Split Carrier 42XQ")]);
    const { AtividadeEquipamentos } = await import("@/components/os/atividade-equipamentos");
    const el = createElement(AtividadeEquipamentos as any, { osId: "os1", atividadeId: "a1", clienteId: "c1", unidadeId: "u1" });
    await montar(el, []);
    await remontar(el, ["equipamentos", "qrcodes"]);
    expect($("[data-adicionar-equipamento]")).toBeNull();
    // razão é razão: o que a OS antiga tem continua à vista
    expect($('[data-equipamento-vinculado="eq1"]')).toBeTruthy();
    expect(tela()).toContain("Split Carrier 42XQ");
    expect(tela()).toContain("Equipamentos atendidos");
  });

  it("SEM o módulo e SEM nada vinculado: o bloco inteiro some (nada de título órfão nem de aviso)", async () => {
    RESPOSTAS["/api/ordens/os1/atividades/a1/execucao"] = execucao([]);
    const { AtividadeEquipamentos } = await import("@/components/os/atividade-equipamentos");
    const el = createElement(AtividadeEquipamentos as any, { osId: "os1", atividadeId: "a1", clienteId: "c1", unidadeId: "u1" });
    await montar(el, []);
    expect($("[data-sem-equipamento]")).toBeTruthy(); // com o módulo, o aviso orienta a vincular

    await remontar(el, ["equipamentos", "qrcodes"]);
    expect($("[data-atividade-equipamentos]")).toBeNull();
    expect(tela()).not.toContain("Equipamentos atendidos");
  });
});

/* ═════════ a execução da OS: dois botões, dois módulos ═════════ */

describe("Execução da OS: 'Ler QR Code' é do QR, 'Escolher da lista' é do Equipamentos", () => {
  const exec = {
    atividade: { id: "a1", titulo: "Visita", status: "EM_ANDAMENTO", tipoOs: null },
    os: { id: "os1", numero: "OS-1001", status: "EM_ANDAMENTO", clienteId: "c1", unidadeId: "u1" },
    equipamentos: [], adicionais: [], visitas: [], materiais: [],
    conclusao: { ok: true, semEquipamento: false, dispensa: { motivo: "MODULO", texto: "A empresa não usa o módulo Equipamentos: pode concluir sem equipamento atendido." }, pendencias: [], atendidos: 0, naoAtendidos: 0, mensagem: null },
    dispensaEquipamento: null,
  };
  const props = { osId: "os1", atividadeId: "a1", titulo: "Visita", osNumero: "OS-1001", tipoOs: null };

  it("tudo ligado: os dois botões aparecem", async () => {
    RESPOSTAS["/api/ordens/os1/atividades/a1/execucao"] = exec;
    const { AtividadeExecucao } = await import("@/components/os/atividade-execucao");
    await montar(createElement(AtividadeExecucao as any, props), []);
    expect($("[data-ler-qr]")).toBeTruthy();
    expect($("[data-escolher-lista]")).toBeTruthy();
  });

  it("só QR Codes desligado: some o 'Ler QR Code' e FICA o 'Escolher da lista'", async () => {
    RESPOSTAS["/api/ordens/os1/atividades/a1/execucao"] = exec;
    const { AtividadeExecucao } = await import("@/components/os/atividade-execucao");
    const el = createElement(AtividadeExecucao as any, props);
    await montar(el, []);
    await remontar(el, ["qrcodes"]);
    expect($("[data-ler-qr]")).toBeNull();
    expect($("[data-escolher-lista]")).toBeTruthy();
  });

  it("só Equipamentos desligado: some o 'Escolher da lista' e FICA o 'Ler QR Code'", async () => {
    // Na prática a cascata derruba os dois juntos; aqui se prova a regra PRÓPRIA do componente —
    // cada botão olha o SEU módulo, e não o do vizinho.
    RESPOSTAS["/api/ordens/os1/atividades/a1/execucao"] = exec;
    const { AtividadeExecucao } = await import("@/components/os/atividade-execucao");
    const el = createElement(AtividadeExecucao as any, props);
    await montar(el, []);
    await remontar(el, ["equipamentos"]);
    expect($("[data-escolher-lista]")).toBeNull();
    expect($("[data-ler-qr]")).toBeTruthy();
  });

  it("Equipamentos desligado (QR cai junto): somem os dois, e a tela diz por que dá para concluir", async () => {
    RESPOSTAS["/api/ordens/os1/atividades/a1/execucao"] = exec;
    const { AtividadeExecucao } = await import("@/components/os/atividade-execucao");
    const el = createElement(AtividadeExecucao as any, props);
    await montar(el, []);
    await remontar(el, ["equipamentos", "qrcodes"]);
    expect($("[data-ler-qr]")).toBeNull();
    expect($("[data-escolher-lista]")).toBeNull();
    expect($('[data-dispensa-equipamento="MODULO"]')).toBeTruthy();
    expect(tela()).toContain("não usa o módulo Equipamentos");
    expect($("[data-concluir]")).toBeTruthy(); // concluir é do núcleo e continua
  });
});

/* ═════════ a ficha do equipamento: os botões de QR ═════════ */

describe("QR Codes desligado na ficha: somem os botões, fica o código já gravado", () => {
  const equipamento = {
    id: "eq1", nome: "Split da UTI", marca: "Carrier", modelo: "42XQ", numeroSerie: "SN-001",
    tipo: "AR_CONDICIONADO_SPLIT", ativo: true, fotos: [], garantiaAte: null, setor: "UTI", localizacao: "2º andar",
    capacidade: null, fluido: null, tensao: null, potencia: null, fase: null, correnteNominal: null,
    patrimonio: null, anoFabricacao: null, dataInstalacao: null, dataFabricacao: null, garantiaInicio: null,
    observacoes: null, observacoesTecnicas: null, atualizadoEm: "2026-11-01T12:00:00.000Z",
    qrcode: { id: "qr1", codigo: "QR-10001", ativo: true },
    unidade: { id: "u1", nome: "Bloco A", cidade: "Recife", cliente: { id: "c1", nome: "Hospital Santa Luzia", nomeFantasia: null } },
  };
  const props = {
    equipamento, tipoNome: "Split", historico: [], linhaDoTempo: [],
    indicadores: { ultimoAtendimento: null, proxima: null, totalAtendimentos: 0 },
  };

  it("COM o módulo: 'Etiqueta QR' e o atalho da aba QR Code estão na ficha", async () => {
    const { EquipamentoPerfil } = await import("@/components/equipamentos/equipamento-perfil");
    await montar(createElement(EquipamentoPerfil as any, props), []);
    expect(tela()).toContain("Etiqueta QR");
    expect(tela()).toContain("QR-10001");
  });

  it("SEM o módulo: nenhum botão de QR — e o código da etiqueta já colada continua à vista", async () => {
    const { EquipamentoPerfil } = await import("@/components/equipamentos/equipamento-perfil");
    const el = createElement(EquipamentoPerfil as any, props);
    await montar(el, []);
    await remontar(el, ["qrcodes"]);
    expect(tela()).not.toContain("Etiqueta QR");
    expect(tela()).not.toContain("Gerar QR");
    expect(tela()).not.toContain("Gerenciar");
    // desligar não apaga: o QR gerado continua no banco e na ficha
    expect(tela()).toContain("QR-10001");
    expect(tela()).toContain("Split da UTI"); // o resto da ficha fica
  });
});

/* ═════════ a lista de equipamentos: filtro, atalho e botão da linha ═════════ */

describe("QR Codes desligado na lista: somem o atalho 'Sem QR', o filtro e o botão da linha", () => {
  const linha = {
    id: "eq1", nome: "Split da UTI", temNome: true, marca: "Carrier", modelo: "42XQ",
    numeroSerie: "SN-001", patrimonio: null, tipo: "AR_CONDICIONADO_SPLIT", tipoLabel: "Split",
    capacidade: null, setor: "UTI", ambiente: "2º andar", garantiaAte: null, ativo: true,
    qrcodeId: "qr1", foto: null, clienteId: "c1", cliente: "Hospital Santa Luzia",
    unidadeId: "u1", unidade: "Bloco A", ultimoAtendimento: null,
  };
  const props = {
    itens: [linha], total: 1,
    filtros: { q: "", cliente: "", unidade: "", setor: "", tipos: [], status: "ativo", garantia: "", qr: "", fluido: "", ordem: "nome", dir: "asc", pagina: 1, porPagina: 50 },
    opcoes: { clientes: [], unidades: [], setores: [], fluidos: [], tipos: [] },
    resumo: { ativos: 1, vencendo: 0, vencidas: 0, semQr: 0 },
  };

  /** A lista mora dentro do provedor de seleção em massa (é ele que dá os checkboxes da página). */
  const comSelecao = async (el: ReactElement) => {
    const { SelecaoMassaProvider } = await import("@/components/acoes-massa/selecao");
    return createElement(SelecaoMassaProvider as any, { entidade: "equipamentos", idsPagina: ["eq1"], total: 1 }, el);
  };

  it("COM o módulo: o atalho 'Sem QR' e o botão de QR da linha estão lá", async () => {
    const { EquipamentosListaClient } = await import("@/app/(dashboard)/equipamentos/equipamentos-lista-client");
    await montar(await comSelecao(createElement(EquipamentosListaClient as any, props)), []);
    expect(tela()).toContain("Sem QR");
    expect($("[data-qr-equipamento]")).toBeTruthy();
    expect($("[data-editar-equipamento]")).toBeTruthy();
  });

  it("SEM o módulo: o atalho e o botão somem; editar e a lista (núcleo da tela) ficam", async () => {
    const { EquipamentosListaClient } = await import("@/app/(dashboard)/equipamentos/equipamentos-lista-client");
    const el = await comSelecao(createElement(EquipamentosListaClient as any, props));
    await montar(el, []);
    await remontar(el, ["qrcodes"]);
    expect(tela()).not.toContain("Sem QR");
    expect($("[data-qr-equipamento]")).toBeNull();
    expect($("[data-editar-equipamento]")).toBeTruthy();
    expect(tela()).toContain("Split da UTI");
  });
});

/* ═════════ a proposta de contrato ═════════ */

describe("Equipamentos desligado na proposta: 'Equipamentos cobertos' some", () => {
  const proposta: any = {
    escopoServicos: "", periodicidade: "MENSAL", visitasPorPeriodo: "", equipamentosCobertos: [],
    prazoEmergencial: "", prazoNormal: "", responsavelTecnico: "", termoTemplateId: "",
    validadeProposta: "", inicioPrevisto: "", observacoesProposta: "",
  };
  const props = {
    proposta, onChange: vi.fn(), tecnicos: [], termoTemplates: [],
    equipamentos: [{ id: "eq1", rotulo: "Split da UTI" }],
  };

  it("COM o módulo o campo aparece; SEM ele some, e o resto da proposta fica", async () => {
    const { PropostaCampos } = await import("@/components/orcamento/proposta-campos");
    const el = createElement(PropostaCampos as any, props);
    await montar(el, []);
    expect(tela()).toContain("Equipamentos cobertos");

    await remontar(el, ["equipamentos", "qrcodes"]);
    expect(tela()).not.toContain("Equipamentos cobertos");
    expect(tela()).toContain("Visitas por período"); // o resto da proposta continua
  });
});

/* ═════════ o dashboard (núcleo) ═════════ */

describe("Dashboard: o KPI 'Sem QR Code' é do módulo QR Codes", () => {
  const d = { total: 12, garantiaVencendo: 2, garantiaVigente: 7, semQr: 3 };

  it("com o módulo conta; sem ele o KPI some e o resto do bloco fica", async () => {
    const { BlocoEquipamentos } = await import("@/components/dashboard/blocos");
    await montar(createElement(BlocoEquipamentos as any, { d, temQr: true }), []);
    expect(tela()).toContain("Sem QR Code");
    expect(tela()).toContain("Cadastrados");

    await remontar(createElement(BlocoEquipamentos as any, { d, temQr: false }), ["qrcodes"]);
    expect(tela()).not.toContain("Sem QR Code");
    expect(tela()).toContain("Cadastrados");
    expect(tela()).toContain("Garantia vencendo");
  });
});

/* ═════════ as ações em massa ═════════ */

describe("Ações em massa: 'Gerar QR' só existe para quem usa o módulo QR Codes", () => {
  /** A barra só aparece com alguma linha marcada: monta o provedor, a linha e a barra. */
  async function barra(desligados: string[]) {
    const { SelecaoMassaProvider, CheckboxLinha } = await import("@/components/acoes-massa/selecao");
    const { BarraAcoesMassa } = await import("@/components/acoes-massa/barra");
    const el = createElement(SelecaoMassaProvider as any, { entidade: "equipamentos", idsPagina: ["eq1"], total: 1 },
      createElement(CheckboxLinha as any, { id: "eq1", rotulo: "Split da UTI" }),
      createElement(BarraAcoesMassa as any, {}));
    await montar(el, desligados);
    const caixaSel = $<HTMLInputElement>('[data-selecao-linha="eq1"]')!;
    await act(async () => { caixaSel.click(); });
    await esperar();
  }

  it("COM o módulo: 'Gerar QR' está entre as ações", async () => {
    await barra([]);
    expect($("[data-barra-massa]")).toBeTruthy();
    expect($('[data-acao-massa="gerar-qr"]')).toBeTruthy();
    expect($('[data-acao-massa="inativar"]')).toBeTruthy();
  });

  it("SEM o módulo: 'Gerar QR' some e as outras ações ficam", async () => {
    await barra(["qrcodes"]);
    expect($("[data-barra-massa]")).toBeTruthy();
    expect($('[data-acao-massa="gerar-qr"]')).toBeNull();
    expect($('[data-acao-massa="inativar"]')).toBeTruthy();
  });
});

/* ═════════ o menu ═════════ */

describe("O menu perde Equipamentos e QR Codes e mantém o núcleo", () => {
  const sessao = () => ({ user: { id: "u1", name: "Gabi", email: "g@x.com", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), perfilNome: "Gestor", empresaNome: "Clima Total" } }) as any;
  const botoes = () => [...document.querySelectorAll("aside button")] as HTMLButtonElement[];
  const grupos = () => botoes().filter((b) => b.hasAttribute("aria-expanded") && !b.hasAttribute("aria-haspopup"));

  /** Abre cada grupo do acordeão e junta os endereços que o menu oferece. */
  async function itens(desligados: string[]) {
    const { Sidebar } = await import("@/components/layout/sidebar");
    await montar(createElement(Sidebar as any, { session: sessao(), variant: "desktop" }), desligados);
    const achados = new Set<string>();
    const juntar = () => [...document.querySelectorAll("aside a[href]")].forEach((a) => achados.add(a.getAttribute("href")!));
    juntar();
    for (let i = 0; i < grupos().length; i++) {
      const g = grupos()[i];
      await act(async () => { g.click(); });
      juntar();
    }
    return [...achados];
  }
  const tem = (lista: string[], prefixo: string) => lista.some((h) => h === prefixo || h.startsWith(prefixo + "/"));

  it("tudo ligado: Equipamentos e QR Codes estão no menu", async () => {
    const lista = await itens([]);
    expect(tem(lista, "/equipamentos")).toBe(true);
    expect(tem(lista, "/qrcodes")).toBe(true);
  });

  it("Equipamentos desligado (e QR Codes junto, pela dependência): os dois somem; o núcleo fica", async () => {
    act(() => raiz.unmount()); caixa.remove();
    const lista = await itens(["equipamentos", "qrcodes"]);
    expect(tem(lista, "/equipamentos")).toBe(false);
    expect(tem(lista, "/qrcodes")).toBe(false);
    expect(tem(lista, "/ordens")).toBe(true);
    expect(tem(lista, "/clientes")).toBe(true);
    expect(lista).toContain("/configuracoes");
  });

  it("só QR Codes desligado: o Equipamentos continua no menu", async () => {
    act(() => raiz.unmount()); caixa.remove();
    const lista = await itens(["qrcodes"]);
    expect(tem(lista, "/qrcodes")).toBe(false);
    expect(tem(lista, "/equipamentos")).toBe(true);
  });
});
