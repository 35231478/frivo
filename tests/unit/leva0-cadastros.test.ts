/**
 * Leva 0 — correções urgentes de cadastros (sem banco). Rotas reais, banco em memória com DUAS
 * empresas (e1 = a do usuário logado, e2 = outra empresa). Cada bloco prova um conserto:
 *  1. reeditar atividade cujo técnico/equipe foi inativado salva normal (inativo só é barrado como vínculo NOVO);
 *  2. produtos: Reativar não zera valor/estoque; campo numérico vazio vira null sem erro;
 *  3. formulários: PUT não troca empresa nem zera o tipo de OS; formulário inativo não trava a conclusão;
 *  4. isolamento: GET de veículo/equipe exige o módulo e só acha a própria empresa; vínculo de outra empresa é recusado;
 *  5. (em sessao-ativa.test.ts) usuário inativado perde a sessão na requisição seguinte.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import type { Banco, Linha } from "./helpers/banco-memoria";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  const formulario = (f: Linha, T: (m: string) => Linha[]) => {
    const campos = T("formularioCampo").filter((c) => c.formularioId === f.id);
    return { ...f, campos, _count: { campos: campos.length }, tipoOs: null };
  };
  return {
    prisma: criarPrisma(db, {
      tecnico: (r) => ({ competencias: (r.competenciaIds ?? []).map((id: string) => ({ id })) }),
      formularioTemplate: (r, T) => formulario(r, T),
      formTypeMapping: (r, T) => ({ formularioTemplate: formulario(T("formularioTemplate").find((f) => f.id === r.formularioTemplateId)!, T) }),
      atividadeEquipamento: (r, T) => ({ equipamento: { ...T("equipamento").find((e) => e.id === r.equipamentoId), tipoEquipamento: { id: "te1", nome: "Split" } } }),
      atividadeOs: () => ({ tipoOs: null, tecnico: null, equipe: null, tecnicosEquipe: [], veiculo: null, respostas: [] }),
      equipe: () => ({ membros: [], veiculos: [] }),
      veiculo: () => ({ responsavel: null, equipe: null, documentos: [], manutencoes: [], _count: { manutencoes: 0, checklists: 0 } }),
    }),
  };
});
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/financeiro-server", () => ({ gerarPrevisaoContratoContasReceber: vi.fn(async () => 0) }));
vi.mock("@/lib/recorrencia-server", () => ({ gerarOsRecorrentesLocais: vi.fn(async () => 0), gerarOsRecorrentesContrato: vi.fn(async () => 0) }));

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes } };
};

function semear() {
  db.escritas = [];
  db.t = {
    tipoOs: [{ id: "to1", empresaId: "e1", nome: "Preventiva", ativo: true }, { id: "toB", empresaId: "e2", nome: "Da outra", ativo: true }],
    tecnico: [
      { id: "t1", empresaId: "e1", nome: "Técnico Inativado", ativo: false, competenciaIds: [] },
      { id: "t2", empresaId: "e1", nome: "Técnico Ativo", ativo: true, competenciaIds: [] },
      { id: "t3", empresaId: "e1", nome: "Outro Inativo", ativo: false, competenciaIds: [] },
      { id: "tB", empresaId: "e2", nome: "Da outra empresa", ativo: true, competenciaIds: [] },
    ],
    equipe: [
      { id: "eq1", empresaId: "e1", nome: "Equipe Antiga", status: "INATIVA", liderId: "t1" },
      { id: "eq2", empresaId: "e1", nome: "Equipe Inativa 2", status: "INATIVA", liderId: null },
      { id: "eqB", empresaId: "e2", nome: "Equipe da outra", status: "ATIVA", liderId: null },
    ],
    ordemServico: [{ id: "os1", empresaId: "e1", numero: "OS-1", status: "EM_ANDAMENTO" }],
    atividadeOs: [
      { id: "a1", empresaId: "e1", ordemServicoId: "os1", titulo: "Visita antiga", status: "PENDENTE", tipoOsId: null, tecnicoId: "t1", equipeId: "eq1", veiculoId: null, duracaoMin: null, observacao: null },
      { id: "a2", empresaId: "e1", ordemServicoId: "os1", titulo: "Preventiva", status: "EM_ANDAMENTO", tipoOsId: "to1", tecnicoId: "t2", equipeId: null, veiculoId: null },
    ],
    atividadeTecnico: [{ id: "at1", atividadeId: "a1", tecnicoId: "t2" }],
    equipamento: [{ id: "eqp1", empresaId: "e1", nome: "Split sala", tipoEquipamentoId: "te1" }],
    atividadeEquipamento: [{ id: "ae1", atividadeId: "a2", equipamentoId: "eqp1", feito: true, criadoEm: new Date() }],
    formularioTemplate: [
      { id: "f1", empresaId: "e1", nome: "PMOC Split", ativo: false, tipoOsId: "to1", descricao: null },
      { id: "fB", empresaId: "e2", nome: "Da outra", ativo: true, tipoOsId: null },
    ],
    formularioCampo: [{ id: "c1", formularioId: "f1", label: "Pressão", tipo: "TEXTO_CURTO", obrigatorio: true, ordem: 1, ativo: true }],
    formTypeMapping: [{ id: "m1", empresaId: "e1", tipoOsId: "to1", tipoEquipamentoId: "te1", formularioTemplateId: "f1", obrigatorioConcluir: true, obrigatorioImpedimento: true }],
    respostaFormularioEquipamento: [],
    produto: [
      { id: "p1", empresaId: "e1", nome: "Gás R410A", unidade: "kg", valorPadrao: 150, estoqueMinimo: 5, ativo: false },
      { id: "pB", empresaId: "e2", nome: "Da outra", unidade: "un", valorPadrao: 1, estoqueMinimo: 1, ativo: true },
    ],
    servico: [{ id: "sA", empresaId: "e1", nome: "Limpeza", ativo: true }, { id: "sB", empresaId: "e2", nome: "Da outra", ativo: true }],
    veiculo: [
      { id: "v1", empresaId: "e1", placa: "AAA1A11", status: "ATIVO" },
      { id: "vB", empresaId: "e2", placa: "BBB2B22", status: "ATIVO" },
    ],
    cargo: [{ id: "cargoA", empresaId: "e1", nome: "Técnico", ativo: true }, { id: "cargoB", empresaId: "e2", nome: "Da outra", ativo: true }],
    perfilAcesso: [{ id: "perfA", empresaId: "e1", nome: "Técnico", ativo: true }, { id: "perfB", empresaId: "e2", nome: "Da outra", ativo: true }],
    tabelaPreco: [{ id: "tabA", empresaId: "e1", nome: "Padrão", ativo: true }, { id: "tabB", empresaId: "e2", nome: "Da outra", ativo: true }],
    cliente: [
      { id: "c1", empresaId: "e1", nome: "Cliente A", cpfCnpj: "12345678000199", ativo: true, tabelaPrecoId: null },
      { id: "cB", empresaId: "e2", nome: "Cliente B", cpfCnpj: "98765432000188", ativo: true },
    ],
    unidade: [{ id: "u1", empresaId: "e1", clienteId: "c1", nome: "Matriz" }, { id: "uB", empresaId: "e2", clienteId: "cB", nome: "Outra" }],
    checklistTemplate: [{ id: "ckA", empresaId: "e1", nome: "Diário", ativo: true }, { id: "ckB", empresaId: "e2", nome: "Da outra", ativo: true }],
    checklistItemTemplate: [{ id: "iA", templateId: "ckA", descricao: "Pneus", ativo: true }, { id: "iB", templateId: "ckB", descricao: "Da outra", ativo: true }],
  };
}

beforeEach(() => { semear(); logar(); });

type Params = Record<string, string>;
async function chamar(carregar: () => Promise<any>, metodo: string, params: Params, corpo?: unknown) {
  const mod = await carregar();
  const req = new NextRequest("http://localhost/api/x", {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const linha = (m: string, id: string) => db.t[m].find((r) => r.id === id)!;
const criou = (m: string) => db.escritas.some((e) => e.startsWith(`${m}.create`));

const REF = /inválido\(a\)\./; // mensagem do validarRefEmpresa (não confundir com "Dados inválidos" do schema)
const atividade = () => import("@/app/api/ordens/[id]/atividades/[atividadeId]/route");
const atividades = () => import("@/app/api/ordens/[id]/atividades/route");
const execForms = () => import("@/app/api/ordens/[id]/atividades/[atividadeId]/formularios/route");

// ─────────────────────────────────────────────
describe("1. reeditar atividade com técnico/equipe inativados", () => {
  const corpoEdicao = (extra: Linha = {}) => ({ titulo: "Visita antiga (editada)", tecnicoIds: ["t1", "t2"], responsavelId: "t1", equipeId: "eq1", veiculoId: null, ...extra });

  it("salva normal mantendo o técnico e a equipe que já estavam na atividade", async () => {
    const r = await chamar(atividade, "PUT", { id: "os1", atividadeId: "a1" }, corpoEdicao());
    expect(r.status).toBe(200);
    expect(linha("atividadeOs", "a1")).toMatchObject({ titulo: "Visita antiga (editada)", tecnicoId: "t1", equipeId: "eq1" });
  });

  it("técnico inativo NOVO (não estava na atividade) continua barrado", async () => {
    const r = await chamar(atividade, "PUT", { id: "os1", atividadeId: "a1" }, corpoEdicao({ tecnicoIds: ["t1", "t3"] }));
    expect(r.status).toBe(400);
    expect(r.json.erro).toMatch(/inativos/);
  });

  it("equipe inativa NOVA continua barrada", async () => {
    const r = await chamar(atividade, "PUT", { id: "os1", atividadeId: "a1" }, corpoEdicao({ equipeId: "eq2" }));
    expect(r.status).toBe(400);
    expect(r.json.erro).toMatch(/Equipe inválida ou inativa/);
  });

  it("técnico e equipe de outra empresa são recusados", async () => {
    expect((await chamar(atividade, "PUT", { id: "os1", atividadeId: "a1" }, corpoEdicao({ tecnicoIds: ["tB"], responsavelId: "tB" }))).status).toBe(400);
    expect((await chamar(atividade, "PUT", { id: "os1", atividadeId: "a1" }, corpoEdicao({ equipeId: "eqB" }))).status).toBe(400);
  });
});

// ─────────────────────────────────────────────
describe("2. produtos", () => {
  const produtos = () => import("@/app/api/produtos/route");
  const produto = () => import("@/app/api/produtos/[id]/route");

  it("Reativar (só { ativo: true }) mantém valor padrão e estoque mínimo", async () => {
    const r = await chamar(produto, "PUT", { id: "p1" }, { ativo: true });
    expect(r.status).toBe(200);
    expect(linha("produto", "p1")).toMatchObject({ ativo: true, valorPadrao: 150, estoqueMinimo: 5, nome: "Gás R410A", unidade: "kg" });
  });

  it("criar com campos numéricos vazios não quebra (vira null)", async () => {
    const r = await chamar(produtos, "POST", {}, { nome: "Fita", unidade: "", valorPadrao: "", estoqueMinimo: "" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ nome: "Fita", unidade: "un", valorPadrao: null, estoqueMinimo: null, empresaId: "e1" });
  });

  it("editar com campos numéricos vazios não quebra (limpa o valor) e aceita vírgula", async () => {
    expect((await chamar(produto, "PUT", { id: "p1" }, { nome: "Gás R410A", valorPadrao: "", estoqueMinimo: "" })).status).toBe(200);
    expect(linha("produto", "p1")).toMatchObject({ valorPadrao: null, estoqueMinimo: null });
    expect((await chamar(produto, "PUT", { id: "p1" }, { valorPadrao: "12,5", estoqueMinimo: "3" })).status).toBe(200);
    expect(linha("produto", "p1")).toMatchObject({ valorPadrao: 12.5, estoqueMinimo: 3 });
  });

  it("número inválido vira 400 com mensagem (não 500)", async () => {
    const r = await chamar(produto, "PUT", { id: "p1" }, { estoqueMinimo: "1.5" });
    expect(r.status).toBe(400);
    expect(r.json.erro).toMatch(/inteiro/);
  });

  it("o corpo não troca a empresa nem o id (Leva 2: campo desconhecido é RECUSADO, não só ignorado)", async () => {
    const r = await chamar(produto, "PUT", { id: "p1" }, { empresaId: "e2", id: "outro", nome: "Gás" });
    expect(r.status).toBe(400);
    expect(r.json.erro).toMatch(/Campo não permitido: .*empresaId/);
    expect(linha("produto", "p1")).toMatchObject({ empresaId: "e1", nome: "Gás R410A" });
  });

  it("produto de outra empresa: 404", async () => {
    expect((await chamar(produto, "PUT", { id: "pB" }, { ativo: false })).status).toBe(404);
    expect(linha("produto", "pB").ativo).toBe(true);
  });
});

// ─────────────────────────────────────────────
describe("3. formulários", () => {
  const formulario = () => import("@/app/api/formularios/[id]/route");
  const formularios = () => import("@/app/api/formularios/route");

  it("PUT não consegue mudar a empresa do formulário", async () => {
    const r = await chamar(formulario, "PUT", { id: "f1" }, { nome: "PMOC Split v2", empresaId: "e2" });
    expect(r.status).toBe(200);
    expect(linha("formularioTemplate", "f1")).toMatchObject({ empresaId: "e1", nome: "PMOC Split v2" });
  });

  it("PUT sem tipoOsId mantém o tipo de OS (edição parcial); null limpa", async () => {
    await chamar(formulario, "PUT", { id: "f1" }, { descricao: "nova" });
    expect(linha("formularioTemplate", "f1").tipoOsId).toBe("to1");
    await chamar(formulario, "PUT", { id: "f1" }, { tipoOsId: null });
    expect(linha("formularioTemplate", "f1").tipoOsId).toBeNull();
  });

  it("tipo de OS de outra empresa é recusado (PUT e POST)", async () => {
    expect((await chamar(formulario, "PUT", { id: "f1" }, { tipoOsId: "toB" })).json.erro).toBe("Tipo de OS inválido(a).");
    expect(linha("formularioTemplate", "f1").tipoOsId).toBe("to1");
    expect((await chamar(formularios, "POST", {}, { nome: "Novo", tipoOsId: "toB" })).json.erro).toBe("Tipo de OS inválido(a).");
    expect(criou("formularioTemplate")).toBe(false);
  });

  it("formulário de outra empresa: 404", async () => {
    expect((await chamar(formulario, "PUT", { id: "fB" }, { nome: "x" })).status).toBe(404);
  });

  it("concluir atividade com formulário obrigatório INATIVO funciona", async () => {
    const r = await chamar(atividade, "PUT", { id: "os1", atividadeId: "a2" }, { status: "CONCLUIDA" });
    expect(r.status).toBe(200);
    expect(linha("atividadeOs", "a2").status).toBe("CONCLUIDA");
  });

  it("controle: com o formulário ATIVO e sem resposta, a conclusão continua bloqueada", async () => {
    linha("formularioTemplate", "f1").ativo = true;
    const r = await chamar(atividade, "PUT", { id: "os1", atividadeId: "a2" }, { status: "CONCLUIDA" });
    expect(r.status).toBe(400);
    expect(r.json.erro).toMatch(/PMOC Split/);
  });

  it("execução: formulário inativo some se a atividade não o usou; se já tem respostas, aparece sem ser obrigatório", async () => {
    let r = await chamar(execForms, "GET", { id: "os1", atividadeId: "a2" });
    expect(r.json.grupos).toHaveLength(0);
    db.t.respostaFormularioEquipamento.push({ id: "r1", atividadeId: "a2", equipamentoId: "eqp1", formularioId: "f1", campoId: "c1" });
    r = await chamar(execForms, "GET", { id: "os1", atividadeId: "a2" });
    expect(r.json.grupos).toHaveLength(1);
    expect(r.json.grupos[0]).toMatchObject({ obrigatorioConcluir: false, obrigatorioImpedimento: false, formulario: { id: "f1" } });
  });
});

// ─────────────────────────────────────────────
describe("4. isolamento entre empresas", () => {
  const veiculos = () => import("@/app/api/veiculos/route");
  const veiculo = () => import("@/app/api/veiculos/[id]/route");
  const equipe = () => import("@/app/api/equipes/[id]/route");

  it("usuário da empresa A não lê veículo nem equipe da empresa B (404)", async () => {
    expect((await chamar(veiculo, "GET", { id: "vB" })).status).toBe(404);
    expect((await chamar(equipe, "GET", { id: "eqB" })).status).toBe(404);
    expect((await chamar(veiculo, "GET", { id: "v1" })).status).toBe(200);
    expect((await chamar(equipe, "GET", { id: "eq1" })).status).toBe(200);
    const lista = await chamar(veiculos, "GET", {});
    expect(lista.json.map((v: Linha) => v.id)).toEqual(["v1"]);
  });

  it("só estar logado não basta: sem a permissão do módulo, 403", async () => {
    logar(permissoesVazias());
    expect((await chamar(veiculo, "GET", { id: "v1" })).status).toBe(403);
    expect((await chamar(veiculos, "GET", {})).status).toBe(403);
    expect((await chamar(equipe, "GET", { id: "eq1" })).status).toBe(403);
  });

  describe("vínculo apontando para id de outra empresa é recusado (400) e nada é gravado", () => {
    const tecnicos = () => import("@/app/api/tecnicos/route");
    const tecnico = () => import("@/app/api/tecnicos/[id]/route");
    const colab = (extra: Linha) => ({ nome: "Novo Colaborador", cpf: "12345678901", telefone: "11999999999", ...extra });

    it.each([
      ["cargoId", { cargoId: "cargoB" }],
      ["perfilAcessoId", { perfilAcessoId: "perfB" }],
      ["competenciaIds", { competenciaIds: ["to1", "toB"] }],
    ])("colaborador: %s", async (_n, extra) => {
      const r = await chamar(tecnicos, "POST", {}, colab(extra));
      expect(r.status).toBe(400);
      expect(r.json.erro).toMatch(REF);
      expect(criou("tecnico")).toBe(false);
      const e = await chamar(tecnico, "PUT", { id: "t2" }, colab({ ...extra, cpf: "99999999999" }));
      expect(e.status).toBe(400);
      expect(e.json.erro).toMatch(REF);
      expect(linha("tecnico", "t2").cpf).toBeUndefined();
    });

    it("colaborador com vínculos da própria empresa: grava", async () => {
      const r = await chamar(tecnicos, "POST", {}, colab({ cargoId: "cargoA", perfilAcessoId: "perfA", competenciaIds: ["to1"] }));
      expect(r.status).toBe(201);
    });

    it("cliente: tabelaPrecoId", async () => {
      const clientes = () => import("@/app/api/clientes/[id]/route");
      const base = { tipoPessoa: "JURIDICA", nome: "Cliente A", cpfCnpj: "12345678000199" };
      const r = await chamar(clientes, "PUT", { id: "c1" }, { ...base, tabelaPrecoId: "tabB" });
      expect(r.status).toBe(400);
      expect(r.json.erro).toBe("Tabela de preço inválido(a).");
      expect(linha("cliente", "c1").tabelaPrecoId).toBeNull();
      expect((await chamar(clientes, "PUT", { id: "c1" }, { ...base, tabelaPrecoId: "tabA" })).status).toBe(200);
      expect(linha("cliente", "c1").tabelaPrecoId).toBe("tabA");
    });

    it("orçamento: catalogoId e cliente", async () => {
      const orcamentos = () => import("@/app/api/orcamentos/route");
      const item = (catalogoId: string) => ({ catalogoId, descricao: "Limpeza", quantidade: 1, valorUnitario: 100 });
      expect((await chamar(orcamentos, "POST", {}, { nome: "Orç. teste", clienteId: "c1", servicos: [item("sB")] })).json.erro).toBe("Serviço do catálogo inválido(a).");
      expect((await chamar(orcamentos, "POST", {}, { nome: "Orç. teste", clienteId: "c1", produtos: [item("pB")] })).json.erro).toBe("Produto do catálogo inválido(a).");
      expect((await chamar(orcamentos, "POST", {}, { nome: "Orç. teste", clienteId: "cB", servicos: [item("sA")] })).json.erro).toBe("Cliente inválido(a).");
      expect(criou("orcamento")).toBe(false);
    });

    it("atividade: tipoOsId (criar e editar)", async () => {
      const r = await chamar(atividades, "POST", { id: "os1" }, { titulo: "Nova", tipoOsId: "toB", tecnicoIds: ["t2"] });
      expect(r.status).toBe(400);
      expect(r.json.erro).toBe("Tipo de OS inválido(a).");
      expect(criou("atividadeOs")).toBe(false);
      expect((await chamar(atividade, "PUT", { id: "os1", atividadeId: "a2" }, { tipoOsId: "toB" })).status).toBe(400);
      expect(linha("atividadeOs", "a2").tipoOsId).toBe("to1");
    });

    it("contrato: tipo de OS / técnico / local / cliente", async () => {
      const contratos = () => import("@/app/api/contratos/route");
      const base = { clienteId: "c1", numero: "CT-1", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: "2026-01-01" };
      for (const extra of [
        { tipoOsRecorrenciaId: "toB" },
        { unidadeIds: ["u1"], recorrenciasLocais: [{ unidadeId: "u1", ativa: true, tipoOsId: "toB" }] },
        { tecnicoRecorrenciaId: "tB" },
        { unidadeIds: ["uB"] },
        { clienteId: "cB" },
      ]) {
        const r = await chamar(contratos, "POST", {}, { ...base, ...extra });
        expect(r.status, JSON.stringify(extra)).toBe(400);
        expect(r.json.erro, JSON.stringify(extra)).toMatch(REF);
      }
      expect(criou("contrato")).toBe(false);
    });

    it("checklist de veículo: modelo de outra empresa e item de outro modelo", async () => {
      const checklists = () => import("@/app/api/checklists/route");
      expect((await chamar(checklists, "POST", {}, { veiculoId: "v1", templateId: "ckB", itens: [] })).json.erro).toBe("Modelo de checklist inválido(a).");
      expect((await chamar(checklists, "POST", {}, { veiculoId: "v1", templateId: "ckA", itens: [{ itemTemplateId: "iB" }] })).json.erro).toBe("Item de checklist inválido.");
      expect(criou("checklistPreenchido")).toBe(false);
      expect((await chamar(checklists, "POST", {}, { veiculoId: "v1", templateId: "ckA", itens: [{ itemTemplateId: "iA", valor: "OK" }] })).status).toBe(201);
    });
  });

  describe("validarRefEmpresa (helper único)", () => {
    it("vazio passa; id da empresa passa; de outra empresa ou inexistente é recusado", async () => {
      const { validarRefEmpresa, validarRefsEmpresa, ErroRefEmpresa } = await import("@/lib/ref-empresa");
      await expect(validarRefEmpresa("cargo", null, "e1", "Cargo")).resolves.toBeUndefined();
      await expect(validarRefEmpresa("cargo", "", "e1", "Cargo")).resolves.toBeUndefined();
      await expect(validarRefEmpresa("cargo", "cargoA", "e1", "Cargo")).resolves.toBeUndefined();
      await expect(validarRefEmpresa("cargo", "cargoB", "e1", "Cargo")).rejects.toBeInstanceOf(ErroRefEmpresa);
      await expect(validarRefEmpresa("cargo", "nao-existe", "e1", "Cargo")).rejects.toThrow("Cargo inválido");
      await expect(validarRefsEmpresa("tipoOs", ["to1", "to1", null], "e1", "Tipo")).resolves.toBeUndefined();
      await expect(validarRefsEmpresa("tipoOs", ["to1", "toB"], "e1", "Tipo")).rejects.toBeInstanceOf(ErroRefEmpresa);
    });
  });
});
