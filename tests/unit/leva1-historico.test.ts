/**
 * Leva 1 — editar Formulários e Checklists de veículo SEM apagar o histórico.
 * Rotas reais, banco em memória. Prova:
 *  - editar um formulário que já tem respostas salva sem erro; respostas antigas intactas;
 *    campo removido vira inativo, some do preenchimento novo e continua no registro antigo;
 *  - campo já respondido cuja pergunta muda ganha nova versão (a resposta antiga fica com a pergunta original);
 *  - o mesmo para checklist de veículo com checklists já preenchidos;
 *  - edição parcial (sem lista de campos/itens não mexe em nada) e id de outro pai é recusado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { permissoesTotais } from "@/lib/permissoes";
import type { Banco, Linha } from "./helpers/banco-memoria";
import { planejarFilhos } from "@/lib/sincronizar-filhos";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  const campo = (c: Linha, T: (m: string) => Linha[]) => {
    const respostas = T("atividadeResposta").filter((r) => r.campoId === c.id);
    const respostasEquipamento = T("respostaFormularioEquipamento").filter((r) => r.campoId === c.id);
    return { ...c, respostas, respostasEquipamento, _count: { respostas: respostas.length, respostasEquipamento: respostasEquipamento.length } };
  };
  const formulario = (f: Linha, T: (m: string) => Linha[]) => ({
    ...f, tipoOs: null, campos: T("formularioCampo").filter((c) => c.formularioId === f.id).sort((a, b) => a.ordem - b.ordem).map((c) => campo(c, T)),
  });
  return {
    prisma: criarPrisma(db, {
      formularioCampo: (r, T) => campo(r, T),
      formularioTemplate: (r, T) => formulario(r, T),
      formTypeMapping: (r, T) => ({ formularioTemplate: formulario(T("formularioTemplate").find((f) => f.id === r.formularioTemplateId)!, T) }),
      atividadeEquipamento: (r, T) => ({ equipamento: { ...T("equipamento").find((e) => e.id === r.equipamentoId), tipoEquipamento: { id: "te1", nome: "Split" } } }),
      atividadeOs: () => ({ tipoOs: null, tecnico: null, equipe: null, tecnicosEquipe: [], veiculo: null, respostas: [] }),
      checklistItemTemplate: (r, T) => ({ _count: { itensPreenchidos: T("checklistItemPreenchido").filter((i) => i.itemTemplateId === r.id).length } }),
      checklistTemplate: (r, T) => ({ itens: T("checklistItemTemplate").filter((i) => i.templateId === r.id).sort((a, b) => a.ordem - b.ordem) }),
    }),
  };
});
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const CAMPO = (id: string, label: string, ordem: number, extra: Linha = {}) =>
  ({ id, formularioId: "f1", label, tipo: "TEXTO_CURTO", obrigatorio: true, ordem, opcoes: null, ativo: true, ...extra });
const RESP = (id: string, atividadeId: string, equipamentoId: string, campoId: string, resposta: string) =>
  ({ id, empresaId: "e1", atividadeId, equipamentoId, formularioId: "f1", campoId, resposta, arquivoUrl: null });
const ITEM = (id: string, descricao: string, ordem: number) =>
  ({ id, templateId: "ckA", categoria: "Geral", descricao, tipo: "OK_NOK", opcoes: ["OK", "NOK"], obrigatorio: true, ordem, ativo: true });

function semear() {
  db.escritas = [];
  db.t = {
    tipoOs: [{ id: "to1", empresaId: "e1", nome: "Preventiva", ativo: true }],
    ordemServico: [{ id: "os1", empresaId: "e1", numero: "OS-1" }],
    // aOld: atividade antiga, já respondida. aNew: atividade nova, em andamento.
    atividadeOs: [
      { id: "aOld", empresaId: "e1", ordemServicoId: "os1", titulo: "Preventiva de março", status: "CONCLUIDA", tipoOsId: "to1", tecnicoId: null, equipeId: null },
      { id: "aNew", empresaId: "e1", ordemServicoId: "os1", titulo: "Preventiva de abril", status: "EM_ANDAMENTO", tipoOsId: "to1", tecnicoId: null, equipeId: null },
    ],
    equipamento: [{ id: "eqp1", empresaId: "e1", nome: "Split sala", tipoEquipamentoId: "te1" }],
    atividadeEquipamento: [
      { id: "ae1", atividadeId: "aOld", equipamentoId: "eqp1", feito: true, criadoEm: new Date() },
      { id: "ae2", atividadeId: "aNew", equipamentoId: "eqp1", feito: true, criadoEm: new Date() },
    ],
    formularioTemplate: [
      { id: "f1", empresaId: "e1", nome: "PMOC Split", ativo: true, tipoOsId: "to1", descricao: null },
      { id: "fB", empresaId: "e2", nome: "Da outra", ativo: true, tipoOsId: null },
    ],
    formularioCampo: [
      CAMPO("c1", "Pressão", 1), CAMPO("c2", "Temperatura", 2), CAMPO("c3", "Corrente", 3),
      { ...CAMPO("cX", "De outro formulário", 1), formularioId: "fB" },
    ],
    formTypeMapping: [{ id: "m1", empresaId: "e1", tipoOsId: "to1", tipoEquipamentoId: "te1", formularioTemplateId: "f1", obrigatorioConcluir: true, obrigatorioImpedimento: false }],
    respostaFormularioEquipamento: [RESP("r1", "aOld", "eqp1", "c1", "120 psi"), RESP("r2", "aOld", "eqp1", "c2", "18 °C"), RESP("r3", "aOld", "eqp1", "c3", "7 A")],
    atividadeResposta: [{ id: "ar1", atividadeId: "aOld", campoId: "c2", formularioId: "f1", resposta: "18 °C", arquivoUrl: null }],
    // Checklist de veículo com um preenchido antigo
    veiculo: [{ id: "v1", empresaId: "e1", placa: "AAA1A11" }],
    checklistTemplate: [{ id: "ckA", empresaId: "e1", nome: "Diário", descricao: null, frequencia: "SEMANAL", ativo: true }],
    checklistItemTemplate: [ITEM("iA", "Pneus", 0), ITEM("iB", "Faróis", 1), ITEM("iC", "Óleo", 2)],
    checklistPreenchido: [{ id: "p1", empresaId: "e1", veiculoId: "v1", templateId: "ckA", status: "CONCLUIDO" }],
    checklistItemPreenchido: [
      { id: "ip1", checklistId: "p1", itemTemplateId: "iA", valor: "OK", alerta: false },
      { id: "ip2", checklistId: "p1", itemTemplateId: "iB", valor: "NOK", alerta: true },
      { id: "ip3", checklistId: "p1", itemTemplateId: "iC", valor: "OK", alerta: false },
    ],
  };
}

beforeEach(() => {
  semear();
  sessao.atual = { user: { id: "u1", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "OPERADOR", permissoes: permissoesTotais() } };
});

async function chamar(carregar: () => Promise<any>, metodo: string, params: Record<string, string>, corpo?: unknown) {
  const mod = await carregar();
  const req = new NextRequest("http://localhost/api/x", {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const linha = (m: string, id: string) => db.t[m].find((r) => r.id === id)!;
const copia = (m: string) => JSON.parse(JSON.stringify(db.t[m]));

const formulario = () => import("@/app/api/formularios/[id]/route");
const formularios = () => import("@/app/api/formularios/route");
const execForms = () => import("@/app/api/ordens/[id]/atividades/[atividadeId]/formularios/route");
const atividade = () => import("@/app/api/ordens/[id]/atividades/[atividadeId]/route");
const gruposRespostas = () => import("@/app/api/ordens/[id]/atividades/[atividadeId]/grupos/respostas/route");
const respostasLegado = () => import("@/app/api/ordens/[id]/atividades/[atividadeId]/respostas/route");

/** O que a tela manda ao salvar: os campos que ficaram (com id) + os novos (sem id). */
const editarSemTemperatura = {
  nome: "PMOC Split",
  campos: [
    { id: "c1", label: "Pressão", tipo: "TEXTO_CURTO", obrigatorio: true, ordem: 1 },
    { id: "c3", label: "Corrente", tipo: "TEXTO_CURTO", obrigatorio: false, ordem: 2 }, // só mudou obrigatório/ordem
    { label: "Tensão", tipo: "NUMERO", obrigatorio: true, ordem: 3 },
  ],
};
const campoIds = (grupo: Linha) => grupo.formulario.campos.map((c: Linha) => c.id);

// ─────────────────────────────────────────────
describe("formulário com respostas: editar sem apagar", () => {
  it("salva sem erro, não apaga nada e as respostas antigas ficam intactas", async () => {
    const respostasAntes = copia("respostaFormularioEquipamento");
    const legadoAntes = copia("atividadeResposta");
    const r = await chamar(formulario, "PUT", { id: "f1" }, editarSemTemperatura);
    expect(r.status).toBe(200);
    expect(db.escritas.filter((e) => e.includes("delete"))).toEqual([]);
    expect(db.t.respostaFormularioEquipamento).toEqual(respostasAntes);
    expect(db.t.atividadeResposta).toEqual(legadoAntes);
  });

  it("campo removido vira inativo (fica no banco com a pergunta original); os outros são atualizados no lugar; o novo é criado", async () => {
    await chamar(formulario, "PUT", { id: "f1" }, editarSemTemperatura);
    expect(linha("formularioCampo", "c2")).toMatchObject({ ativo: false, label: "Temperatura" });
    expect(linha("formularioCampo", "c1")).toMatchObject({ ativo: true, label: "Pressão", ordem: 1 });
    expect(linha("formularioCampo", "c3")).toMatchObject({ ativo: true, obrigatorio: false, ordem: 2 });
    const novo = db.t.formularioCampo.find((c) => c.label === "Tensão")!;
    expect(novo).toMatchObject({ formularioId: "f1", ativo: true, tipo: "NUMERO" });
    // A resposta da tela de configuração e a lista só trazem os campos ativos
    const lista = await chamar(formularios, "GET", {});
    expect(lista.json.find((f: Linha) => f.id === "f1").campos.map((c: Linha) => c.label)).toEqual(["Pressão", "Corrente", "Tensão"]);
  });

  it("preenchimento NOVO não mostra o campo removido; o registro ANTIGO continua mostrando (com a resposta, sem ser obrigatório)", async () => {
    await chamar(formulario, "PUT", { id: "f1" }, editarSemTemperatura);
    const nova = await chamar(execForms, "GET", { id: "os1", atividadeId: "aNew" });
    expect(campoIds(nova.json.grupos[0])).not.toContain("c2");
    expect(nova.json.grupos[0].formulario.campos.map((c: Linha) => c.label)).toEqual(["Pressão", "Corrente", "Tensão"]);

    const antiga = await chamar(execForms, "GET", { id: "os1", atividadeId: "aOld" });
    const c2 = antiga.json.grupos[0].formulario.campos.find((c: Linha) => c.id === "c2");
    expect(c2).toMatchObject({ label: "Temperatura", ativo: false, obrigatorio: false });
    // c1 e c3 respondidos (o novo "Tensão" não): 2 de 3 ativos
    expect(antiga.json.grupos[0].equipamentos[0]).toMatchObject({ respondidos: 2, completo: false });
  });

  it("concluir a atividade nova exige só os campos ativos (o removido não trava)", async () => {
    await chamar(formulario, "PUT", { id: "f1" }, editarSemTemperatura);
    const tensao = db.t.formularioCampo.find((c) => c.label === "Tensão")!.id;
    expect((await chamar(atividade, "PUT", { id: "os1", atividadeId: "aNew" }, { status: "CONCLUIDA" })).status).toBe(400);
    const salvar = await chamar(gruposRespostas, "POST", { id: "os1", atividadeId: "aNew" }, {
      tipoEquipamentoId: "te1", formularioId: "f1",
      respostas: [{ campoId: "c1", resposta: "110 psi" }, { campoId: "c3", resposta: "6 A" }, { campoId: tensao, resposta: "220" }, { campoId: "c2", resposta: "ignorada" }],
    });
    expect(salvar.json).toMatchObject({ ok: true, camposPorEquipamento: 3 }); // c2 (removido) não entra em atividade nova
    expect(db.t.respostaFormularioEquipamento.some((r) => r.atividadeId === "aNew" && r.campoId === "c2")).toBe(false);
    expect((await chamar(atividade, "PUT", { id: "os1", atividadeId: "aNew" }, { status: "CONCLUIDA" })).status).toBe(200);
  });

  it("o registro antigo pode ser regravado com o campo removido (já respondido nele)", async () => {
    await chamar(formulario, "PUT", { id: "f1" }, editarSemTemperatura);
    const r = await chamar(gruposRespostas, "POST", { id: "os1", atividadeId: "aOld" }, {
      tipoEquipamentoId: "te1", formularioId: "f1", respostas: [{ campoId: "c2", resposta: "19 °C" }],
    });
    expect(r.json).toMatchObject({ ok: true, camposPorEquipamento: 1 });
  });

  it("mudar a PERGUNTA de um campo já respondido cria nova versão; a resposta antiga fica com a pergunta original", async () => {
    const r = await chamar(formulario, "PUT", { id: "f1" }, {
      campos: [
        { id: "c1", label: "Pressão de sucção", tipo: "TEXTO_CURTO", obrigatorio: true, ordem: 1 },
        { id: "c2", label: "Temperatura", tipo: "TEXTO_CURTO", obrigatorio: true, ordem: 2 },
        { id: "c3", label: "Corrente", tipo: "TEXTO_CURTO", obrigatorio: true, ordem: 3 },
      ],
    });
    expect(r.status).toBe(200);
    expect(linha("formularioCampo", "c1")).toMatchObject({ ativo: false, label: "Pressão" });
    expect(linha("respostaFormularioEquipamento", "r1")).toMatchObject({ campoId: "c1", resposta: "120 psi" });
    const v2 = db.t.formularioCampo.find((c) => c.label === "Pressão de sucção")!;
    expect(v2).toMatchObject({ ativo: true, formularioId: "f1" });
    expect(v2.id).not.toBe("c1");
    expect(r.json.campos.map((c: Linha) => c.label)).toEqual(["Pressão de sucção", "Temperatura", "Corrente"]);
  });

  it("campo SEM resposta é atualizado no lugar mesmo mudando a pergunta", async () => {
    db.t.respostaFormularioEquipamento = db.t.respostaFormularioEquipamento.filter((x) => x.campoId !== "c3");
    await chamar(formulario, "PUT", { id: "f1" }, { campos: [{ id: "c3", label: "Corrente (A)", tipo: "NUMERO", ordem: 1 }] });
    expect(linha("formularioCampo", "c3")).toMatchObject({ ativo: true, label: "Corrente (A)", tipo: "NUMERO" });
  });

  it("edição parcial: sem `campos` no corpo, os campos não mudam", async () => {
    const antes = copia("formularioCampo");
    expect((await chamar(formulario, "PUT", { id: "f1" }, { nome: "PMOC Split v2" })).status).toBe(200);
    expect(db.t.formularioCampo).toEqual(antes);
    expect(linha("formularioTemplate", "f1")).toMatchObject({ nome: "PMOC Split v2", tipoOsId: "to1" });
  });

  it("id de campo de OUTRO formulário é recusado sem gravar nada", async () => {
    const antes = copia("formularioCampo");
    const r = await chamar(formulario, "PUT", { id: "f1" }, { campos: [{ id: "cX", label: "Invadido", tipo: "TEXTO_CURTO" }] });
    expect(r.status).toBe(400);
    expect(db.t.formularioCampo).toEqual(antes);
    expect(linha("formularioCampo", "cX").formularioId).toBe("fB");
  });

  it("rota de respostas por atividade: formulário de outra empresa e campo removido não respondido são recusados", async () => {
    await chamar(formulario, "PUT", { id: "f1" }, editarSemTemperatura);
    expect((await chamar(respostasLegado, "POST", { id: "os1", atividadeId: "aNew" }, { formularioId: "fB", respostas: [{ campoId: "cX", resposta: "x" }] })).json.erro)
      .toBe("Formulário inválido(a).");
    expect((await chamar(respostasLegado, "POST", { id: "os1", atividadeId: "aNew" }, { formularioId: "f1", respostas: [{ campoId: "c2", resposta: "x" }] })).status).toBe(400);
    // Na atividade antiga, onde c2 já foi respondido, continua aceitando
    expect((await chamar(respostasLegado, "POST", { id: "os1", atividadeId: "aOld" }, { formularioId: "f1", respostas: [{ campoId: "c2", resposta: "19 °C" }] })).status).toBe(200);
  });
});

// ─────────────────────────────────────────────
describe("checklist de veículo com histórico: editar sem apagar", () => {
  const modelo = () => import("@/app/api/checklist-templates/[id]/route");
  const modelos = () => import("@/app/api/checklist-templates/route");
  const checklists = () => import("@/app/api/checklists/route");
  const editarSemFarois = {
    itens: [
      { id: "iA", categoria: "Geral", descricao: "Pneus", tipo: "OK_NOK", opcoes: ["OK", "NOK"], obrigatorio: false },
      { id: "iC", categoria: "Geral", descricao: "Óleo", tipo: "OK_NOK", opcoes: ["OK", "NOK"], obrigatorio: true },
      { categoria: "Segurança", descricao: "Extintor", tipo: "OK_NOK", opcoes: ["OK", "NOK"], obrigatorio: true },
    ],
  };

  it("salva sem erro; item removido vira inativo; o checklist já preenchido fica intacto apontando para ele", async () => {
    const preenchidosAntes = copia("checklistItemPreenchido");
    const r = await chamar(modelo, "PUT", { id: "ckA" }, editarSemFarois);
    expect(r.status).toBe(200);
    expect(db.escritas.filter((e) => e.includes("delete"))).toEqual([]);
    expect(db.t.checklistItemPreenchido).toEqual(preenchidosAntes);
    expect(linha("checklistItemTemplate", "iB")).toMatchObject({ ativo: false, descricao: "Faróis" });
    expect(linha("checklistItemPreenchido", "ip2")).toMatchObject({ itemTemplateId: "iB", valor: "NOK", alerta: true });
    expect(linha("checklistItemTemplate", "iA")).toMatchObject({ ativo: true, obrigatorio: false, ordem: 0 });
    expect(db.t.checklistItemTemplate.find((i) => i.descricao === "Extintor")).toMatchObject({ templateId: "ckA", ativo: true, ordem: 2 });
    expect(r.json.itens.map((i: Linha) => i.descricao)).toEqual(["Pneus", "Óleo", "Extintor"]);
  });

  it("preenchimento novo só vê/aceita itens ativos", async () => {
    await chamar(modelo, "PUT", { id: "ckA" }, editarSemFarois);
    const lista = await chamar(modelos, "GET", {});
    expect(lista.json[0].itens.map((i: Linha) => i.id)).not.toContain("iB");
    expect((await chamar(modelo, "GET", { id: "ckA" })).json.itens.map((i: Linha) => i.id)).not.toContain("iB");
    const comRemovido = await chamar(checklists, "POST", {}, { veiculoId: "v1", templateId: "ckA", itens: [{ itemTemplateId: "iB", valor: "OK" }] });
    expect(comRemovido.status).toBe(400);
    expect((await chamar(checklists, "POST", {}, { veiculoId: "v1", templateId: "ckA", itens: [{ itemTemplateId: "iA", valor: "OK" }] })).status).toBe(201);
  });

  it("mudar o texto de um item já usado cria nova versão (o preenchido antigo fica com o texto original)", async () => {
    await chamar(modelo, "PUT", { id: "ckA" }, {
      itens: [{ id: "iA", categoria: "Geral", descricao: "Pneus e estepe", tipo: "OK_NOK", opcoes: ["OK", "NOK"] }, { id: "iB", categoria: "Geral", descricao: "Faróis", tipo: "OK_NOK", opcoes: ["OK", "NOK"] }, { id: "iC", categoria: "Geral", descricao: "Óleo", tipo: "OK_NOK", opcoes: ["OK", "NOK"] }],
    });
    expect(linha("checklistItemTemplate", "iA")).toMatchObject({ ativo: false, descricao: "Pneus" });
    expect(linha("checklistItemPreenchido", "ip1").itemTemplateId).toBe("iA");
    expect(db.t.checklistItemTemplate.find((i) => i.descricao === "Pneus e estepe")).toMatchObject({ ativo: true, templateId: "ckA" });
  });

  it("edição parcial: só o nome não mexe em itens, frequência nem status do modelo", async () => {
    linha("checklistTemplate", "ckA").ativo = false;
    const antes = copia("checklistItemTemplate");
    expect((await chamar(modelo, "PUT", { id: "ckA" }, { nome: "Diário v2" })).status).toBe(200);
    expect(db.t.checklistItemTemplate).toEqual(antes);
    expect(linha("checklistTemplate", "ckA")).toMatchObject({ nome: "Diário v2", frequencia: "SEMANAL", ativo: false });
  });

  it("id de item de outro modelo é recusado sem gravar nada", async () => {
    db.t.checklistItemTemplate.push({ ...ITEM("iZ", "De outro modelo", 0), templateId: "ckZ" });
    const antes = copia("checklistItemTemplate");
    const r = await chamar(modelo, "PUT", { id: "ckA" }, { itens: [{ id: "iZ", categoria: "x", descricao: "x" }] });
    expect(r.status).toBe(400);
    expect(db.t.checklistItemTemplate).toEqual(antes);
  });
});

// ─────────────────────────────────────────────
describe("planejarFilhos", () => {
  const ex = [{ id: "a", ativo: true }, { id: "b", ativo: true }, { id: "c", ativo: false }];
  it("atualiza quem veio, inativa quem saiu, cria os novos, reativa inativo que voltou", () => {
    const p = planejarFilhos(ex, [{ id: "a", v: 1 }, { id: "c", v: 2 }, { v: 3 }]);
    expect(p.atualizar.map((x) => x.id)).toEqual(["a", "c"]);
    expect(p.inativar).toEqual(["b"]);
    expect(p.criar).toEqual([{ v: 3 }]);
    expect(p.invalidos).toEqual([]);
  });
  it("id de outro pai ou repetido é inválido", () => {
    expect(planejarFilhos(ex, [{ id: "zzz" }, { id: "a" }, { id: "a" }]).invalidos).toEqual(["zzz", "a"]);
  });
  it("versionar: o antigo é inativado e entra um novo com o conteúdo enviado", () => {
    const p = planejarFilhos(ex, [{ id: "a", v: "novo" }, { id: "b", v: "igual" }], { versionar: (e) => e.id === "a" });
    expect(p.inativar).toEqual(["a"]);
    expect(p.criar).toEqual([{ v: "novo" }]);
    expect(p.atualizar.map((x) => x.id)).toEqual(["b"]);
  });
});
