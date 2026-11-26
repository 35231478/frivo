// @vitest-environment happy-dom
/**
 * Implantação, leva 1 — o motor (puro) e a tela de importação (DOM real):
 *  - ligar colunas: o que a pessoa ligou vence o automático; "não importar" desliga; uma coluna da planilha
 *    liga a uma só; o mapa vindo da tela é conferido (só colunas do modelo, valores curtos ou null);
 *  - faltando coluna obrigatória, o erro traz o cabeçalho da planilha e o que já ficou ligado;
 *  - unidades e contatos: cliente pelo CNPJ/CPF da empresa, id de outro cliente, "principal" Sim/Não,
 *    chaves no mesmo cliente, um principal por cliente na planilha;
 *  - tela: família clientes → unidades → contatos só para quem pode; o "Ligar colunas" abre quando falta
 *    coluna, só aplica com as obrigatórias ligadas, manda o mapa na prévia e na confirmação, e um arquivo
 *    novo começa sem ligação; o resultado mostra as observações (unidade Principal, principal trocado).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { analisar, descreverChave, ErroColunas, ErroImportacao, lerLigacoes, ligacaoColunas, mapearCabecalho, type ContextoImportacao, type LinhaAnalisada } from "@/lib/importacao/motor";
import { familiaDe, IMPORTACOES } from "@/lib/importacao/entidades";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), usePathname: () => "/clientes", useSearchParams: () => new URLSearchParams() }));

const CNPJ = "11444777000161";
const CNPJ2 = "11222333000181";
const COLS = IMPORTACOES.clientes.colunas;
const ctx = (o: Partial<ContextoImportacao> = {}): ContextoImportacao => ({
  existentes: new Map(), refs: {}, podeAtualizar: true,
  mapas: { clientes: new Map([[CNPJ, "c1"], [CNPJ2, "c2"]]), unidadeDoCliente: new Map([["u-c2", "c2"]]), contatoDoCliente: new Map([["k-c2", "c2"]]) },
  ...o,
});

/* ═════════════ Motor ═════════════ */
describe("ligar colunas (motor)", () => {
  const cab = ["Nome do Cliente", "CPF/CNPJ", "Cidade", "Telefone principal", "linha_original", null, "Obs"];

  it("o que a pessoa ligou vence o automático; null desliga; uma coluna da planilha liga a uma só; o resto segue automático", () => {
    const auto = mapearCabecalho(cab, COLS);
    expect(auto.mapa.has("nome")).toBe(false);
    expect(auto.mapa.get("cnpj_cpf")).toBe(1);
    expect(auto.mapa.get("cidade")).toBe(2);
    expect(auto.ignoradas).toEqual(["Nome do Cliente", "Telefone principal"]); // "Obs" casa o apelido de observações

    const m = mapearCabecalho(cab, COLS, { nome: "Nome do Cliente", telefone: " Telefone principal ", cidade: null, celular: "Telefone principal" });
    expect(m.mapa.get("nome")).toBe(0);
    expect(m.mapa.get("telefone")).toBe(3);
    expect(m.mapa.has("cidade")).toBe(false); // "não importar" vence o reconhecimento automático
    expect(m.mapa.has("celular")).toBe(false); // a mesma coluna da planilha não liga duas vezes
    expect(m.mapa.get("cnpj_cpf")).toBe(1); // fora do mapa: automático
    // a coluna "Cidade" desligada da cidade não vira outra coisa; "Obs" casa o apelido de observações
    expect(m.mapa.get("observacoes")).toBe(6);
    expect(m.ignoradas).toEqual(["Cidade"]);
  });

  it("coluna ligada a um cabeçalho que não existe na planilha: fica sem ligação (e sem o automático dela)", () => {
    const m = mapearCabecalho(["nome", "cnpj_cpf"], COLS, { nome: "Não existe" });
    expect(m.mapa.has("nome")).toBe(false);
    expect(m.ignoradas).toEqual(["nome"]);
  });

  it("ligacaoColunas: cabeçalho sem vazios nem colunas de serviço; o que ficou ligado; as obrigatórias que faltam", () => {
    const { mapa } = mapearCabecalho(cab, COLS);
    expect(ligacaoColunas(cab, COLS, mapa)).toMatchObject({
      cabecalho: ["Nome do Cliente", "CPF/CNPJ", "Cidade", "Telefone principal", "Obs"],
      ligadas: { nome: null, cnpj_cpf: "CPF/CNPJ", cidade: "Cidade", observacoes: "Obs", telefone: null },
      faltando: ["nome"],
    });
  });

  it("falta coluna obrigatória → ErroColunas com o cabeçalho; ligada, analisa", () => {
    const tabela = [cab, ["Hospital", CNPJ, "BH", "3133", "", null, ""]];
    let erro: unknown;
    try { analisar(tabela, IMPORTACOES.clientes, ctx()); } catch (e) { erro = e; }
    expect(erro).toBeInstanceOf(ErroColunas);
    expect(erro).toBeInstanceOf(ErroImportacao);
    expect((erro as ErroColunas).message).toMatch(/^Faltam colunas obrigatórias: nome\. Ligue cada uma/);
    expect((erro as ErroColunas).ligar.faltando).toEqual(["nome"]);
    const a = analisar(tabela, IMPORTACOES.clientes, ctx(), { nome: "Nome do Cliente" });
    expect(a.resumo).toMatchObject({ criar: 1, erros: 0 });
    expect(a.colunas.ligadas.nome).toBe("Nome do Cliente");
  });

  it("lerLigacoes: vazio = nada; só colunas do modelo, texto até 200 ou null; JSON quebrado, lista, número → erro", () => {
    expect(lerLigacoes(null, COLS)).toBeUndefined();
    expect(lerLigacoes("", COLS)).toBeUndefined();
    expect(lerLigacoes('{"nome":"A","cidade":null}', COLS)).toEqual({ nome: "A", cidade: null });
    expect(lerLigacoes({ nome: "x".repeat(200) }, COLS)).toEqual({ nome: "x".repeat(200) });
    for (const ruim of ["{x", "[]", '"nome"', "12", { empresa_id: "A" }, { nome: 1 }, { nome: "x".repeat(201) }, { nome: {} }])
      expect(() => lerLigacoes(ruim, COLS)).toThrow(/Ligação de colunas inválida/);
    expect(() => lerLigacoes({ empresa_id: "A" }, COLS)).toThrow(/“empresa_id” não é uma coluna do modelo/);
    const muitas = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`c${i}`, null]));
    expect(() => lerLigacoes(muitas, COLS)).toThrow(/“c0” não é uma coluna do modelo/);
  });

  it("descreverChave: chave de dentro do cliente não mostra o id do cliente", () => {
    expect(descreverChave("un:c1|loja centro")).toBe("o nome de unidade no mesmo cliente loja centro");
    expect(descreverChave("ctmail:c1|a@b.com")).toBe("o e-mail no mesmo cliente a@b.com");
    expect(descreverChave("doc:123")).toBe("o CNPJ/CPF 123");
  });
});

describe("unidades e contatos (motor)", () => {
  const U = IMPORTACOES.unidades;
  const K = IMPORTACOES.contatos;
  const linhaU = (o: Record<string, string | null>) => U.validar({ cnpj_cpf: CNPJ, nome: "Loja", principal: null, cep: null, endereco: null, numero: null, complemento: null, bairro: null, cidade: null, estado: null, telefone: null, observacoes: null, id_sistema: null, ...o }, ctx());
  const linhaK = (o: Record<string, string | null>) => K.validar({ cnpj_cpf: CNPJ, nome: "Marta", cargo: null, tipo: null, email: null, telefone: null, whatsapp: null, principal: null, id_sistema: null, ...o }, ctx());

  it("unidade: cliente pelo documento da empresa; chave = nome no mesmo cliente; principal Sim/Não/vazio", () => {
    const r = linhaU({ cnpj_cpf: "11.444.777/0001-61", nome: "loja centro", principal: "SIM", cep: "30140000", estado: "mg" });
    expect(r).toMatchObject({ ok: true, rotulo: "loja centro", chaves: ["un:c1|loja centro"], dados: { clienteId: "c1", nome: "Loja Centro", principal: true, cep: "30140-000", estado: "MG" } });
    expect(linhaU({ principal: "não" })).toMatchObject({ dados: { principal: false } });
    expect(linhaU({ principal: "x" })).toMatchObject({ dados: { principal: true } });
    expect((linhaU({}) as any).dados.principal).toBeUndefined();
    expect(linhaU({ principal: "talvez" })).toMatchObject({ ok: false, erros: [expect.stringMatching(/principal “talvez” não existe\. Opções válidas: Sim, Não/)] });
  });

  it("unidade: cliente que não existe na empresa, id de outro cliente, nome vazio → erro; id do próprio cliente → 1ª chave", () => {
    expect(linhaU({ cnpj_cpf: "52998224725" })).toMatchObject({ ok: false, erros: [expect.stringMatching(/nenhum cliente com o CPF 529\.982\.247-25 nesta empresa/)] });
    expect(linhaU({ cnpj_cpf: null })).toMatchObject({ ok: false, erros: [expect.stringMatching(/cnpj_cpf: obrigatório/)] });
    expect(linhaU({ id_sistema: "u-c2" })).toMatchObject({ ok: false, erros: [expect.stringMatching(/é de uma unidade de outro cliente/)] });
    expect(linhaU({ cnpj_cpf: CNPJ2, id_sistema: "u-c2" })).toMatchObject({ ok: true, chaves: ["id:u-c2", "un:c2|loja"] });
    expect(linhaU({ nome: null })).toMatchObject({ ok: false, erros: ["nome: obrigatório."] });
  });

  it("contato: e-mail sem maiúsculas é a 1ª chave (depois o nome); tipo por rótulo, valor ou apelido; nome curto/e-mail ruim → erro", () => {
    const r = linhaK({ email: "Marta@Cliente.COM", tipo: "chamados", principal: "sim" });
    expect(r).toMatchObject({ ok: true, chaves: ["ctmail:c1|marta@cliente.com", "ctnome:c1|marta"], dados: { clienteId: "c1", email: "marta@cliente.com", tipo: "OPERACIONAL", principal: true } });
    expect(linhaK({})).toMatchObject({ chaves: ["ctnome:c1|marta"] });
    expect(linhaK({ tipo: "Técnico" })).toMatchObject({ dados: { tipo: "TECNICO" } });
    expect(linhaK({ tipo: "financeiro" })).toMatchObject({ dados: { tipo: "FINANCEIRO" } });
    expect(linhaK({ tipo: "dono" })).toMatchObject({ dados: { tipo: "DIRETORIA" } });
    expect(linhaK({ nome: "A" })).toMatchObject({ ok: false, erros: ["nome: use pelo menos 2 letras."] });
    expect(linhaK({ email: "a@" })).toMatchObject({ ok: false, erros: [expect.stringMatching(/não é um e-mail válido/)] });
    expect(linhaK({ id_sistema: "k-c2" })).toMatchObject({ ok: false, erros: [expect.stringMatching(/é de um contato de outro cliente/)] });
  });

  it("um principal por cliente na planilha: o 2º 'Sim' do mesmo cliente vira erro; outro cliente ou 'Não' não", () => {
    const l = (linha: number, clienteId: string, principal?: boolean) => ({ linha, status: "criar", rotulo: "", erros: [], valores: {}, dados: { clienteId, principal } }) as LinhaAnalisada;
    const conferir = U.conferirPlanilha!;
    const erros = conferir([l(2, "c1", true), l(3, "c2", true), l(4, "c1", false), l(5, "c1", true), l(6, "c1")]);
    expect([...erros.entries()]).toEqual([[5, "principal: a linha 2 já marca a unidade principal deste cliente (só pode haver um)."]]);
    expect(K.conferirPlanilha!([l(2, "c1", true), l(3, "c1", true)]).get(3)).toMatch(/já marca o contato principal/);
  });

  it("na análise, o 2º principal vira erro e fica fora da gravação (sem dados)", () => {
    const tabela = [["cnpj_cpf", "nome", "principal"], [CNPJ, "A", "sim"], [CNPJ, "B", "sim"], [CNPJ2, "C", "sim"]];
    const a = analisar(tabela, U, ctx());
    expect(a.resumo).toMatchObject({ criar: 2, erros: 1 });
    expect(a.linhas[1]).toMatchObject({ linha: 3, status: "erro", dados: undefined });
  });

  it("família: clientes abre clientes → unidades → contatos; os outros cadastros, só eles mesmos", () => {
    // leva 2: + equipamentos (ligados ao cliente pelo CNPJ/CPF e à unidade pelo nome)
    expect(familiaDe("clientes")).toEqual(["clientes", "unidades", "contatos", "equipamentos"]);
    expect(familiaDe("produtos")).toEqual(["produtos"]);
    expect(familiaDe("unidades")).toEqual(["unidades"]);
  });
});

/* ═════════════ Tela ═════════════ */
let root: Root | null = null;
let caixa: HTMLDivElement;
let Provider: any;
let ImportarPlanilha: any;
beforeAll(async () => {
  ({ PermissoesProvider: Provider } = await import("@/components/providers/permissoes-provider"));
  ({ ImportarPlanilha } = await import("@/components/importacao/importar-planilha"));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const $$ = (s: string) => Array.from(document.querySelectorAll(s)) as HTMLElement[];
const espera = async (ms = 20) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
async function montar(permissoes: Permissoes = permissoesTotais()) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root!.render(createElement(Provider, { permissoes, role: "OPERADOR" }, createElement(ImportarPlanilha, { entidade: "clientes" }))); });
  await act(async () => { ($("[data-acao='importar-planilha']") as HTMLButtonElement).click(); });
  await espera();
}
async function clicar(sel: string) { await act(async () => { ($(sel) as HTMLElement).click(); }); await espera(); }
async function escolherArquivo(nome = "dados.csv") {
  const input = $("[data-campo='arquivo']") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [new File(["x"], nome)], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await espera();
}
async function escolher(sel: string, valor: string) {
  const s = $(sel) as HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(s, valor);
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** fetch falso: devolve as respostas na ordem e guarda o que foi enviado */
function rede(respostas: { status: number; json: unknown }[]) {
  const enviados: FormData[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    enviados.push(init?.body as FormData);
    const r = respostas.shift()!;
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
  return enviados;
}
const LIGAR = { cabecalho: ["Nome do Cliente", "CPF/CNPJ", "Telefone principal"], ligadas: { ...Object.fromEntries(COLS.map((c) => [c.chave, null])), cnpj_cpf: "CPF/CNPJ" }, faltando: ["nome"] };
const PREVIA = (ligadas = LIGAR.ligadas) => ({
  podeAtualizar: true,
  analise: { linhas: [{ linha: 2, status: "criar", rotulo: "Hospital", erros: [], valores: {} }], resumo: { total: 1, criar: 1, atualizar: 0, erros: 0, avisos: 0 }, colunasIgnoradas: [], colunas: { ...LIGAR, ligadas, faltando: [] } },
});

describe("tela de importação: clientes → unidades → contatos", () => {
  it("com Clientes › Editar: escolhe a planilha (clientes, unidades, contatos); unidade mostra o texto dela e o link para baixar as cadastradas", async () => {
    await montar();
    expect($$("[data-importar-o-que]").map((b) => b.dataset.importarOQue)).toEqual(["clientes", "unidades", "contatos", "equipamentos"]);
    expect($("[data-importacao]")!.dataset.importacao).toBe("clientes");
    expect($("[data-acao='baixar-cadastrados']")).toBeNull();
    await clicar("[data-importar-o-que='unidades']");
    expect($("[data-importacao]")!.dataset.importacao).toBe("unidades");
    expect($("[data-importacao]")!.textContent).toMatch(/Uma linha por unidade\. Obrigatórias: cnpj_cpf, nome/);
    expect($("[data-importacao]")!.textContent).toMatch(/são atualizadas/);
    expect($("[data-acao='baixar-cadastrados']")!.getAttribute("href")).toBe("/api/importacao/unidades/exportar");
    expect($("[data-acao='baixar-cadastrados']")!.textContent).toMatch(/Baixar unidades já cadastradas/);
    expect($("[data-acao='baixar-modelo-xlsx']")!.getAttribute("href")).toBe("/api/importacao/unidades/modelo?formato=xlsx");
    await clicar("[data-importar-o-que='contatos']");
    expect($("[data-acao='baixar-cadastrados']")!.textContent).toMatch(/Baixar contatos já cadastrados/);
  });

  it("sem Clientes › Editar: só a planilha de clientes (sem escolher), com o título antigo", async () => {
    await montar(montarPermissoes({ clientes: ["visualizar", "criar"] }));
    expect($("[data-escolher-planilha]")).toBeNull();
    expect(document.body.textContent).toMatch(/Importar clientes por planilha/);
  });

  it("falta coluna: abre o 'Ligar colunas'; aplicar só com as obrigatórias; o mapa vai na prévia e na confirmação; observações no resultado", async () => {
    const ligadas = { ...LIGAR.ligadas, nome: "Nome do Cliente", telefone: "Telefone principal" };
    const enviados = rede([
      { status: 400, json: { erro: "Faltam colunas obrigatórias: nome.", ligar: LIGAR } },
      { status: 200, json: PREVIA(ligadas) },
      { status: 200, json: { ok: true, criados: 1, atualizados: 0, comErro: 0, erros: [], observacoes: ["1 cliente ganhou a unidade “Principal” com o endereço do cadastro."] } },
    ]);
    await montar();
    await escolherArquivo();
    expect($("[data-ligar-colunas]")).toBeTruthy();
    expect($("[data-importacao] [role='alert']")).toBeNull(); // não é só um erro: dá para ligar
    expect(enviados[0].get("ligacoes")).toBeNull();
    expect($("[data-ligar-colunas]")!.textContent).toMatch(/A planilha não tem a coluna nome com esse nome/);
    expect(($("[data-acao='aplicar-ligacao']") as HTMLButtonElement).disabled).toBe(true);
    expect($$("[data-ligacao='nome'] option").map((o) => o.textContent)).toEqual(["— não importar —", "Nome do Cliente", "CPF/CNPJ", "Telefone principal"]);
    expect(($("[data-ligacao='cnpj_cpf']") as HTMLSelectElement).value).toBe("CPF/CNPJ");

    // a mesma coluna da planilha não liga duas vezes: escolher de novo tira da anterior
    await escolher("[data-ligacao='nome']", "Telefone principal");
    await escolher("[data-ligacao='telefone']", "Telefone principal");
    expect(($("[data-ligacao='nome']") as HTMLSelectElement).value).toBe("");
    expect(($("[data-acao='aplicar-ligacao']") as HTMLButtonElement).disabled).toBe(true);
    expect($("[data-ligar-colunas]")!.textContent).toMatch(/Falta ligar: nome\./);
    await escolher("[data-ligacao='nome']", "Nome do Cliente");
    expect(($("[data-acao='aplicar-ligacao']") as HTMLButtonElement).disabled).toBe(false);

    await clicar("[data-acao='aplicar-ligacao']");
    expect(JSON.parse(String(enviados[1].get("ligacoes")))).toEqual(ligadas);
    expect(enviados[1].get("etapa")).toBe("previa");
    expect($("[data-ligar-colunas]")).toBeNull();
    expect($("[data-previa]")).toBeTruthy();
    expect($("[data-aviso-previa]")!.textContent).toMatch(/ganha a unidade “Principal” com o endereço dele/);

    await clicar("[data-acao='confirmar-importacao']");
    expect(enviados[2].get("etapa")).toBe("confirmar");
    expect(JSON.parse(String(enviados[2].get("ligacoes")))).toEqual(ligadas);
    expect($("[data-observacoes]")!.textContent).toBe("1 cliente ganhou a unidade “Principal” com o endereço do cadastro.");
  });

  it("'Conferir como as colunas foram ligadas' reabre o painel; um arquivo novo começa sem a ligação anterior", async () => {
    const ligadas = { ...LIGAR.ligadas, nome: "Nome do Cliente" };
    const enviados = rede([
      { status: 200, json: PREVIA(ligadas) },
      { status: 200, json: PREVIA(ligadas) },
      { status: 200, json: PREVIA() },
    ]);
    await montar();
    await escolherArquivo();
    await clicar("[data-acao='abrir-ligacao']");
    expect(($("[data-ligacao='nome']") as HTMLSelectElement).value).toBe("Nome do Cliente");
    await escolher("[data-ligacao='telefone']", "Telefone principal");
    await clicar("[data-acao='aplicar-ligacao']");
    expect(JSON.parse(String(enviados[1].get("ligacoes"))).telefone).toBe("Telefone principal");
    await escolherArquivo("outro.csv");
    expect(enviados[2].get("ligacoes")).toBeNull();
  });

  it("trocar de planilha (clientes → unidades) recomeça do zero", async () => {
    rede([{ status: 400, json: { erro: "x", ligar: LIGAR } }]);
    await montar();
    await escolherArquivo();
    expect($("[data-ligar-colunas]")).toBeTruthy();
    await clicar("[data-importar-o-que='unidades']");
    expect($("[data-ligar-colunas]")).toBeNull();
    expect($("[data-campo='arquivo']")).toBeTruthy();
  });
});
