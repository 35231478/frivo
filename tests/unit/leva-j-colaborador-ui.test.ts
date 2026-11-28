// @vitest-environment happy-dom
/**
 * LEVA J — Colaborador: as telas num DOM de verdade (happy-dom), API simulada, dados fictícios.
 *  - a ficha: todas as abas à vista (quebram linha), a jornada em faixas com o contador ao vivo (descontando o
 *    intervalo), o dia de outra faixa travado, a jornada errada não salva e leva à aba com a marca de erro;
 *  - a função: "Usa o app de campo" + "Responsável técnico (ART/PMOC)" (o CREA só para RT), gravados coerentes;
 *  - o CEP preenche o endereço; as competências são os tipos de OS da empresa (o inativo só se já marcado);
 *  - a OS mostra as especialidades junto ao nome; Configurações › Impressão liga/desliga e salva.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { CONFIG_RELATORIO_PADRAO } from "@/lib/relatorio-os/config";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 30_000 });

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {}, back: () => {} }),
  usePathname: () => "/colaboradores", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ui/avisos", async (original) => {
  const real = await original<typeof import("@/components/ui/avisos")>();
  return { ...real, toast: vi.fn(real.toast) };
});

let root: Root | null = null, caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }> = {};
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const $ = (sel: string, dentro: ParentNode = document) => dentro.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string, dentro: ParentNode = document) => [...dentro.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null | undefined) => { expect(el, "elemento a clicar").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (t: string) => [...document.querySelectorAll("button")].filter((b) => txt(b) === t).at(-1) ?? null;
async function digitar(el: Element | null, v: string) {
  expect(el, "campo").toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}
const gravacoes = () => chamadas.filter((c) => c.metodo !== "GET" && !c.url.startsWith("/api/preferencias"));

async function montar(el: ReactElement, permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: el })); });
  await esperar();
}

beforeAll(async () => {
  for (const m of [
    () => import("@/components/providers/permissoes-provider"), () => import("@/components/forms/colaborador-form"),
    () => import("@/components/os/os-atividades"), () => import("@/components/config/impressao-os-client"),
  ]) await m();
}, 120_000);
beforeEach(() => {
  chamadas.length = 0; respostas = {}; nav.push.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = typeof init.body === "string" && init.body ? JSON.parse(init.body) : null;
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).find((k) => { const [m, u] = k.split(" "); return m === metodo && url.split("?")[0] === u; });
    const r = chave ? respostas[chave] : { status: 200, corpo: String(url).startsWith("/api/cadastros") || url === "/api/tipos-os" ? [] : {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); root = null; vi.unstubAllGlobals(); document.body.innerHTML = ""; });

/** Colaborador fictício com a jornada ANTIGA (um horário só, sem faixas) */
const COLAB: any = {
  id: "t1", nome: "Carlos Oliveira", cpf: "529.982.247-25", telefone: "(11) 3333-4444", ativo: true, statusColaborador: "ATIVO",
  tipo: "TECNICO_CAMPO", tipoEquipe: "CAMPO", competencias: [{ id: "toVelho" }], documentos: [], especialidades: ["VRF"],
  jornadaFaixas: null, jornadaEntrada: "08:00", jornadaSaida: "18:00", jornadaDias: ["SEG", "TER", "QUA", "QUI", "SEX"],
};
async function ficha(dados: any = COLAB) {
  const { ColaboradorForm } = await import("@/components/forms/colaborador-form");
  await montar(createElement(ColaboradorForm, { initialData: dados } as any));
}
const faixa = (i: number) => $(`[data-faixa="${i}"]`)!;
const dia = (i: number, d: string) => faixa(i).querySelector(`[data-dia="${d}"]`) as HTMLButtonElement;
const hora = (rotulo: string) => $(`input[aria-label="${rotulo}"]`);
const semana = () => txt($("[data-horas-semana]"));
const horasDia = (d: string) => txt($(`[data-horas-dia="${d}"]`));
const salvar = () => clicar(botao("Salvar alterações"));

describe("ficha do colaborador: as abas", () => {
  it("todas as abas na mesma barra, que quebra linha (sem rolagem lateral); a aba ativa marcada", async () => {
    await ficha();
    const barra = $("[data-abas-colaborador]")!;
    expect(barra.className).toContain("flex-wrap");
    expect(barra.className).not.toMatch(/overflow-x/);
    expect($$("[data-aba]", barra).map((b) => b.getAttribute("data-aba"))).toEqual(["pessoais", "profissionais", "competencias", "documentos"]);
    expect($("[data-aba='pessoais']")!.getAttribute("aria-current")).toBe("page");
    await clicar($("[data-aba='profissionais']"));
    expect($("[data-aba='profissionais']")!.getAttribute("aria-current")).toBe("page");
    expect($("[data-aba='pessoais']")!.getAttribute("aria-current")).toBeNull();
  });
});

describe("ficha do colaborador: a jornada em faixas", () => {
  it("a jornada antiga abre como UMA faixa; o contador mostra o dia e a semana", async () => {
    await ficha();
    await clicar($("[data-aba='profissionais']"));
    expect($$("[data-faixa]")).toHaveLength(1);
    expect(hora("Entrada da faixa 1")).toHaveProperty("value", "08:00");
    expect(semana()).toBe("50h");
    expect(horasDia("SEG")).toContain("10h");
    expect(horasDia("SAB")).toContain("—");
  });

  it("o contador muda ao vivo: com o intervalo, desconta; uma faixa nova soma o sábado; o dia de outra faixa fica travado", async () => {
    await ficha();
    await clicar($("[data-aba='profissionais']"));
    await digitar(hora("Início do intervalo da faixa 1"), "1200");
    await digitar(hora("Fim do intervalo da faixa 1"), "1300");
    expect(semana()).toBe("45h");
    expect(horasDia("SEG")).toContain("9h");
    expect(txt(faixa(0).querySelector("[data-horas-faixa]"))).toBe("9h por dia");

    await clicar($("[data-adicionar-faixa]"));
    expect($$("[data-faixa]")).toHaveLength(2);
    // todos os dias úteis já estão na faixa 1: a nova nasce sem dia e pede um
    expect(txt(faixa(1).querySelector("[data-erro-faixa]"))).toBe("Escolha os dias desta faixa.");
    expect(dia(1, "SEG").disabled).toBe(true);
    expect(dia(1, "SEG").title).toBe("Já está na faixa 1");
    expect(dia(1, "SAB").disabled).toBe(false);
    await clicar(dia(1, "SAB"));
    expect(dia(1, "SAB").getAttribute("aria-pressed")).toBe("true");
    expect(faixa(1).querySelector("[data-erro-faixa]")).toBeNull();
    expect(semana()).toBe("53h"); // 45h + sábado 08:00–17:00 com 1h de almoço
    expect(horasDia("SAB")).toContain("8h");
    // tirar o dia da faixa 1 libera o dia na faixa 2
    await clicar(dia(0, "SEX"));
    expect(dia(1, "SEX").disabled).toBe(false);
    expect(semana()).toBe("44h");

    await salvar();
    const put = gravacoes().find((c) => c.metodo === "PUT")!;
    expect(put.url).toBe("/api/tecnicos/t1");
    expect(put.corpo.jornadaFaixas).toEqual([
      { dias: ["SEG", "TER", "QUA", "QUI"], entrada: "08:00", saida: "18:00", intervaloInicio: "12:00", intervaloFim: "13:00" },
      { dias: ["SAB"], entrada: "08:00", saida: "17:00", intervaloInicio: "12:00", intervaloFim: "13:00" },
    ]);
    expect(nav.push).toHaveBeenCalledWith("/colaboradores");
  });

  it("jornada errada não salva: a mensagem diz a faixa, a aba é aberta e ganha a marca de erro", async () => {
    await ficha();
    await clicar($("[data-aba='profissionais']"));
    await digitar(hora("Início do intervalo da faixa 1"), "1200");
    await clicar($("[data-aba='pessoais']"));
    expect($("[data-aba='profissionais'] [aria-label='Tem erro']")).toBeTruthy();
    await salvar();
    expect(gravacoes()).toEqual([]);
    expect(document.body.textContent).toContain("Jornada: faixa 1: Informe o início e o fim do intervalo (ou deixe os dois em branco).");
    expect($("[data-aba='profissionais']")!.getAttribute("aria-current")).toBe("page");
  });

  it("remover a faixa: sem jornada, o contador zera e salva vazio", async () => {
    await ficha();
    await clicar($("[data-aba='profissionais']"));
    await clicar($("[data-remover-faixa]"));
    expect($("[data-jornada-vazia]")).toBeTruthy();
    expect(semana()).toBe("0h");
    await salvar();
    expect(gravacoes()[0].corpo.jornadaFaixas).toEqual([]);
  });
});

describe("ficha do colaborador: a função (no lugar de Tipo + Tipo de equipe)", () => {
  const chave = (sel: string) => $(`${sel} [role="switch"]`) as HTMLButtonElement;
  it("sem 'Tipo' nem 'Tipo de equipe'; os dois interruptores com dica; o CREA só para o RT; grava coerente", async () => {
    await ficha();
    await clicar($("[data-aba='profissionais']"));
    const funcao = $("[data-funcao-colaborador]")!;
    expect(txt(funcao)).toContain("Usa o app de campo");
    expect(txt(funcao)).toContain("Responsável técnico (ART/PMOC)");
    expect($$("label").map(txt)).not.toContain("Tipo de equipe");
    expect($("select[name='tipo']")).toBeNull();
    expect($("[data-usa-app-campo]")!.getAttribute("data-usa-app-campo")).toBe("sim");
    expect(chave("[data-responsavel-tecnico]").getAttribute("aria-checked")).toBe("false");
    expect($("input[name='crea']")).toBeNull();

    await clicar(chave("[data-responsavel-tecnico]"));
    expect($("input[name='crea']")).toBeTruthy();
    await clicar(chave("[data-usa-app-campo]"));
    expect($("[data-usa-app-campo]")!.getAttribute("data-usa-app-campo")).toBe("nao");
    await salvar();
    expect(gravacoes()[0].corpo).toMatchObject({ tipo: "RESPONSAVEL_TECNICO", tipoEquipe: "ADMINISTRATIVO" });
  });

  it("um motorista que não é RT continua motorista ao salvar", async () => {
    await ficha({ ...COLAB, tipo: "MOTORISTA", tipoEquipe: "CAMPO" });
    await salvar();
    expect(gravacoes()[0].corpo).toMatchObject({ tipo: "MOTORISTA", tipoEquipe: "CAMPO" });
  });
});

describe("ficha do colaborador: CEP e competências", () => {
  it("o CEP completo busca e preenche o endereço (a mesma consulta da admissão)", async () => {
    respostas["GET https://viacep.com.br/ws/13010000/json/"] = { status: 200, corpo: { logradouro: "Rua Fictícia", bairro: "Centro", localidade: "Campinas", uf: "SP" } };
    await ficha();
    await digitar($("[data-campo-cep]"), "13010000");
    expect(chamadas.some((c) => c.url === "https://viacep.com.br/ws/13010000/json/")).toBe(true);
    expect($("[data-campo-cep]")).toHaveProperty("value", "13010-000");
    expect($("input[name='endereco']")).toHaveProperty("value", "Rua Fictícia");
    expect($("input[name='cidade']")).toHaveProperty("value", "Campinas");
    expect($("input[name='estado']")).toHaveProperty("value", "SP");
  });

  it("o CEP que não existe avisa e deixa preencher à mão", async () => {
    respostas["GET https://viacep.com.br/ws/99999999/json/"] = { status: 200, corpo: { erro: true } };
    await ficha();
    await digitar($("[data-campo-cep]"), "99999999");
    expect(document.body.textContent).toContain("CEP não encontrado: preencha o endereço à mão."); // a dica do CampoCep (Leva I: um campo de CEP só)
    expect($("input[name='endereco']")).toHaveProperty("value", "");
  });

  it("as competências são os tipos de OS da empresa; o inativo aparece só se já estava marcado", async () => {
    respostas["GET /api/tipos-os"] = { status: 200, corpo: [
      { id: "toPrev", nome: "Preventiva PMOC", cor: "#0a0", ativo: true },
      { id: "toInst", nome: "Instalação de VRF", cor: "#00a", ativo: true },
      { id: "toVelho", nome: "Limpeza antiga", cor: "#999", ativo: false },
      { id: "toOutro", nome: "Inativo sem marca", cor: "#999", ativo: false },
    ] };
    await ficha();
    await clicar($("[data-aba='competencias']"));
    expect($$("[data-competencia]").map((l) => l.getAttribute("data-competencia"))).toEqual(["toPrev", "toInst", "toVelho"]);
    expect(txt($("[data-competencia='toVelho']"))).toContain("(inativo)");
    expect($("[data-competencia='toPrev'] [data-competencia-inativa]")).toBeNull();
    await clicar($("[data-competencia='toInst'] input"));
    await salvar();
    expect(gravacoes()[0].corpo.competenciaIds).toEqual(["toVelho", "toInst"]);
  });

  it("sem nenhum tipo de OS cadastrado, diz onde cadastrar", async () => {
    await ficha({ ...COLAB, competencias: [] });
    await clicar($("[data-aba='competencias']"));
    expect(txt($("[data-competencias-vazio]"))).toContain("Configurações → Tipos de OS");
  });
});

describe("especialidades junto ao nome do técnico", () => {
  const atividade = (tecnico: any, outros: any[] = []) => ({
    id: "a1", titulo: "Preventiva", status: "AGENDADA", dataAgendada: null, prazo: null, duracaoMin: 60, observacao: null, resumo: null,
    tipoOs: null, tipoOsId: null, tecnicoId: tecnico.id, tecnico, equipe: null, tecnicosEquipe: [{ tecnico }, ...outros.map((t) => ({ tecnico: t }))], veiculo: null, equipamentos: [],
  });
  it("na OS: 'João Silva — especialista em VRF e Chiller' (só quem tem especialidade)", async () => {
    const { OsAtividades } = await import("@/components/os/os-atividades");
    await montar(createElement(OsAtividades, { osId: "os1", atividades: [atividade({ id: "t1", nome: "João Silva", especialidades: ["VRF", "Chiller"] }, [{ id: "t2", nome: "Maria Souza", especialidades: [] }])] } as any));
    expect(txt($("[data-especialidades-atividade]"))).toBe("João Silva — especialista em VRF e Chiller");
  });
  it("na OS: sem especialidade (ou a empresa desligou, e a OS nem recebe), nenhuma linha a mais", async () => {
    const { OsAtividades } = await import("@/components/os/os-atividades");
    await montar(createElement(OsAtividades, { osId: "os1", atividades: [atividade({ id: "t1", nome: "João Silva", especialidades: [] })] } as any));
    expect($("[data-especialidades-atividade]")).toBeNull();
  });

  it("Configurações › Impressão: 'Mostrar especialidades do técnico' liga/desliga e vai junto ao salvar", async () => {
    const { ImpressaoOsClient } = await import("@/components/config/impressao-os-client");
    await montar(createElement(ImpressaoOsClient, { inicial: CONFIG_RELATORIO_PADRAO, especialidadesInicial: false, podeEditar: true }));
    const chave = $("[data-config-especialidades] [role='switch']")!;
    expect(txt($("[data-config-especialidades]"))).toContain("Mostrar especialidades do técnico");
    expect(chave.getAttribute("aria-checked")).toBe("false");
    await clicar(chave);
    expect(chave.getAttribute("aria-checked")).toBe("true");
    await clicar(botao("Salvar"));
    expect(gravacoes()[0]).toMatchObject({ url: "/api/configuracoes/impressao-os", metodo: "PUT", corpo: { mostrarEspecialidadesTecnico: true } });
  });
  it("Configurações › Impressão: padrão ligado; sem permissão, travado", async () => {
    const { ImpressaoOsClient } = await import("@/components/config/impressao-os-client");
    await montar(createElement(ImpressaoOsClient, { inicial: CONFIG_RELATORIO_PADRAO, podeEditar: false }), montarPermissoes({}));
    const chave = $("[data-config-especialidades] [role='switch']") as HTMLButtonElement;
    expect(chave.getAttribute("aria-checked")).toBe("true");
    expect(chave.disabled).toBe(true);
  });
});
