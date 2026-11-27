// @vitest-environment happy-dom
/**
 * "Pronto pra janeiro 2" — regras puras e telas num DOM de verdade (dados fictícios):
 *  A/C — perfis e tipos de OS padrão (presets do código, "faltando" sem duplicar);
 *  B   — tela "Nova empresa" (máscara de CNPJ, envio, erro do servidor, aviso de entrega da senha);
 *  C   — "Usar modelos sugeridos" só com a lista vazia e só para quem grava tipos de OS;
 *  D   — "Cliente aprovou" (modal, validação, envio) e o texto da linha do tempo;
 *  E   — atividade sem tipo de OS não exige equipamento;
 *  F   — "Desmarcar" item executado na OS;
 *  J   — o quadro de assinatura só redimensiona quando o tamanho muda de fato;
 *  K   — nome da empresa (nome fantasia ou razão social);
 *  L   — o item da Implantação que leva a uma tela tem cara de clicável.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CORES_PERFIL, PRESETS, montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { chaveNome, faltando, perfisPadrao, PRESET_VENDAS, TIPOS_OS_PADRAO } from "@/lib/empresa/padroes";
import { aprovacaoEquipeSchema, detalheAprovacaoEquipe, PODE_APROVAR_PELA_EQUIPE } from "@/lib/orcamentos/aprovacao-equipe";
import { textoDispensa } from "@/lib/execucao/pendencias";
import { precisaRedimensionar, tamanhoInterno } from "@/lib/assinatura-quadro";
import { nomeExibidoDaEmpresa } from "@/lib/empresa/nome";
import { mascararCnpj } from "@/components/admin/empresas-admin";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh, replace: () => {}, back: () => {} }),
  usePathname: () => "/x", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true) }));
vi.mock("@/lib/modulos/servidor", () => ({ temModulo: vi.fn(async () => true), modulosDesligados: vi.fn(async () => new Set()) }));

let root: Root | null = null;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
let respostas: Record<string, (corpo: any) => [number, unknown]> = {};

beforeEach(() => {
  chamadas.length = 0;
  respostas = {};
  refresh.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url, metodo, corpo });
    const f = respostas[`${metodo} ${new URL(url, "http://localhost").pathname}`];
    const [status, json] = f ? f(corpo) : [404, { erro: "não mapeado" }];
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { if (root) act(() => root!.unmount()); root = null; caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const texto = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(sel: string, valor: string) {
  const el = $(sel) as HTMLInputElement;
  expect(el).toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function montar(el: any, permissoes: Permissoes = permissoesTotais(), role = "OPERADOR") {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root!.render(createElement(PermissoesProvider, { role, permissoes, children: el })); });
  await esperar();
}

/* ───────────── A / C: padrões ───────────── */
describe("Perfis e tipos de OS padrão (regra pura)", () => {
  it("5 perfis a partir dos presets, sem Auxiliar; Gestor = Supervisor; cópias (não a referência do preset)", () => {
    const p = perfisPadrao();
    expect(p.map((x) => `${x.nome}:${x.tipo}`)).toEqual(["Administrador:ADMINISTRADOR", "Gestor:SUPERVISOR", "Financeiro:FINANCEIRO", "Técnico:TECNICO", "Vendas:PERSONALIZADO"]);
    expect(p[1].permissoes).toEqual(PRESETS.SUPERVISOR);
    expect(p[1].permissoes).not.toBe(PRESETS.SUPERVISOR);
    expect(p.map((x) => x.cor)).toEqual([CORES_PERFIL.ADMINISTRADOR, CORES_PERFIL.SUPERVISOR, CORES_PERFIL.FINANCEIRO, CORES_PERFIL.TECNICO, CORES_PERFIL.PERSONALIZADO]);
    // Mexer na cópia não muda o preset do código
    (p[0].permissoes as any).dashboard = {};
    expect(perfisPadrao()[0].permissoes).toEqual(PRESETS.ADMINISTRADOR);
  });

  it("Vendas: clientes e orçamentos sem aprovar, contratos só ver; nada de financeiro, custo ou configurações", () => {
    expect(PRESET_VENDAS).toEqual(montarPermissoes({ dashboard: ["visualizar"], clientes: ["visualizar", "criar", "editar"], orcamentos: ["visualizar", "criar", "editar"], contratos: ["visualizar"] }));
    const v = PRESET_VENDAS as any;
    expect(v.orcamentos?.aprovar).toBeFalsy();
    expect(v.orcamentos?.verCusto).toBeFalsy();
    expect(Object.values(v.financeiro ?? {}).some(Boolean)).toBe(false);
    expect(Object.values(v.configuracoes ?? {}).some(Boolean)).toBe(false);
  });

  it("6 tipos de OS; só PMOC e Manutenção Preventiva exigem equipamento", () => {
    expect(TIPOS_OS_PADRAO.map((t) => t.nome)).toEqual(["Instalação", "Manutenção Preventiva", "Manutenção Corretiva", "Visita Técnica", "PMOC", "Orçamento/Vistoria"]);
    expect(TIPOS_OS_PADRAO.filter((t) => t.exigeEquipamento).map((t) => t.nome)).toEqual(["Manutenção Preventiva", "PMOC"]);
  });

  it("faltando: compara sem acento, caixa e espaços extras", () => {
    expect(chaveNome("  Manutenção   PREVENTIVA ")).toBe("manutencao preventiva");
    const r = faltando(TIPOS_OS_PADRAO, [{ nome: "manutencao preventiva" }, { nome: "PMOC" }, { nome: "Outro tipo meu" }]);
    expect(r.map((t) => t.nome)).toEqual(["Instalação", "Manutenção Corretiva", "Visita Técnica", "Orçamento/Vistoria"]);
    expect(faltando(TIPOS_OS_PADRAO, TIPOS_OS_PADRAO)).toEqual([]);
  });
});

/* ───────────── B: tela Nova empresa ───────────── */
describe("Nova empresa (tela do super admin)", () => {
  it("máscara do CNPJ enquanto digita", () => {
    expect(mascararCnpj("11222")).toBe("11.222");
    expect(mascararCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(mascararCnpj("11.222.333/0001-8199")).toBe("11.222.333/0001-81");
  });

  async function preencher() {
    await clicar($("[data-nova-empresa]"));
    await digitar("[data-campo='razaoSocial']", "Climatização Horizonte Ltda (fictícia)");
    await digitar("[data-campo='cnpj']", "11222333000181");
    await digitar("[data-campo='email']", "contato@horizonte.ficticio");
    await digitar("[data-campo='adminNome']", "Beatriz Fictícia");
    await digitar("[data-campo='adminEmail']", "beatriz@horizonte.ficticio");
    await digitar("[data-campo='adminSenha']", "Horizonte@2027");
  }

  it("cria e mostra o login para entregar ao administrador (com a troca obrigatória da senha no 1º acesso)", async () => {
    respostas["POST /api/admin/empresas"] = () => [201, { ok: true, empresaId: "eN", adminEmail: "beatriz@horizonte.ficticio", perfis: 5, tiposOs: 6 }];
    respostas["GET /api/admin/empresas"] = () => [200, { empresas: [{ id: "eN", nome: "Climatização Horizonte Ltda (fictícia)", nomeFantasia: null, cnpj: "11.222.333/0001-81", ativo: true, criadoEm: new Date().toISOString(), usuarios: 1 }] }];
    const { EmpresasAdmin } = await import("@/components/admin/empresas-admin");
    await montar(createElement(EmpresasAdmin, { inicial: [] }), permissoesTotais(), "SUPER_ADMIN");
    await preencher();
    expect(($("[data-campo='cnpj']") as HTMLInputElement).value).toBe("11.222.333/0001-81");
    await clicar($("[data-confirmar-nova-empresa]"));
    const post = chamadas.find((c) => c.metodo === "POST")!;
    expect(post.corpo).toMatchObject({ razaoSocial: "Climatização Horizonte Ltda (fictícia)", cnpj: "11.222.333/0001-81", admin: { nome: "Beatriz Fictícia", email: "beatriz@horizonte.ficticio", senha: "Horizonte@2027" } });
    const aviso = $("[data-empresa-criada]")!.textContent!.replace(/\s+/g, " ");
    expect(aviso).toContain("beatriz@horizonte.ficticio");
    // "Troca de senha no 1º acesso": o aviso diz que o sistema pede a troca (antes mandava ir a Meu perfil › Senha)
    expect(aviso).toContain("No primeiro acesso, o sistema pede que ele crie a própria senha.");
    // A senha nunca aparece na tela depois de criar
    expect(texto()).not.toContain("Horizonte@2027");
    expect($("[data-lista-empresas]")!.textContent).toContain("Climatização Horizonte Ltda (fictícia)");
  });

  it("erro do servidor (e-mail já é login) aparece no formulário, que continua aberto", async () => {
    respostas["POST /api/admin/empresas"] = () => [409, { erro: "Este e-mail já é login de outro usuário. Use outro e-mail para o administrador." }];
    const { EmpresasAdmin } = await import("@/components/admin/empresas-admin");
    await montar(createElement(EmpresasAdmin, { inicial: [] }), permissoesTotais(), "SUPER_ADMIN");
    await preencher();
    await clicar($("[data-confirmar-nova-empresa]"));
    expect($("[data-erro-nova-empresa]")!.textContent).toContain("já é login de outro usuário");
    expect($("[data-form-nova-empresa]")).toBeTruthy();
    expect($("[data-empresa-criada]")).toBeNull();
  });
});

/* ───────────── C: Usar modelos sugeridos ───────────── */
describe("Usar modelos sugeridos (Tipos de OS)", () => {
  const FALTAM = TIPOS_OS_PADRAO.map((t) => ({ nome: t.nome, exigeEquipamento: t.exigeEquipamento }));

  it("lista vazia + quem grava: oferece; um clique cria e recarrega a lista", async () => {
    respostas["GET /api/tipos-os/modelos"] = () => [200, { total: 0, faltando: FALTAM }];
    respostas["POST /api/tipos-os/modelos"] = () => [200, { criados: 6 }];
    const onCriados = vi.fn();
    const { ModelosTiposOs } = await import("@/components/cadastros/modelos-tipos-os");
    await montar(createElement(ModelosTiposOs, { onCriados }));
    expect($("[data-modelos-tipos-os]")!.textContent).toContain("Manutenção Preventiva");
    await clicar($("[data-usar-modelos]"));
    expect(chamadas.some((c) => c.metodo === "POST" && c.url === "/api/tipos-os/modelos")).toBe(true);
    expect(onCriados).toHaveBeenCalledTimes(1);
    expect($("[data-modelos-tipos-os]")).toBeNull();
  });

  it("empresa que já tem tipos de OS não é incomodada", async () => {
    respostas["GET /api/tipos-os/modelos"] = () => [200, { total: 3, faltando: FALTAM.slice(0, 2) }];
    const { ModelosTiposOs } = await import("@/components/cadastros/modelos-tipos-os");
    await montar(createElement(ModelosTiposOs, { onCriados: () => {} }));
    expect($("[data-modelos-tipos-os]")).toBeNull();
  });

  it("sem Configurações › Gerenciar: nem consulta, nem mostra", async () => {
    const { ModelosTiposOs } = await import("@/components/cadastros/modelos-tipos-os");
    await montar(createElement(ModelosTiposOs, { onCriados: () => {} }), montarPermissoes({ configuracoes: ["visualizar"] }));
    expect($("[data-modelos-tipos-os]")).toBeNull();
    expect(chamadas).toHaveLength(0);
  });
});

/* ───────────── D: Cliente aprovou ───────────── */
describe("Cliente aprovou (equipe)", () => {
  it("texto da linha do tempo e validação", () => {
    expect(detalheAprovacaoEquipe({ nome: " Sr. Paulo ", canal: "WHATSAPP", observacao: "  " }, "Marina")).toBe("Sr. Paulo (por WhatsApp) · registrado por Marina");
    expect(detalheAprovacaoEquipe({ nome: "Ana", canal: "PRESENCIAL", observacao: "na obra" }, "Marina")).toBe("Ana (por pessoalmente) · registrado por Marina — na obra");
    expect(aprovacaoEquipeSchema.safeParse({ nome: "Ana", canal: "EMAIL" }).success).toBe(true);
    expect(aprovacaoEquipeSchema.safeParse({ nome: "Ana", canal: "EMAIL", cpf: "1" }).success).toBe(false);
    expect([...PODE_APROVAR_PELA_EQUIPE]).toEqual(["ENVIADO", "RASCUNHO"]);
  });

  it("modal: exige quem e por onde; registra e atualiza a página", async () => {
    respostas["POST /api/orcamentos/o1/aprovacao-equipe"] = () => [200, { ok: true, status: "APROVADO" }];
    const { BotaoClienteAprovou } = await import("@/components/orcamento/aprovacao-equipe");
    await montar(createElement(BotaoClienteAprovou, { orcamentoId: "o1" }));
    await clicar($("[data-marcar-aprovado]"));
    expect($("[data-modal-aprovacao-equipe]")).toBeTruthy();
    await clicar($("[data-confirmar-aprovacao]"));
    expect($("[data-erro-aprovacao]")!.textContent).toContain("Informe quem aprovou.");
    await digitar("[data-modal-aprovacao-equipe] [data-campo='nome']", "Sr. Paulo (fictício)");
    await clicar($("[data-confirmar-aprovacao]"));
    expect($("[data-erro-aprovacao]")!.textContent).toContain("Escolha por onde");
    expect(chamadas).toHaveLength(0);
    await clicar($("[data-canal='TELEFONE']"));
    expect($("[data-canal='TELEFONE']")!.getAttribute("aria-checked")).toBe("true");
    await digitar("[data-modal-aprovacao-equipe] [data-campo='observacao']", "Ligou às 10h");
    await clicar($("[data-confirmar-aprovacao]"));
    expect(chamadas[0]).toMatchObject({ metodo: "POST", url: "/api/orcamentos/o1/aprovacao-equipe", corpo: { nome: "Sr. Paulo (fictício)", canal: "TELEFONE", observacao: "Ligou às 10h" } });
    expect(refresh).toHaveBeenCalled();
  });

  it("erro do servidor (validade vencida) aparece no modal", async () => {
    respostas["POST /api/orcamentos/o1/aprovacao-equipe"] = () => [410, { erro: "A validade deste orçamento já venceu." }];
    const { BotaoClienteAprovou } = await import("@/components/orcamento/aprovacao-equipe");
    await montar(createElement(BotaoClienteAprovou, { orcamentoId: "o1" }));
    await clicar($("[data-marcar-aprovado]"));
    await digitar("[data-modal-aprovacao-equipe] [data-campo='nome']", "Ana");
    await clicar($("[data-canal='EMAIL']"));
    await clicar($("[data-confirmar-aprovacao]"));
    expect($("[data-erro-aprovacao]")!.textContent).toContain("validade");
    expect(refresh).not.toHaveBeenCalled();
  });
});

/* ───────────── E: equipamento pelo tipo ───────────── */
describe("Equipamento obrigatório só quando o tipo exige", () => {
  const OS = { origem: "MANUAL", semEquipamentoMotivo: null };
  it("sem tipo de OS: dispensa (SEM_TIPO); tipo que não exige: TIPO; tipo que exige: trava", async () => {
    const { dispensaDaAtividade } = await import("@/lib/execucao/dados");
    expect(await dispensaDaAtividade("e1", "os1", { tipoOs: null }, OS)).toEqual({ motivo: "SEM_TIPO", texto: textoDispensa("SEM_TIPO") });
    expect(await dispensaDaAtividade("e1", "os1", { tipoOs: { nome: "Instalação", exigeEquipamento: false } }, OS)).toMatchObject({ motivo: "TIPO" });
    expect(await dispensaDaAtividade("e1", "os1", { tipoOs: { nome: "PMOC", exigeEquipamento: true } }, OS)).toBeNull();
    expect(textoDispensa("SEM_TIPO")).toContain("só é exigido quando o tipo exige");
  });
});

/* ───────────── F: desmarcar executado ───────────── */
describe("Itens da OS — desmarcar executado", () => {
  const ITEM = (executado: boolean) => ({ id: "i1", tipo: "SERVICO", servicoId: null, descricao: "Limpeza de split", quantidade: 1, valorUnitario: 200, valorTotal: 200, valorBase: 200, ajusteMateriais: 0, executado, orcamentoServicoId: null, materiais: [] });

  it("executado mostra \"Desmarcar\", que volta o item para não executado", async () => {
    respostas["PUT /api/ordens/os1/orcamento/i1"] = (c) => [200, { ...ITEM(c.executado), executadoEm: null }];
    const { OsOrcamento } = await import("@/components/os/os-orcamento");
    await montar(createElement(OsOrcamento as any, { osId: "os1", itens: [ITEM(true)], clienteId: "c1" }));
    await clicar($("[data-desmarcar-executado]"));
    expect(chamadas.find((c) => c.metodo === "PUT")).toMatchObject({ url: "/api/ordens/os1/orcamento/i1", corpo: { executado: false } });
    expect($("[data-desmarcar-executado]")).toBeNull();
    expect(texto()).toContain("Marcar executado");
  });

  it("registro fechado (assinado pelo cliente) e sem Ordens › Editar: sem \"Desmarcar\"", async () => {
    const { OsOrcamento } = await import("@/components/os/os-orcamento");
    await montar(createElement(OsOrcamento as any, { osId: "os1", itens: [ITEM(true)], clienteId: "c1", situacao: { aceite: "CONFIRMADO", faturado: false, notaEmitida: false } }));
    expect($("[data-desmarcar-executado]")).toBeNull();
    act(() => root!.unmount()); root = null; caixa.remove();
    await montar(createElement(OsOrcamento as any, { osId: "os1", itens: [ITEM(true)], clienteId: "c1" }), montarPermissoes({ ordens: ["visualizar"] }));
    expect($("[data-desmarcar-executado]")).toBeNull();
  });
});

/* ───────────── J: assinatura ───────────── */
describe("Quadro de assinatura no redimensionar", () => {
  it("rolar no celular (mesmo tamanho) não redimensiona; girar (outro tamanho) sim", () => {
    expect(tamanhoInterno({ largura: 300, altura: 160 }, 2)).toEqual({ largura: 600, altura: 320 });
    expect(tamanhoInterno({ largura: 300, altura: 160 }, 0.5)).toEqual({ largura: 300, altura: 160 });
    expect(precisaRedimensionar({ largura: 600, altura: 320 }, { largura: 300, altura: 160 }, 2)).toBe(false);
    expect(precisaRedimensionar({ largura: 600, altura: 320 }, { largura: 500, altura: 160 }, 2)).toBe(true);
    expect(precisaRedimensionar({ largura: 300, altura: 160 }, { largura: 300, altura: 160 }, undefined)).toBe(false);
  });

  it("as três telas do cliente usam o quadro que não apaga (clearOnResize={false} + useAssinaturaPreservada)", async () => {
    const fs = await import("node:fs");
    for (const f of ["components/orcamento/aprovacao-publica.tsx", "components/relatorio/aprovacao-relatorio.tsx", "components/medicao/aprovacao-medicao.tsx"]) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).toContain("clearOnResize={false}");
      expect(src, f).toContain("useAssinaturaPreservada(sigRef)");
    }
  });
});

/* ───────────── K: nome da empresa ───────────── */
describe("Nome da empresa (do cadastro)", () => {
  it("nome fantasia; sem ele, a razão social; nunca vazio quando há empresa", () => {
    expect(nomeExibidoDaEmpresa({ nome: "Refrigeração Nova Era Ltda", nomeFantasia: "Nova Era" })).toBe("Nova Era");
    expect(nomeExibidoDaEmpresa({ nome: "Refrigeração Nova Era Ltda", nomeFantasia: null })).toBe("Refrigeração Nova Era Ltda");
    expect(nomeExibidoDaEmpresa({ nome: "Refrigeração Nova Era Ltda", nomeFantasia: "   " })).toBe("Refrigeração Nova Era Ltda");
    expect(nomeExibidoDaEmpresa(null)).toBe("");
  });
});

/* ───────────── L: chips da Implantação ───────────── */
describe("Implantação — itens que levam a uma tela têm cara de clicável", () => {
  it("item com seção: link com seta, título e foco visível; item só informativo: etiqueta sem link", async () => {
    const { PainelImplantacao } = await import("@/components/implantacao/painel-implantacao");
    const { ModulosProvider } = await import("@/components/providers/modulos-provider");
    const { progresso } = await import("@/lib/implantacao/etapas");
    const etapas = [{
      id: "empresa", numero: 1, titulo: "Dados da empresa", descricao: "Nome, CNPJ, endereço e logo", feita: false, dispensada: false,
      itens: [{ rotulo: "Logo", valor: false, secao: "empresa" }, { rotulo: "Usuários", valor: 2 }], importacoes: [],
    }] as any;
    await montar(createElement(ModulosProvider as any, { desligados: [] }, createElement(PainelImplantacao, { etapas, progresso: progresso(etapas) })));
    const logo = $("[data-item-etapa='Logo'] a[data-item-clicavel]")!;
    expect(logo).toBeTruthy();
    expect(logo.getAttribute("title")).toBe("Abrir Logo em Configurações");
    expect(logo.className).toContain("focus-visible:ring-2");
    expect(logo.className).toContain("hover:bg-primary-50");
    expect(logo.querySelector("svg")).toBeTruthy();
    expect($("[data-item-etapa='Usuários'] a")).toBeNull();
    expect($("[data-item-etapa='Usuários'] span")).toBeTruthy();
  });
});
