/**
 * PJ4 — pontas soltas do colaborador (Leva J), no PostgreSQL real (dados fictícios):
 *  - J3: tipo × tipoEquipe sempre coerentes — o cadastro rápido manda só `tipo` (a equipe sai dele); `tipoEquipe`
 *    vindo manda no "campo" e o `tipo` é refeito (lib/colaborador/funcao);
 *  - J5: RT sem CREA é recusado no POST e no PUT, com a mesma mensagem da edição rápida (PATCH);
 *  - J13: a recusa diz o que está errado (a 1ª mensagem do schema), e os `detalhes` continuam;
 *  - J18: especialidades sem espaço sobrando, sem repetida (maiúscula não conta), até 60 caracteres e 20 itens;
 *  - F22: apagar o e-mail de quem tem login é recusado (o login ficaria no e-mail velho, solto);
 *  - J20: o GET de Configurações › Impressão devolve a chave das especialidades, como o PUT;
 *  - J10: a atividade devolvida pelas rotas da OS traz as especialidades (e vazias com a chave desligada).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/pj4-colaborador-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais } from "@/lib/permissoes";
import { CONFIG_RELATORIO_PADRAO } from "@/lib/relatorio-os/config";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pj4_colab_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const h = vi.hoisted(() => ({ sessao: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.sessao) }));

async function rota(caminho: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/${caminho}/route`);
  const req = new NextRequest("https://app.exemplo.com/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const texto = await res.text();
  return { status: res.status, texto, json: (() => { try { return JSON.parse(texto); } catch { return null; } })() };
}

const CPFS = ["529.982.247-25", "111.444.777-35", "168.995.350-09", "390.533.447-05", "714.602.380-01"];
const base = (i: number) => ({ nome: "Carlos Oliveira", cpf: CPFS[i], telefone: "(11) 3333-4444" });

describe.skipIf(!URL_PG)("PJ4 — colaborador (PostgreSQL real)", () => {
  let prisma: any;
  const linha = (id: string) => prisma.tecnico.findUnique({ where: { id } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["api/tecnicos", "api/tecnicos/[id]", "api/configuracoes/impressao-os", "api/ordens/[id]/atividades", "api/ordens/[id]/atividades/[atividadeId]"]
      .map((r) => import(/* @vite-ignore */ `@/app/${r}/route`)));
    await prisma.empresa.create({ data: { id: "e1", nome: "Clima e1 (fictícia)", cnpj: "12.345.678/0001-90", email: "e1@x.test" } });
    await prisma.usuario.create({ data: { id: "uAdmin", empresaId: "e1", nome: "Admin", email: "admin@clima.exemplo", senha: "x", role: "ADMIN" } });
    h.sessao = { user: { id: "uAdmin", name: "Admin", email: "admin@clima.exemplo", empresaId: "e1", empresaNome: "x", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } };
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  let id = "";
  it("J3: o cadastro rápido que manda só tipo=ADMINISTRATIVO grava ADMINISTRATIVO/ADMINISTRATIVO (antes: tipoEquipe CAMPO)", async () => {
    const r = await rota("api/tecnicos", "POST", { ...base(0), tipo: "ADMINISTRATIVO", competenciaIds: [] });
    expect(r.status, r.texto).toBe(201);
    id = r.json.id;
    expect(await linha(id)).toMatchObject({ tipo: "ADMINISTRATIVO", tipoEquipe: "ADMINISTRATIVO" });
    // a ficha relê o par e, ao salvar sem mexer, não vira o tipo
    const { funcaoDaFicha, gravarFuncao } = await import("@/lib/colaborador/funcao");
    const t = await linha(id);
    const p = await rota("api/tecnicos/[id]", "PUT", { ...base(0), ...gravarFuncao(funcaoDaFicha(t), t.tipo) }, { id });
    expect(p.status, p.texto).toBe(200);
    expect(await linha(id)).toMatchObject({ tipo: "ADMINISTRATIVO", tipoEquipe: "ADMINISTRATIVO" });
  });

  it("J3: tipoEquipe vindo manda no 'campo' e o tipo é refeito; motorista sem equipe fica de campo", async () => {
    expect((await rota("api/tecnicos/[id]", "PUT", { ...base(0), tipo: "ADMINISTRATIVO", tipoEquipe: "CAMPO" }, { id })).status).toBe(200);
    expect(await linha(id)).toMatchObject({ tipo: "TECNICO_CAMPO", tipoEquipe: "CAMPO" });
    expect((await rota("api/tecnicos/[id]", "PUT", { ...base(0), tipo: "TECNICO_CAMPO", tipoEquipe: "ADMINISTRATIVO" }, { id })).status).toBe(200);
    expect(await linha(id)).toMatchObject({ tipo: "ADMINISTRATIVO", tipoEquipe: "ADMINISTRATIVO" });
    const m = await rota("api/tecnicos", "POST", { ...base(1), tipo: "MOTORISTA" });
    expect(m.status, m.texto).toBe(201);
    expect(await linha(m.json.id)).toMatchObject({ tipo: "MOTORISTA", tipoEquipe: "CAMPO" });
  });

  it("J5: RT sem CREA é recusado no POST e no PUT (a mensagem do PATCH); com CREA, passa", async () => {
    const { MSG_RT_SEM_CREA } = await import("@/lib/colaborador/funcao");
    expect(MSG_RT_SEM_CREA).toBe("Informe o CREA do responsável técnico.");
    const sem = await rota("api/tecnicos", "POST", { ...base(2), tipo: "RESPONSAVEL_TECNICO", crea: "  " });
    expect(sem).toMatchObject({ status: 400, json: { erro: MSG_RT_SEM_CREA } });
    expect(await prisma.tecnico.count({ where: { cpf: CPFS[2] } })).toBe(0);
    const put = await rota("api/tecnicos/[id]", "PUT", { ...base(0), tipo: "RESPONSAVEL_TECNICO", tipoEquipe: "CAMPO" }, { id });
    expect(put).toMatchObject({ status: 400, json: { erro: MSG_RT_SEM_CREA } });
    expect((await linha(id)).tipo).toBe("ADMINISTRATIVO");
    const com = await rota("api/tecnicos/[id]", "PUT", { ...base(0), tipo: "RESPONSAVEL_TECNICO", tipoEquipe: "CAMPO", crea: "5012345-D/SP" }, { id });
    expect(com.status, com.texto).toBe(200);
    expect(await linha(id)).toMatchObject({ tipo: "RESPONSAVEL_TECNICO", tipoEquipe: "CAMPO", crea: "5012345-D/SP" });
  });

  it("J13: a recusa diz o que está errado (e mantém os detalhes); campo ausente fica no genérico", async () => {
    const curto = await rota("api/tecnicos", "POST", { ...base(3), nome: "A" });
    expect(curto.status).toBe(400);
    expect(curto.json.erro).toBe("Nome deve ter pelo menos 2 caracteres");
    expect(curto.json.detalhes.fieldErrors.nome).toEqual(["Nome deve ter pelo menos 2 caracteres"]);
    const email = await rota("api/tecnicos/[id]", "PUT", { ...base(0), email: "nao-e-email" }, { id });
    expect(email).toMatchObject({ status: 400, json: { erro: "E-mail inválido" } });
    const ausente = await rota("api/tecnicos", "POST", { nome: "Carlos Oliveira", cpf: CPFS[3] });
    expect(ausente.json.erro).toBe("Dados inválidos");
  });

  it("J18: especialidades aparadas, sem vazia nem repetida (maiúscula não conta); 61 caracteres ou 21 itens recusados", async () => {
    const r = await rota("api/tecnicos/[id]", "PUT", { ...base(0), especialidades: [" VRF ", "vrf", "", "Chiller", "CHILLER", "Split"] }, { id });
    expect(r.status, r.texto).toBe(200);
    expect((await linha(id)).especialidades).toEqual(["VRF", "Chiller", "Split"]);
    const longa = await rota("api/tecnicos/[id]", "PUT", { ...base(0), especialidades: ["x".repeat(61)] }, { id });
    expect(longa).toMatchObject({ status: 400, json: { erro: "Cada especialidade pode ter até 60 caracteres" } });
    const muitas = await rota("api/tecnicos/[id]", "PUT", { ...base(0), especialidades: Array.from({ length: 21 }, (_, i) => `E${i}`) }, { id });
    expect(muitas).toMatchObject({ status: 400, json: { erro: "Informe no máximo 20 especialidades" } });
    expect((await linha(id)).especialidades).toEqual(["VRF", "Chiller", "Split"]);
  });

  it("F22: apagar o e-mail de quem tem login é recusado (nada muda); sem login, apaga", async () => {
    const { MSG_EMAIL_COM_LOGIN } = await import("@/lib/colaborador/funcao");
    const c = await rota("api/tecnicos", "POST", { ...base(4), email: "joao@clima.exemplo" });
    expect(c.status, c.texto).toBe(201);
    await prisma.usuario.create({ data: { id: "uJoao", empresaId: "e1", nome: "João", email: "Joao@Clima.exemplo", senha: "x", role: "TECNICO" } });
    const r = await rota("api/tecnicos/[id]", "PUT", { ...base(4), email: "" }, { id: c.json.id });
    expect(r).toMatchObject({ status: 400, json: { erro: MSG_EMAIL_COM_LOGIN } });
    expect((await linha(c.json.id)).email).toBe("joao@clima.exemplo");
    expect((await prisma.usuario.findUnique({ where: { id: "uJoao" } })).email).toBe("Joao@Clima.exemplo");
    // trocar (não apagar) continua levando o login junto
    expect((await rota("api/tecnicos/[id]", "PUT", { ...base(4), email: "joao.novo@clima.exemplo" }, { id: c.json.id })).status).toBe(200);
    expect((await prisma.usuario.findUnique({ where: { id: "uJoao" } })).email).toBe("joao.novo@clima.exemplo");
    // sem login ligado: o e-mail sai
    await prisma.tecnico.update({ where: { id }, data: { email: "carlos@clima.exemplo" } });
    expect((await rota("api/tecnicos/[id]", "PUT", { ...base(0), tipo: "RESPONSAVEL_TECNICO", crea: "5012345-D/SP", email: "", especialidades: ["VRF", "Chiller", "Split"] }, { id })).status).toBe(200);
    expect((await linha(id)).email).toBeNull();
  });

  it("J20: o GET de Configurações › Impressão devolve mostrarEspecialidadesTecnico (padrão ligado), como o PUT", async () => {
    const g = await rota("api/configuracoes/impressao-os", "GET");
    expect(g.status, g.texto).toBe(200);
    expect(g.json.mostrarEspecialidadesTecnico).toBe(true);
    expect((await rota("api/configuracoes/impressao-os", "PUT", { ...CONFIG_RELATORIO_PADRAO, mostrarEspecialidadesTecnico: false })).status).toBe(200);
    expect((await rota("api/configuracoes/impressao-os", "GET")).json).toMatchObject({ mostrarEspecialidadesTecnico: false, fotos: CONFIG_RELATORIO_PADRAO.fotos });
    await rota("api/configuracoes/impressao-os", "PUT", { ...CONFIG_RELATORIO_PADRAO, mostrarEspecialidadesTecnico: true });
  });

  it("J10: a atividade devolvida (criar e editar) traz as especialidades; com a chave desligada, vazias", async () => {
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital Fictício", cpfCnpj: "44.555.666/0001-77" } });
    await prisma.ordemServico.create({ data: { id: "os1", empresaId: "e1", numero: "OS-1", clienteId: "c1", criadoPorId: "uAdmin", descricao: "Preventiva" } });
    await prisma.tecnico.create({ data: { id: "tMaria", empresaId: "e1", nome: "Maria Souza", cpf: "2", telefone: "1", especialidades: ["Elétrica"] } });
    const criada = await rota("api/ordens/[id]/atividades", "POST", { titulo: "Chiller", tecnicoIds: [id, "tMaria"], responsavelId: id }, { id: "os1" });
    expect(criada.status, criada.texto).toBe(201);
    expect(criada.json.tecnico.especialidades).toEqual(["VRF", "Chiller", "Split"]);
    expect(criada.json.tecnicosEquipe.map((t: any) => t.tecnico.especialidades)).toEqual([["Elétrica"]]);
    const editada = await rota("api/ordens/[id]/atividades/[atividadeId]", "PUT", { titulo: "Chiller 2" }, { id: "os1", atividadeId: criada.json.id });
    expect(editada.status, editada.texto).toBe(200);
    expect(editada.json.tecnico.especialidades).toEqual(["VRF", "Chiller", "Split"]);

    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { mostrarEspecialidadesTecnico: false } });
    const desligada = await rota("api/ordens/[id]/atividades/[atividadeId]", "PUT", { titulo: "Chiller 3" }, { id: "os1", atividadeId: criada.json.id });
    expect(desligada.status, desligada.texto).toBe(200);
    expect(desligada.json.tecnico).toMatchObject({ id, especialidades: [] });
    expect(desligada.json.tecnicosEquipe.map((t: any) => t.tecnico.especialidades)).toEqual([[]]);
  });
});
