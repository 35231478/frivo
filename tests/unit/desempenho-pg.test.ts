/**
 * DESEMPENHO (PR 1 — medir e mostrar), de ponta a ponta no servidor: rotas reais com o Prisma real num
 * PostgreSQL real (schema descartável via `prisma db push`). Só o relógio é fixado (13/11/2026).
 *
 * O que se prova:
 *  - o módulo só existe depois que a gestão abre a configuração (4 perfis iniciais, SEM regra);
 *  - CRUD de perfil, regra TRAVADA no mês (a primeira vale já; mudança só no mês seguinte e não
 *    retroage), participantes (um perfil por colaborador), ajustes e link da TV;
 *  - a MEDIÇÃO sai do que a operação grava: no prazo (data de conclusão × prazo/agenda), relatório
 *    completo (regra do app + foto antes e depois), avaliação do cliente;
 *  - penalidade NUNCA é automática: retorno, ressalva e nota baixa entram "a revisar" e só pesam
 *    depois de "conta" com motivo; quem REGISTROU o problema não é penalizado; ninguém revisa a si mesmo;
 *  - atividade de equipe: todos levam o resultado, uma vez cada; encarregado = equipes que lidera;
 *  - premiação do mês (texto + imagem) e modo TV sem valor em reais;
 *  - a data de conclusão da atividade passa a ser gravada (toque no app, tela do escritório, reabrir);
 *  - RBAC em cada rota (ver, revisar, gerenciar; o colaborador vê só o dele) e multiempresa;
 *  - PR 2 (PAGAR): fechar o mês congela escore, faixa e bônus; reabrir fica registrado; folha de bônus,
 *    exportação, premiação com desempate, histórico e o que o colaborador vê no app.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/desempenho-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Acao, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_desempenho_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const ORIGEM = "https://app.exemplo.com";
/** "Hoje": 13/11/2026, meio-dia em Brasília */
const AGORA = new Date("2026-11-13T15:00:00Z");
const MES = "2026-11";
vi.setConfig({ testTimeout: 30_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/auth-portal", () => ({ getPortalSession: vi.fn(async () => null) }));
vi.mock("@/lib/nfse/webhook-server", async (orig) => ({ ...(await orig<object>()), reconciliarEmpresa: vi.fn(async () => {}) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: (fn: () => void) => { void fn; } }));
vi.mock("resend", () => ({ Resend: class { emails = { send: async () => ({ data: { id: "x" } }) }; } }));

const entrar = (permissoes: Permissoes, o: { empresaId?: string; id?: string; role?: string; tecnicoId?: string | null; email?: string } = {}) => {
  const empresaId = o.empresaId ?? "e1";
  const id = o.id ?? (empresaId === "e1" ? "uG" : "uB");
  sessao.atual = { user: { id, name: "Gestora", email: o.email ?? `${id}@x.com`, empresaId, role: o.role ?? "OPERADOR", permissoes, tecnicoId: o.tecnicoId ?? null } };
};
const com = (acoes: Acao[], o: Parameters<typeof entrar>[1] = {}) => entrar(montarPermissoes({ desempenho: acoes }), o);
const gestao = (o: Parameters<typeof entrar>[1] = {}) => com(["visualizar", "revisar", "gerenciar"], o);

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`${ORIGEM}/api/x${query}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const json = (res.headers.get("content-type") ?? "").includes("json") ? await res.clone().json() : null;
  return { status: res.status, json, tipo: res.headers.get("content-type"), bytes: json ? 0 : (await res.arrayBuffer()).byteLength };
}
const erro = async (r: Promise<{ status: number; json: any }>) => { const x = await r; return `${x.status} ${x.json?.erro ?? ""}`; };
/** Instante no relógio de Brasília */
const br = (dia: string, hora = "10:00") => new Date(`${dia}T${hora}:00-03:00`);
const FOTO = "data:image/png;base64,iVBORw0KGgo=";
const IMAGEM = `data:image/jpeg;base64,${"QUJD".repeat(40)}`;
const REGRA = (x: Record<string, unknown> = {}) => ({
  pesoPrazo: 40, pesoRelatorio: 30, pesoAvaliacao: 30, exigirFotoAntesDepois: true, penalidadeRetorno: 5, penalidadeReclamacao: 5, metaMinima: 70,
  faixas: [{ nome: "Bronze", minimo: 70, valor: 100 }, { nome: "Prata", minimo: 80, valor: 200 }, { nome: "Ouro", minimo: 90, valor: 350 }], ...x,
});
const R = {
  painel: "desempenho", ficha: "desempenho/colaboradores/[id]", config: "desempenho/configuracao", tv: "desempenho/tv", perfis: "desempenho/perfis", perfil: "desempenho/perfis/[id]",
  regra: "desempenho/perfis/[id]/regra", participantes: "desempenho/participantes", participante: "desempenho/participantes/[tecnicoId]", penalidades: "desempenho/penalidades",
  penalidade: "desempenho/penalidades/[id]", decisao: "desempenho/penalidades/[id]/decisao", premiacoes: "desempenho/premiacoes", premiacao: "desempenho/premiacoes/[id]",
  imagem: "desempenho/premiacoes/[id]/imagem", meu: "tecnico/desempenho", fechamentos: "desempenho/fechamentos", fechamento: "desempenho/fechamentos/[id]",
  reabrir: "desempenho/fechamentos/[id]/reabrir", exportar: "desempenho/fechamentos/[id]/exportar", meuPremio: "tecnico/desempenho/premiacoes/[id]/imagem", tvPublica: "publico/desempenho/[token]", tvImagem: "publico/desempenho/[token]/premiacoes/[id]/imagem",
};

describe.skipIf(!URL_PG)("Desempenho PR 1: medir e mostrar (PostgreSQL real)", () => {
  let prisma: any;
  let n = 0;

  type Relatorio = "completo" | "sem-depois" | "sem-resposta" | "atencao" | "atencao-sem-foto" | "nao-atendido";
  /**
   * Uma OS com UMA atividade já executada. `concluida`: o instante da conclusão (null = concluída antes de
   * o sistema guardar a data). `nota`/`ressalva`: o aceite do cliente confirmado.
   */
  async function servico(o: {
    tecnicos: string[]; equipeId?: string | null; tipoOsId?: string; equipamento?: string | null; agendada?: Date | null; prazo?: string | null; concluida?: Date | null;
    relatorio?: Relatorio; nota?: number | null; ressalva?: string | null; comentario?: string | null; confirmadoEm?: Date; status?: string; statusOs?: string; empresaId?: string;
    criadaEm?: Date; extraOs?: Record<string, unknown>;
  }) {
    const id = `s${++n}`;
    const empresaId = o.empresaId ?? "e1";
    const concluida = o.concluida === undefined ? br("2026-11-05", "16:00") : o.concluida;
    const status = o.status ?? "CONCLUIDA";
    await prisma.ordemServico.create({ data: {
      id: `os-${id}`, empresaId, numero: `OS-${1000 + n}`, clienteId: empresaId === "e1" ? "c1" : "cE2", criadoPorId: empresaId === "e1" ? "uA" : "uB", descricao: "Manutenção",
      status: o.statusOs ?? (status === "CONCLUIDA" ? "CONCLUIDA" : "ABERTA"), criadoEm: o.criadaEm ?? br("2026-11-01", "08:00"), ...o.extraOs,
    } });
    const [responsavel, ...equipe] = o.tecnicos;
    await prisma.atividadeOs.create({ data: {
      id: `at-${id}`, empresaId, ordemServicoId: `os-${id}`, titulo: "Visita", tipoOsId: o.tipoOsId ?? (empresaId === "e1" ? "toPrev" : null), tecnicoId: responsavel ?? null,
      equipeId: o.equipeId ?? null, status, dataAgendada: o.agendada === undefined ? br("2026-11-05", "09:00") : o.agendada, prazo: o.prazo ? new Date(`${o.prazo}T00:00:00Z`) : null,
      concluidaEm: status === "CONCLUIDA" ? concluida : null, tecnicosEquipe: { create: equipe.map((tecnicoId) => ({ tecnicoId })) },
    } });
    const equipamento = o.equipamento === undefined ? "q1" : o.equipamento;
    const relatorio = o.relatorio ?? "completo";
    if (equipamento) {
      const feito = relatorio !== "nao-atendido";
      await prisma.atividadeEquipamento.create({ data: { atividadeId: `at-${id}`, equipamentoId: equipamento, feito, feitoEm: feito ? concluida ?? br("2026-11-05", "15:00") : null } });
      if (feito) {
        const atencao = relatorio.startsWith("atencao");
        if (relatorio !== "sem-resposta") {
          await prisma.checklistResposta.create({ data: { empresaId, atividadeId: `at-${id}`, equipamentoId: equipamento, itemId: "i1", textoItem: "Filtro", status: atencao ? "ATENCAO" : "OK", observacao: atencao ? "Filtro rasgado" : null } });
        }
        await prisma.checklistResposta.create({ data: { empresaId, atividadeId: `at-${id}`, equipamentoId: equipamento, itemId: "i2", textoItem: "Pressão", valor: 68, unidade: "psi" } });
        const fotos = [{ momento: "ANTES" as const, itemId: null as string | null }];
        if (relatorio !== "sem-depois") fotos.push({ momento: "DEPOIS" as never, itemId: null });
        if (relatorio === "atencao") fotos.push({ momento: null as never, itemId: "i1" });
        await prisma.fotoAtendimento.createMany({ data: fotos.map((f) => ({ empresaId, atividadeId: `at-${id}`, equipamentoId: equipamento, url: FOTO, ...f })) });
      }
    }
    if (o.nota !== undefined || o.ressalva) {
      await prisma.osAceite.create({ data: {
        id: `ac-${id}`, empresaId, ordemServicoId: `os-${id}`, token: `tok-${id}`, situacao: "CONFIRMADO", metodo: "REMOTO", nome: "Cliente", ressalva: o.ressalva ?? null,
        avaliacao: o.nota ?? null, avaliacaoComentario: o.comentario ?? null, confirmadoEm: o.confirmadoEm ?? (concluida ?? br("2026-11-05", "18:00")),
      } });
    }
    return { id, os: `os-${id}`, atividade: `at-${id}`, numero: `OS-${1000 + n}` };
  }
  /** OS corretiva aberta depois (o possível retorno) */
  const corretiva = (equipamento: string, abertaEm: Date, extraOs: Record<string, unknown> = {}, tipoOsId = "toCorr") =>
    servico({ tecnicos: ["t5"], tipoOsId, equipamento, status: "AGENDADA", relatorio: "nao-atendido", criadaEm: abertaEm, agendada: null, extraOs });

  const perfilId = async (nome: string, empresaId = "e1") => (await prisma.desempenhoPerfil.findFirstOrThrow({ where: { empresaId, nome } })).id;
  const participar = async (tecnicoId: string, perfil: string) => { gestao(); expect((await chamar(R.participantes, "POST", {}, { tecnicoId, perfilId: await perfilId(perfil) })).status).toBe(200); };
  const painel = async (mes = MES) => (await chamar(R.painel, "GET", {}, undefined, `?mes=${mes}`)).json;
  const linha = async (nome: string, mes = MES) => (await painel(mes)).grupos.flatMap((g: any) => g.linhas).find((l: any) => l.nome === nome);
  const escore = async (nome: string, mes = MES) => (await linha(nome, mes))?.escore;
  const itens = async (query = "") => (await chamar(R.penalidades, "GET", {}, undefined, query)).json.itens as any[];
  const resumo = (lista: any[]) => lista.map((p) => `${p.tecnico.nome}:${p.tipo}:${p.situacao}`).sort();
  const decidir = (id: string, situacao: string, motivo?: string) => chamar(R.decisao, "POST", { id }, { situacao, motivo });
  /** Apaga o que os testes criaram no dia a dia (OS, itens da revisão), mantendo perfis, regras e participantes */
  async function zerarOperacao() {
    await prisma.desempenhoPenalidade.deleteMany({});
    await prisma.ordemServico.deleteMany({ where: { id: { startsWith: "os-s" } } });
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([...Object.values(R), "tecnico/sync", "ordens/[id]/atividades/[atividadeId]"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    // Só o relógio do aplicativo é fixado (as datas); os temporizadores continuam de verdade
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total Engenharia Ltda", nomeFantasia: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Admin", email: "admin@x.com", senha: "x", role: "ADMIN" },
      { id: "uG", empresaId: "e1", nome: "Gil Gestor", email: "uG@x.com", senha: "x", role: "OPERADOR" },
      { id: "uT", empresaId: "e1", nome: "Bia Reis", email: "bia@x.com", senha: "x", role: "TECNICO" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "uB@x.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "Ana Dias", cpf: "1", telefone: "1" },
      { id: "t2", empresaId: "e1", nome: "Bia Reis", cpf: "2", telefone: "2", email: "bia@x.com" },
      { id: "t3", empresaId: "e1", nome: "Edu Prado", cpf: "3", telefone: "3" },
      { id: "t4", empresaId: "e1", nome: "Carlos Lider", cpf: "4", telefone: "4" },
      { id: "t5", empresaId: "e1", nome: "Fora do Desempenho", cpf: "5", telefone: "5" },
      { id: "t6", empresaId: "e1", nome: "Inativo", cpf: "6", telefone: "6", statusColaborador: "INATIVO" },
      { id: "tE2", empresaId: "e2", nome: "Técnico da outra", cpf: "7", telefone: "7" },
    ] });
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "1" }, { id: "cE2", empresaId: "e2", nome: "Cliente E2", cpfCnpj: "2" }] });
    await prisma.unidade.create({ data: { id: "u1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    await prisma.tipoEquipamentoCustom.create({ data: { id: "te1", empresaId: "e1", nome: "Split" } });
    await prisma.checklistTipoItem.createMany({ data: [
      { id: "i1", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Filtro", tipoResposta: "OK_ATENCAO_NA", ordem: 1, criadoEm: new Date("2026-01-01") },
      { id: "i2", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Pressão", tipoResposta: "MEDICAO", unidade: "psi", ordem: 2, criadoEm: new Date("2026-01-01") },
    ] });
    await prisma.equipamento.createMany({ data: ["q1", "q2", "q3", "q4"].map((id, i) => ({
      id, empresaId: "e1", unidadeId: "u1", tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4", nome: `Split ${i + 1}`, patrimonio: `AC-00${i + 1}`, tipoEquipamentoId: "te1",
    })) });
    await prisma.tipoOs.createMany({ data: [
      { id: "toPrev", empresaId: "e1", nome: "Manutenção Preventiva" }, { id: "toCorr", empresaId: "e1", nome: "Manutenção Corretiva" },
      { id: "toInativo", empresaId: "e1", nome: "Tipo inativo", ativo: false }, { id: "toE2", empresaId: "e2", nome: "Corretiva da outra" },
    ] });
    await prisma.equipe.create({ data: { id: "eqA", empresaId: "e1", nome: "Equipe Alfa", liderId: "t4", membros: { connect: [{ id: "t2" }, { id: "t4" }] } } });
    await prisma.equipe.create({ data: { id: "eqInativa", empresaId: "e1", nome: "Equipe antiga", liderId: "t4", status: "INATIVA", membros: { connect: [{ id: "t1" }] } } });
  }, 180_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$disconnect();
    if (URL_PG) execFileSync("psql", [URL_PG, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });
  beforeEach(() => { vi.setSystemTime(AGORA); gestao(); });

  /* ───────── ativação e configuração ───────── */

  it("o módulo NÃO existe até a gestão abrir a configuração: o painel responde 'inativo' e nada é criado só por olhar", async () => {
    expect((await chamar(R.painel, "GET")).json).toEqual({ ativo: false });
    expect((await chamar(R.penalidades, "GET")).json).toMatchObject({ ativo: false, itens: [], aRevisar: 0 });
    expect(await prisma.desempenhoConfig.count()).toBe(0);
    expect(await prisma.desempenhoPerfil.count()).toBe(0);
  });

  it("abrir a configuração cria os ajustes e os 4 perfis iniciais — SEM regra (nada vale antes de a gestão salvar); repetir não duplica", async () => {
    const [a, b] = await Promise.all([chamar(R.config, "GET"), chamar(R.config, "GET")]); // duas pessoas ao mesmo tempo
    expect([a.status, b.status]).toEqual([200, 200]);
    const cfg = (await chamar(R.config, "GET")).json;
    expect(cfg.perfis.map((p: any) => `${p.nome}:${p.tipo}:${p.vigente}:${p.agendada}:${p.participantes.length}`)).toEqual(["Preventiva:TECNICO:null:null:0", "Corretiva:TECNICO:null:null:0", "Instalação:TECNICO:null:null:0", "Encarregado:GESTAO:null:null:0"]);
    expect(cfg).toMatchObject({ competencia: "2026-11", competenciaSeguinte: "2026-12", ajustes: { retornoDias: 30, tiposRetorno: [] }, tvToken: null });
    expect(await prisma.desempenhoConfig.count()).toBe(1);
    expect(await prisma.desempenhoPerfil.count()).toBe(4);
    expect(await prisma.desempenhoRegra.count()).toBe(0);
    expect((await prisma.desempenhoConfig.findFirstOrThrow()).criadoEm).toEqual(AGORA); // o início da medição
    // Quem pode entrar num perfil: só colaborador ATIVO da empresa; tipo de OS inativo não é oferecido
    expect(cfg.disponiveis.map((t: any) => t.nome)).toEqual(["Ana Dias", "Bia Reis", "Carlos Lider", "Edu Prado", "Fora do Desempenho"]);
    expect(cfg.tiposOs.map((t: any) => t.nome)).toEqual(["Manutenção Corretiva", "Manutenção Preventiva"]);
    // A outra empresa continua sem nada
    expect(await prisma.desempenhoConfig.count({ where: { empresaId: "e2" } })).toBe(0);
  });

  it("perfil: criar, nome repetido, editar, excluir — e o perfil de outra empresa não existe para mim", async () => {
    expect(await erro(chamar(R.perfis, "POST", {}, { nome: "A", tipo: "TECNICO" }))).toMatch(/^400 Dê um nome ao perfil/);
    expect(await erro(chamar(R.perfis, "POST", {}, { nome: "Preventiva", tipo: "TECNICO" }))).toBe("409 Já existe um perfil com este nome.");
    const criado = await chamar(R.perfis, "POST", {}, { nome: "  Ajudante  ", tipo: "TECNICO" });
    expect(criado.status).toBe(201);
    expect(await prisma.desempenhoPerfil.findUnique({ where: { id: criado.json.id } })).toMatchObject({ nome: "Ajudante", tipo: "TECNICO", empresaId: "e1", ordem: 4 });
    expect((await chamar(R.perfil, "PUT", { id: criado.json.id }, { nome: "Auxiliar", tipo: "GESTAO" })).status).toBe(200); // sem regra, o tipo ainda muda
    expect(await erro(chamar(R.perfil, "PUT", { id: criado.json.id }, { nome: "Corretiva", tipo: "GESTAO" }))).toBe("409 Já existe um perfil com este nome.");
    expect(await prisma.desempenhoPerfil.findUnique({ where: { id: criado.json.id } })).toMatchObject({ nome: "Auxiliar", tipo: "GESTAO" });
    // Outra empresa: não vê, não edita, não exclui
    gestao({ empresaId: "e2" });
    expect(await erro(chamar(R.perfil, "PUT", { id: criado.json.id }, { nome: "Roubado", tipo: "TECNICO" }))).toBe("404 Perfil não encontrado.");
    expect(await erro(chamar(R.perfil, "DELETE", { id: criado.json.id }))).toBe("404 Perfil não encontrado.");
    expect(await erro(chamar(R.regra, "PUT", { id: criado.json.id }, REGRA()))).toBe("404 Perfil não encontrado.");
    await prisma.desempenhoConfig.deleteMany({ where: { empresaId: "e2" } }); await prisma.desempenhoPerfil.deleteMany({ where: { empresaId: "e2" } });
    gestao();
    expect((await chamar(R.perfil, "DELETE", { id: criado.json.id })).status).toBe(200);
    expect(await prisma.desempenhoPerfil.count({ where: { id: criado.json.id } })).toBe(0);
    expect(await erro(chamar(R.perfil, "DELETE", { id: criado.json.id }))).toBe("404 Perfil não encontrado.");
  });

  it("REGRA TRAVADA: a primeira vale já no mês; mudar depois grava para o mês seguinte — a do mês não é tocada", async () => {
    const id = await perfilId("Preventiva");
    expect(await erro(chamar(R.regra, "PUT", { id }, REGRA({ pesoPrazo: 50 })))).toBe("400 Os pesos precisam somar 100.");
    expect(await prisma.desempenhoRegra.count()).toBe(0);
    expect((await chamar(R.regra, "PUT", { id }, REGRA())).json).toEqual({ vigenteDesde: "2026-11", imediata: true });
    // Mudança no mesmo mês: vai para dezembro
    expect((await chamar(R.regra, "PUT", { id }, REGRA({ metaMinima: 60, faixas: [{ nome: "Bronze", minimo: 60, valor: 50 }] }))).json).toEqual({ vigenteDesde: "2026-12", imediata: false });
    const regras = () => prisma.desempenhoRegra.findMany({ where: { perfilId: id }, orderBy: { vigenteDesde: "asc" }, select: { vigenteDesde: true, metaMinima: true, criadoPorId: true } });
    expect(await regras()).toEqual([{ vigenteDesde: "2026-11", metaMinima: 70, criadoPorId: "uG" }, { vigenteDesde: "2026-12", metaMinima: 60, criadoPorId: "uG" }]);
    // Mudar de novo SUBSTITUI a mudança agendada (continua uma só) e nunca a regra em vigor
    expect((await chamar(R.regra, "PUT", { id }, REGRA({ metaMinima: 75, faixas: [{ nome: "Bronze", minimo: 75, valor: 80 }] }))).json.vigenteDesde).toBe("2026-12");
    expect((await regras()).map((r: any) => `${r.vigenteDesde}:${r.metaMinima}`)).toEqual(["2026-11:70", "2026-12:75"]);
    const cfg = (await chamar(R.config, "GET")).json.perfis.find((p: any) => p.id === id);
    expect(cfg.vigente).toMatchObject({ vigenteDesde: "2026-11", metaMinima: 70, faixas: REGRA().faixas });
    expect(cfg.agendada).toMatchObject({ vigenteDesde: "2026-12", metaMinima: 75 });
    // Com regra, o tipo do perfil não muda mais
    expect(await erro(chamar(R.perfil, "PUT", { id }, { nome: "Preventiva", tipo: "GESTAO" }))).toMatch(/^409 O tipo do perfil não muda/);
    expect((await chamar(R.perfil, "PUT", { id }, { nome: "Preventiva", tipo: "TECNICO" })).status).toBe(200);
  });

  it("a mudança NÃO RETROAGE: em dezembro vale a regra nova; novembro continua medido pela regra de novembro", async () => {
    const id = await perfilId("Preventiva");
    await participar("t1", "Preventiva");
    await servico({ tecnicos: ["t1"], concluida: br("2026-11-05", "16:00"), nota: 4 });  // 100/100/80 = 94
    vi.setSystemTime(new Date("2026-12-02T15:00:00Z"));
    const cfg = (await chamar(R.config, "GET")).json.perfis.find((p: any) => p.id === id);
    expect(cfg.vigente).toMatchObject({ vigenteDesde: "2026-12", metaMinima: 75 });
    expect(cfg.agendada).toBeNull();
    const nov = (await painel("2026-11")).grupos[0], dez = (await painel("2026-12")).grupos[0];
    expect(nov.regra).toMatchObject({ vigenteDesde: "2026-11", metaMinima: 70 });
    expect(nov.linhas[0]).toMatchObject({ nome: "Ana Dias", escore: 94, faixa: "Ouro", bonus: 350 });
    expect(dez.regra).toMatchObject({ vigenteDesde: "2026-12", metaMinima: 75 });
    // Em dezembro, uma nova mudança vai para janeiro
    expect((await chamar(R.regra, "PUT", { id }, REGRA())).json).toEqual({ vigenteDesde: "2027-01", imediata: false });
    // Descartar a mudança agendada: fica a regra em vigor
    expect((await chamar(R.regra, "DELETE", { id })).json).toEqual({ descartadas: 1 });
    expect((await prisma.desempenhoRegra.findMany({ where: { perfilId: id }, orderBy: { vigenteDesde: "asc" } })).map((r: any) => r.vigenteDesde)).toEqual(["2026-11", "2026-12"]);
    // De volta a novembro para os outros testes: dezembro volta a ser a mudança agendada
    await prisma.desempenhoRegra.deleteMany({ where: { perfilId: id, vigenteDesde: "2026-12" } });
    await zerarOperacao();
  });

  it("participantes: um perfil por colaborador; mudar de perfil; tirar; só gente e perfil da MINHA empresa", async () => {
    const prev = await perfilId("Preventiva"), corr = await perfilId("Corretiva");
    expect((await chamar(R.participantes, "POST", {}, { tecnicoId: "t2", perfilId: prev })).status).toBe(200);
    expect((await chamar(R.participantes, "POST", {}, { tecnicoId: "t2", perfilId: corr })).status).toBe(200); // muda de perfil
    expect(await prisma.desempenhoParticipante.findMany({ where: { tecnicoId: "t2" }, select: { perfilId: true, empresaId: true } })).toEqual([{ perfilId: corr, empresaId: "e1" }]);
    expect(await erro(chamar(R.participantes, "POST", {}, { tecnicoId: "tE2", perfilId: prev }))).toBe("404 Colaborador não encontrado.");
    expect(await erro(chamar(R.participantes, "POST", {}, { tecnicoId: "t2", perfilId: "nao-existe" }))).toBe("404 Perfil não encontrado.");
    expect(await erro(chamar(R.participantes, "POST", {}, { tecnicoId: "t2" }))).toMatch(/^400 /);
    // Perfil com gente não é excluído
    expect(await erro(chamar(R.perfil, "DELETE", { id: corr }))).toMatch(/^409 Este perfil tem colaboradores/);
    expect((await chamar(R.participante, "DELETE", { tecnicoId: "t2" })).status).toBe(200);
    expect(await erro(chamar(R.participante, "DELETE", { tecnicoId: "t2" }))).toBe("404 Este colaborador não está no Desempenho.");
    // A outra empresa não tira participante meu
    await participar("t2", "Preventiva");
    gestao({ empresaId: "e2" });
    expect(await erro(chamar(R.participante, "DELETE", { tecnicoId: "t2" }))).toBe("404 Este colaborador não está no Desempenho.");
    gestao();
    expect(await prisma.desempenhoParticipante.count({ where: { tecnicoId: "t2" } })).toBe(1);
  });

  it("ajustes: prazo do retorno e os tipos de OS que contam como corretiva (só tipos da minha empresa); 'nota baixa' não é mais ajuste", async () => {
    // A nota baixa deixou de ser penalidade: o ajuste saiu e o servidor recusa quem ainda mandar o campo
    expect(await erro(chamar(R.config, "PUT", {}, { retornoDias: 30, tiposRetorno: [], ["nota" + "BaixaAte"]: 2 }))).toMatch(/^400 /);
    expect((await chamar(R.config, "GET")).json.ajustes).not.toHaveProperty("notaBaixaAte");
    expect(await erro(chamar(R.config, "PUT", {}, { retornoDias: 0, tiposRetorno: [] }))).toMatch(/^400 Prazo do retorno/);
    expect(await erro(chamar(R.config, "PUT", {}, { retornoDias: 30, tiposRetorno: ["toE2"] }))).toBe("404 Tipo de OS não encontrado.");
    expect((await chamar(R.config, "PUT", {}, { retornoDias: 20, tiposRetorno: ["toCorr", "toInativo", "toCorr"] })).status).toBe(200);
    let cfg = (await chamar(R.config, "GET")).json;
    expect(cfg.ajustes).toEqual({ retornoDias: 20, tiposRetorno: expect.arrayContaining(["toCorr", "toInativo"]) });
    expect(cfg.ajustes.tiposRetorno).toHaveLength(2);
    expect(cfg.tiposOs.map((t: any) => t.nome)).toContain("Tipo inativo"); // marcado: aparece para poder desmarcar
    expect((await chamar(R.config, "PUT", {}, { retornoDias: 30, tiposRetorno: ["toCorr"] })).status).toBe(200);
    cfg = (await chamar(R.config, "GET")).json;
    expect(cfg.ajustes).toEqual({ retornoDias: 30, tiposRetorno: ["toCorr"] });
    expect(await prisma.desempenhoTipoRetorno.count()).toBe(1);
  });

  /* ───────── a medição ───────── */

  it("o painel do mês: escore, composição com os números, faixa, posição por perfil e o resumo por equipe", async () => {
    await zerarOperacao();
    await chamar(R.regra, "PUT", { id: await perfilId("Corretiva") }, REGRA());
    await chamar(R.regra, "PUT", { id: await perfilId("Encarregado") }, REGRA({ pesoPrazo: 50, pesoRelatorio: 0, pesoAvaliacao: 50, faixas: [{ nome: "Ouro", minimo: 90, valor: 500 }] }));
    await participar("t1", "Preventiva"); await participar("t2", "Preventiva"); await participar("t3", "Corretiva"); await participar("t4", "Encarregado");
    // Ana: 3 de 4 no prazo, 4 relatórios completos, notas 5, 5 e 4
    await servico({ tecnicos: ["t1"], agendada: br("2026-11-02"), concluida: br("2026-11-02", "16:00"), nota: 5 });
    await servico({ tecnicos: ["t1"], agendada: null, prazo: "2026-11-04", concluida: br("2026-11-04", "23:30"), nota: 5 });
    await servico({ tecnicos: ["t1"], agendada: br("2026-11-05"), concluida: br("2026-11-05", "16:00") });
    await servico({ tecnicos: ["t1"], agendada: br("2026-11-06"), concluida: br("2026-11-07", "09:00"), nota: 4 });
    // Bia (Equipe Alfa): 3 de 3 no prazo, 2 de 3 relatórios (um sem foto "depois"), notas 5 e 3
    await servico({ tecnicos: ["t2"], equipeId: "eqA", equipamento: "q2", nota: 5 });
    await servico({ tecnicos: ["t2"], equipeId: "eqA", equipamento: "q2", relatorio: "sem-depois", nota: 3 });
    await servico({ tecnicos: ["t2"], equipeId: "eqA", equipamento: "q2" });
    // Edu: 1 de 2 no prazo, notas 5 e 2
    await servico({ tecnicos: ["t3"], equipamento: "q3", nota: 5 });
    await servico({ tecnicos: ["t3"], equipamento: "q3", agendada: br("2026-11-06"), concluida: br("2026-11-08", "10:00"), nota: 2 });

    const p = await painel();
    expect(p.ativo).toBe(true);
    expect(p.grupos.map((g: any) => g.perfil.nome)).toEqual(["Preventiva", "Corretiva", "Instalação", "Encarregado"]);
    const ver = (g: any) => g.linhas.map((l: any) => `${l.posicao}:${l.nome}:${l.escore}:${l.faixa}:${l.bonus}`);
    expect(ver(p.grupos[0])).toEqual(["1:Ana Dias:88:Prata:200", "2:Bia Reis:84:Prata:200"]);
    expect(ver(p.grupos[1])).toEqual(["1:Edu Prado:71:Bronze:100"]);
    expect(p.grupos[2]).toMatchObject({ regra: null, linhas: [] });
    // Encarregado: as 3 atividades da Equipe Alfa no prazo (100) e satisfação 4,0 (80) → 90
    expect(ver(p.grupos[3])).toEqual(["1:Carlos Lider:90:Ouro:500"]);
    expect(p.grupos[0].linhas[0].composicao).toEqual([
      { metrica: "prazo", peso: 40, valor: 75, pontos: 30, detalhe: "3 de 4 atividades" },
      { metrica: "relatorio", peso: 30, valor: 100, pontos: 30, detalhe: "4 de 4 relatórios" },
      { metrica: "avaliacao", peso: 30, valor: 93.4, pontos: 28, detalhe: "média 4,7 em 3 avaliações" },
    ]);
    expect(p.grupos[0].linhas[1].composicao.map((c: any) => c.detalhe)).toEqual(["3 de 3 atividades", "2 de 3 relatórios", "média 4,0 em 2 avaliações"]);
    // Equipe Alfa = média de Bia (84) e Carlos (90); a equipe inativa não aparece
    expect(p.equipes).toEqual([{ id: "eqA", nome: "Equipe Alfa", cor: expect.any(String), lider: "Carlos Lider", escore: 87, participantes: 2, medidos: 2 }]);
    expect(p.semPerfil).toBe(1); // "Fora do Desempenho" — o inativo não conta
    // A nota 2 do Edu NÃO vira item de revisão: ela já pesou na média dele (5 e 2 = 3,5)
    expect(p.aRevisar).toBe(0);
    expect(p.grupos[1].linhas[0]).toMatchObject({ desconto: 0, composicao: expect.arrayContaining([expect.objectContaining({ metrica: "avaliacao", detalhe: "média 3,5 em 2 avaliações" })]) });
  });

  it("valores em reais: só quem tem Gerenciar recebe bônus e valor de faixa; quem só visualiza recebe o resto igual", async () => {
    com(["visualizar"]);
    const p = await painel();
    expect(p.grupos.flatMap((g: any) => g.linhas.map((l: any) => l.bonus))).toEqual([null, null, null, null]);
    expect(p.grupos[0].regra.faixas).toEqual([{ nome: "Bronze", minimo: 70, valor: null }, { nome: "Prata", minimo: 80, valor: null }, { nome: "Ouro", minimo: 90, valor: null }]);
    expect(p.grupos[0].linhas.map((l: any) => `${l.posicao}:${l.nome}:${l.escore}:${l.faixa}`)).toEqual(["1:Ana Dias:88:Prata", "2:Bia Reis:84:Prata"]);
    const ficha = (await chamar(R.ficha, "GET", { id: "t1" }, undefined, `?mes=${MES}`)).json;
    expect(ficha.linha).toMatchObject({ escore: 88, faixa: "Prata", bonus: null });
    expect(ficha.regra.faixas.every((f: any) => f.valor === null)).toBe(true);
    gestao();
    expect((await chamar(R.ficha, "GET", { id: "t1" }, undefined, `?mes=${MES}`)).json.linha.bonus).toBe(200);
  });

  it("ficha do colaborador: escore, composição, posição, quantos disputam; quem não participa (ou é de outra empresa) não tem ficha", async () => {
    const f = (await chamar(R.ficha, "GET", { id: "t2" }, undefined, `?mes=${MES}`)).json;
    expect(f).toMatchObject({ competencia: MES, tecnico: { id: "t2", nome: "Bia Reis" }, perfil: { nome: "Preventiva", tipo: "TECNICO" }, participantes: 2, linha: { posicao: 2, escore: 84, base: 84, desconto: 0, bonus: 200 } });
    expect(f.regra).toMatchObject({ metaMinima: 70, vigenteDesde: "2026-11" });
    expect(await erro(chamar(R.ficha, "GET", { id: "t5" }))).toBe("404 Este colaborador não participa do Desempenho.");
    expect(await erro(chamar(R.ficha, "GET", { id: "nao-existe" }))).toMatch(/^404/);
    gestao({ empresaId: "e2" });
    expect(await erro(chamar(R.ficha, "GET", { id: "t2" }))).toMatch(/^404/);
    // Mês em formato inválido cai no mês corrente (não quebra)
    gestao();
    expect((await chamar(R.ficha, "GET", { id: "t2" }, undefined, "?mes=novembro")).json.competencia).toBe(MES);
  });

  it("NO PRAZO: vale o dia de Brasília; sem data de conclusão ou sem prazo/agenda não se mede; cancelada e outro mês ficam fora", async () => {
    await zerarOperacao();
    const prazo = async () => (await linha("Ana Dias")).composicao[0].detalhe;
    await servico({ tecnicos: ["t1"], agendada: br("2026-11-10", "09:00"), concluida: br("2026-11-10", "23:50") }); // no dia: ok
    expect(await prazo()).toBe("1 de 1 atividade");
    await servico({ tecnicos: ["t1"], agendada: br("2026-11-10", "09:00"), concluida: br("2026-11-11", "00:10") }); // virou o dia: atrasou
    expect(await prazo()).toBe("1 de 2 atividades");
    await servico({ tecnicos: ["t1"], agendada: br("2026-11-03"), prazo: "2026-11-12", concluida: br("2026-11-12", "18:00") }); // prazo próprio vence a agenda
    expect(await prazo()).toBe("2 de 3 atividades");
    await servico({ tecnicos: ["t1"], agendada: null, prazo: null });                                  // sem prazo nem agenda
    await servico({ tecnicos: ["t1"], concluida: null });                                              // concluída antes de o sistema guardar a data
    await servico({ tecnicos: ["t1"], statusOs: "CANCELADA" });                                        // OS cancelada
    await servico({ tecnicos: ["t1"], status: "EM_ANDAMENTO", agendada: br("2026-11-01") });           // aberta e atrasada: ainda não foi concluída
    await servico({ tecnicos: ["t1"], concluida: new Date("2026-11-01T02:00:00Z") });                  // 31/10 às 23h em Brasília: é outubro
    await servico({ tecnicos: ["t1"], concluida: new Date("2026-12-01T03:00:00Z") });                  // 1º/12 à meia-noite em Brasília: é dezembro
    const reaberta = await servico({ tecnicos: ["t1"], agendada: br("2026-11-09"), concluida: br("2026-11-09", "10:00") });
    await prisma.atividadeOs.update({ where: { id: reaberta.atividade }, data: { status: "EM_ANDAMENTO" } });  // dado antigo: reaberta com a data ainda gravada
    expect(await prazo()).toBe("2 de 3 atividades");
    // A de outubro existe — em outubro (onde não há regra: sem escore, nunca zero)
    expect(await linha("Ana Dias", "2026-10")).toMatchObject({ escore: null, posicao: null });
  });

  it("RELATÓRIO COMPLETO: a regra do app + foto antes e depois, por equipamento ATENDIDO", async () => {
    await zerarOperacao();
    const relatorio = async (nome = "Ana Dias") => (await linha(nome)).composicao[1].detalhe;
    await servico({ tecnicos: ["t1"] });
    await servico({ tecnicos: ["t1"], relatorio: "sem-depois" });        // faltou a foto "depois"
    await servico({ tecnicos: ["t1"], relatorio: "sem-resposta" });      // faltou responder um item
    await servico({ tecnicos: ["t1"], relatorio: "atencao" });           // apontou atenção COM foto e observação: completo
    await servico({ tecnicos: ["t1"], relatorio: "atencao-sem-foto" });  // apontou atenção sem a foto que o app pede
    await servico({ tecnicos: ["t1"], relatorio: "nao-atendido" });      // equipamento vinculado, não atendido: não há relatório
    await servico({ tecnicos: ["t1"], equipamento: null });              // sem equipamento: não há relatório
    expect(await relatorio()).toBe("2 de 5 relatórios");
    // Item criado DEPOIS da conclusão não torna incompleto um relatório antigo…
    await prisma.checklistTipoItem.create({ data: { id: "i3", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Dreno", criadoEm: br("2026-11-12") } });
    expect(await relatorio()).toBe("2 de 5 relatórios");
    // …mas vale para o que for concluído depois dele
    await servico({ tecnicos: ["t1"], agendada: br("2026-11-13", "08:00"), concluida: br("2026-11-13", "11:00") });
    expect(await relatorio()).toBe("2 de 6 relatórios");
    await prisma.checklistTipoItem.delete({ where: { id: "i3" } });
    expect(await relatorio()).toBe("3 de 6 relatórios");
    // Item DESATIVADO deixa de ser exigido
    await prisma.checklistTipoItem.update({ where: { id: "i1" }, data: { ativo: false } });
    expect(await relatorio()).toBe("5 de 6 relatórios"); // só o "sem-depois" continua incompleto
    await prisma.checklistTipoItem.update({ where: { id: "i1" }, data: { ativo: true } });
  });

  it("relatório: um equipamento incompleto entre vários derruba o relatório; formulário obrigatório também conta", async () => {
    await zerarOperacao();
    const relatorio = async () => (await linha("Ana Dias")).composicao[1].detalhe;
    const s = await servico({ tecnicos: ["t1"] });
    await prisma.atividadeEquipamento.create({ data: { atividadeId: s.atividade, equipamentoId: "q2", feito: true, feitoEm: br("2026-11-05", "15:30") } }); // segundo equipamento, sem nada
    expect(await relatorio()).toBe("0 de 1 relatório");
    await prisma.atividadeEquipamento.deleteMany({ where: { atividadeId: s.atividade, equipamentoId: "q2" } });
    expect(await relatorio()).toBe("1 de 1 relatório");
    // Formulário obrigatório para concluir (tipo de OS × tipo de equipamento): sem preencher, incompleto
    await prisma.formularioTemplate.create({ data: { id: "f1", empresaId: "e1", nome: "Laudo", campos: { create: [{ id: "fc1", label: "Corrente", tipo: "TEXTO_CURTO" }] } } });
    await prisma.formTypeMapping.create({ data: { empresaId: "e1", tipoEquipamentoId: "te1", tipoOsId: "toPrev", formularioTemplateId: "f1", obrigatorioConcluir: true } });
    expect(await relatorio()).toBe("0 de 1 relatório");
    await prisma.respostaFormularioEquipamento.create({ data: { empresaId: "e1", atividadeId: s.atividade, equipamentoId: "q1", formularioId: "f1", campoId: "fc1", resposta: "12 A" } });
    expect(await relatorio()).toBe("1 de 1 relatório");
    await prisma.respostaFormularioEquipamento.deleteMany({}); await prisma.formTypeMapping.deleteMany({}); await prisma.formularioTemplate.deleteMany({});
  });

  it("perfil que NÃO exige foto antes/depois: o mesmo relatório passa a ser completo — a exigência é da regra do perfil", async () => {
    await zerarOperacao();
    await servico({ tecnicos: ["t1", "t3"], relatorio: "sem-depois" }); // Ana (Preventiva, exige) e Edu (Corretiva)
    await prisma.desempenhoRegra.updateMany({ where: { perfil: { nome: "Corretiva" } }, data: { exigirFotoAntesDepois: false } });
    expect((await linha("Ana Dias")).composicao[1].detalhe).toBe("0 de 1 relatório");
    expect((await linha("Edu Prado")).composicao[1].detalhe).toBe("1 de 1 relatório");
    await prisma.desempenhoRegra.updateMany({ where: { perfil: { nome: "Corretiva" } }, data: { exigirFotoAntesDepois: true } });
  });

  it("ATIVIDADE DE EQUIPE: todos os executores levam o resultado — uma vez cada (sem dobra) — e a nota da OS também", async () => {
    await zerarOperacao();
    await servico({ tecnicos: ["t1", "t2", "t3"], equipeId: "eqA", agendada: br("2026-11-04"), concluida: br("2026-11-05", "09:00"), nota: 4 }); // atrasada
    for (const nome of ["Ana Dias", "Bia Reis", "Edu Prado"]) {
      expect((await linha(nome)).composicao.map((c: any) => c.detalhe), nome).toEqual(["0 de 1 atividade", "1 de 1 relatório", "média 4,0 em 1 avaliação"]);
    }
    // O encarregado da equipe vê a mesma atividade UMA vez (e não três, uma por membro)
    expect((await linha("Carlos Lider")).composicao.map((c: any) => c.detalhe)).toEqual(["0 de 1 atividade", "1 de 1 relatório", "média 4,0 em 1 avaliação"]);
    // O mesmo técnico como responsável E na equipe da atividade conta uma vez
    const s = await servico({ tecnicos: ["t1"] });
    await prisma.atividadeTecnico.create({ data: { atividadeId: s.atividade, tecnicoId: "t1" } });
    expect((await linha("Ana Dias")).composicao[0].detalhe).toBe("1 de 2 atividades");
  });

  it("encarregado: mede as equipes ATIVAS que lidera — pela equipe da atividade ou por um membro; sem equipe, sem medição", async () => {
    await zerarOperacao();
    await servico({ tecnicos: ["t2"], nota: 5 });                                // membro da Alfa, atividade sem equipe marcada: conta
    await servico({ tecnicos: ["t5"], equipeId: "eqA", nota: 3 });               // atividade da Alfa feita por quem não é membro: conta
    await servico({ tecnicos: ["t1"], nota: 1 });                                // Ana só está na equipe INATIVA: não conta
    const carlos = await linha("Carlos Lider");
    expect(carlos.composicao.map((c: any) => c.detalhe)).toEqual(["2 de 2 atividades", "2 de 2 relatórios", "média 4,0 em 2 avaliações"]);
    expect(carlos.escore).toBe(90);
    await prisma.equipe.update({ where: { id: "eqA" }, data: { liderId: null } });
    expect(await linha("Carlos Lider")).toMatchObject({ escore: null, posicao: null });
    await prisma.equipe.update({ where: { id: "eqA" }, data: { liderId: "t4" } });
  });

  it("métrica sem dado NÃO vira zero: sem avaliação, o peso vai para as outras; sem nada medido, não há escore", async () => {
    await zerarOperacao();
    expect(await linha("Ana Dias")).toMatchObject({ escore: null, posicao: null, faixa: null, bonus: 0 });
    await servico({ tecnicos: ["t1"] }); // no prazo, completo, sem nota
    const ana = await linha("Ana Dias");
    expect(ana).toMatchObject({ escore: 100, posicao: 1, faixa: "Ouro" });
    expect(ana.composicao.map((c: any) => `${c.valor}:${c.pontos}`)).toEqual(["100:57.1", "100:42.9", "null:null"]);
  });

  /* ───────── penalidades: nunca automáticas ───────── */

  it("só a RESSALVA SEM NOTA entra 'A REVISAR'; NOTA BAIXA não é penalidade (já pesa na média) — um item por aceite e por colaborador, só participantes", async () => {
    await zerarOperacao();
    const comRessalva = await servico({ tecnicos: ["t1", "t5"], ressalva: "O dreno voltou a pingar" });           // sem nota; t5 não participa
    await servico({ tecnicos: ["t2"], ressalva: "Ficou com barulho" });                                            // sem nota
    await servico({ tecnicos: ["t3"], ressalva: "Faltou limpar a sala" });                                         // sem nota
    await servico({ tecnicos: ["t2"], nota: 2, comentario: "Demorou e deixou sujeira" });                          // NOTA BAIXA: só na média
    const comNota = await servico({ tecnicos: ["t2"], nota: 1, ressalva: "Não resolveu" });                        // ressalva COM nota: a nota já está na média
    await servico({ tecnicos: ["t3"], ressalva: "OS cancelada", statusOs: "CANCELADA" });                          // OS cancelada: fora
    await servico({ tecnicos: ["t1"], ressalva: "Antiga", confirmadoEm: br("2026-10-31", "20:00") });              // antes do mês em que o módulo começou: fora
    const lista = await itens();
    expect(resumo(lista)).toEqual(["Ana Dias:RESSALVA:A_REVISAR", "Bia Reis:RESSALVA:A_REVISAR", "Edu Prado:RESSALVA:A_REVISAR"]);
    const ana = lista.find((p) => p.tecnico.nome === "Ana Dias");
    expect(ana).toMatchObject({ descricao: `${comRessalva.numero}: ressalva do cliente — "O dreno voltou a pingar"`, competencia: MES, manual: false, mesFechado: false, motivo: null, ordemServico: { id: comRessalva.os, numero: comRessalva.numero }, osRetorno: null });
    // As notas baixas da Bia (2 e 1) pesam UMA vez só: na média da avaliação — sem item e sem desconto
    expect(await linha("Bia Reis")).toMatchObject({ desconto: 0, composicao: expect.arrayContaining([expect.objectContaining({ metrica: "avaliacao", valor: 30, detalhe: "média 1,5 em 2 avaliações" })]) });
    // Detectar de novo (abrir a lista, o painel, a ficha) não duplica
    await itens(); await painel(); await chamar(R.ficha, "GET", { id: "t1" });
    expect(await prisma.desempenhoPenalidade.count()).toBe(3);

    // LEGADO: itens de nota baixa e de ressalva COM nota gravados pela regra antiga — até os já marcados "Conta" —
    // continuam no banco, mas não aparecem, não se decidem e não descontam mais nada
    const antes = await escore("Bia Reis");
    await prisma.desempenhoPenalidade.createMany({ data: [
      { id: "legadoNota", empresaId: "e1", tecnicoId: "t2", tipo: "NOTA_BAIXA", chave: "LEGADO:nota", ordemServicoId: comNota.os, dataFato: br("2026-11-05"), competencia: MES, situacao: "CONTA", motivo: "Regra antiga" },
      { id: "legadoRessalva", empresaId: "e1", tecnicoId: "t2", tipo: "RESSALVA", chave: "LEGADO:ressalva", ordemServicoId: comNota.os, dataFato: br("2026-11-05"), competencia: MES, situacao: "CONTA", motivo: "Regra antiga" },
      { id: "legadoARevisar", empresaId: "e1", tecnicoId: "t2", tipo: "NOTA_BAIXA", chave: "LEGADO:arevisar", ordemServicoId: comNota.os, dataFato: br("2026-11-05"), competencia: MES },
    ] });
    expect(await linha("Bia Reis")).toMatchObject({ escore: antes, desconto: 0, penalidades: { retornos: 0, reclamacoes: 0 } });
    expect(resumo(await itens())).toEqual(["Ana Dias:RESSALVA:A_REVISAR", "Bia Reis:RESSALVA:A_REVISAR", "Edu Prado:RESSALVA:A_REVISAR"]);
    expect(await itens("?situacao=CONTA")).toEqual([]);
    expect((await chamar(R.penalidades, "GET")).json.aRevisar).toBe(3);
    expect((await painel()).aRevisar).toBe(3);
    expect((await chamar(R.ficha, "GET", { id: "t2" })).json.penalidades.map((x: any) => x.tipo)).toEqual(["RESSALVA"]);
    expect(await erro(decidir("legadoARevisar", "CONTA", "Tentando contar a nota baixa"))).toBe("404 Item não encontrado.");
    expect(await erro(decidir("legadoNota", "A_REVISAR"))).toBe("404 Item não encontrado.");
    expect(await prisma.desempenhoPenalidade.count()).toBe(6); // nada foi apagado
  });

  it("NADA pesa sozinho: o escore só muda depois de 'CONTA' com motivo; 'não conta' não desconta; dá para rever", async () => {
    const antes = await escore("Ana Dias");
    const [item] = (await itens()).filter((p) => p.tecnico.nome === "Ana Dias");
    expect((await linha("Ana Dias")).desconto).toBe(0);
    // Motivo obrigatório
    expect(await erro(decidir(item.id, "CONTA"))).toBe("400 Explique o motivo da decisão (mínimo 5 caracteres).");
    expect(await erro(decidir(item.id, "NAO_CONTA", "  ab  "))).toBe("400 Explique o motivo da decisão (mínimo 5 caracteres).");
    expect(await erro(decidir(item.id, "APROVAR", "qualquer"))).toMatch(/^400/);
    expect(await escore("Ana Dias")).toBe(antes);
    // Conta: −5 pontos (penalidadeReclamacao), com quem decidiu e quando
    const r = await decidir(item.id, "CONTA", "  O dreno não foi desentupido  ");
    expect(r.json).toMatchObject({ situacao: "CONTA", motivo: "O dreno não foi desentupido", revisadoPor: "Gil Gestor", revisadoEm: AGORA.toISOString() });
    expect(await linha("Ana Dias")).toMatchObject({ escore: antes - 5, desconto: 5, penalidades: { retornos: 0, reclamacoes: 1, pontosRetorno: 0, pontosReclamacao: 5 } });
    // Não conta: registrado, sem desconto
    expect((await decidir(item.id, "NAO_CONTA", "Vazamento era de outro aparelho")).json).toMatchObject({ situacao: "NAO_CONTA", motivo: "Vazamento era de outro aparelho" });
    expect(await linha("Ana Dias")).toMatchObject({ escore: antes, desconto: 0 });
    // Rever: volta para "a revisar", sem motivo nem revisor
    await decidir(item.id, "CONTA", "Confirmado com o cliente");
    expect((await decidir(item.id, "A_REVISAR")).json).toMatchObject({ situacao: "A_REVISAR", motivo: null, revisadoPor: null, revisadoEm: null });
    expect(await escore("Ana Dias")).toBe(antes);
    // Filtros da lista
    await decidir(item.id, "CONTA", "Confirmado com o cliente");
    expect(resumo(await itens("?situacao=CONTA"))).toEqual(["Ana Dias:RESSALVA:CONTA"]);
    expect(resumo(await itens("?situacao=A_REVISAR"))).toEqual(["Bia Reis:RESSALVA:A_REVISAR", "Edu Prado:RESSALVA:A_REVISAR"]);
    expect(await itens("?situacao=NAO_CONTA")).toEqual([]);
    expect(await itens("?mes=2026-10")).toEqual([]);
    expect(await itens(`?mes=${MES}&situacao=INVENTADA`)).toHaveLength(3);
    expect((await chamar(R.penalidades, "GET")).json.aRevisar).toBe(2);
    // A ficha mostra os itens do mês do colaborador, com a situação e o motivo
    expect((await chamar(R.ficha, "GET", { id: "t1" })).json.penalidades).toEqual([expect.objectContaining({ tipo: "RESSALVA", situacao: "CONTA", motivo: "Confirmado com o cliente" })]);
  });

  it("NINGUÉM revisa a própria penalidade; item de outra empresa não existe; a decisão exige a permissão de revisar", async () => {
    const lista = await itens();
    const daBia = lista.find((p) => p.tecnico.nome === "Bia Reis");
    // A Bia tem permissão de revisar e está ligada ao colaborador t2 (pelo login ou pelo e-mail)
    com(["visualizar", "revisar"], { id: "uT", tecnicoId: "t2" });
    expect(await erro(decidir(daBia.id, "NAO_CONTA", "Não fui eu, juro"))).toMatch(/^403 Não é possível revisar a própria penalidade/);
    com(["visualizar", "revisar"], { id: "uT", tecnicoId: null, email: "BIA@x.com" });
    expect(await erro(decidir(daBia.id, "NAO_CONTA", "Não fui eu, juro"))).toMatch(/^403 Não é possível revisar a própria penalidade/);
    expect((await prisma.desempenhoPenalidade.findUnique({ where: { id: daBia.id } })).situacao).toBe("A_REVISAR");
    // A do colega ela pode
    const doEdu = lista.find((p) => p.tecnico.nome === "Edu Prado");
    expect((await decidir(doEdu.id, "NAO_CONTA", "Cliente retirou a reclamação")).status).toBe(200);
    com(["visualizar"]);
    expect((await decidir(daBia.id, "CONTA", "Sem permissão")).status).toBe(403);
    gestao({ empresaId: "e2" });
    expect(await erro(decidir(daBia.id, "CONTA", "Outra empresa"))).toBe("404 Item não encontrado.");
    expect(await itens()).toEqual([]);
  });

  it("RETORNO: OS corretiva no mesmo equipamento até N dias depois do ÚLTIMO serviço — vai para quem fez esse serviço", async () => {
    await zerarOperacao();
    const antigo = await servico({ tecnicos: ["t1"], equipamento: "q2", concluida: br("2026-11-02", "16:00") });
    const ultimo = await servico({ tecnicos: ["t2", "t3", "t5"], equipamento: "q2", concluida: br("2026-11-05", "16:00") }); // t5 não participa
    const ret = await corretiva("q2", br("2026-11-10", "09:00"));
    void antigo;
    const lista = await itens();
    // Só o último serviço conta (Bia e Edu); a Ana, do serviço anterior, não é envolvida
    expect(resumo(lista)).toEqual(["Bia Reis:RETORNO:A_REVISAR", "Edu Prado:RETORNO:A_REVISAR"]);
    expect(lista[0]).toMatchObject({
      descricao: `${ret.numero} (corretiva) aberta 5 dias depois do serviço da ${ultimo.numero} em AC-002 · Split 2`,
      ordemServico: { id: ultimo.os }, osRetorno: { id: ret.os, numero: ret.numero }, competencia: MES, dataFato: br("2026-11-10", "09:00").toISOString(),
    });
    // Conta como RETORNO (pontos de retorno), só depois da revisão
    const antes = await escore("Bia Reis");
    await decidir(lista.find((p) => p.tecnico.nome === "Bia Reis").id, "CONTA", "Faltou reapertar a conexão");
    expect(await linha("Bia Reis")).toMatchObject({ escore: antes - 5, penalidades: { retornos: 1, reclamacoes: 0, pontosRetorno: 5, pontosReclamacao: 0 } });
    expect(await escore("Edu Prado")).toBe(await escore("Edu Prado")); // o do Edu segue a revisar, sem pesar
    expect((await linha("Edu Prado")).desconto).toBe(0);
  });

  it("retorno: fora do prazo, tipo não marcado como corretiva, OS cancelada ou a própria OS não entram", async () => {
    await zerarOperacao();
    await servico({ tecnicos: ["t1"], equipamento: "q3", concluida: br("2026-10-05", "16:00") });           // 36 dias antes: fora dos 30
    await corretiva("q3", br("2026-11-10", "09:00"));
    await servico({ tecnicos: ["t2"], equipamento: "q4", concluida: br("2026-11-05", "16:00") });
    await corretiva("q4", br("2026-11-09", "09:00"), {}, "toPrev");                                          // tipo que não conta como corretiva
    await corretiva("q4", br("2026-11-09", "10:00"), { status: "CANCELADA" });                               // corretiva cancelada
    await servico({ tecnicos: ["t3"], equipamento: "q1", status: "EM_ANDAMENTO" });                          // serviço ainda NÃO concluído: não é origem de retorno
    await corretiva("q1", br("2026-11-10", "09:00"));
    expect(await itens()).toEqual([]);
    // Dentro do prazo exato (30 dias) entra
    await prisma.desempenhoConfig.updateMany({ data: { retornoDias: 36 } });
    expect(resumo(await itens())).toEqual(["Ana Dias:RETORNO:A_REVISAR"]);
    await prisma.desempenhoConfig.updateMany({ data: { retornoDias: 30 } });
    // Sem nenhum tipo marcado, nenhum retorno é detectado
    await zerarOperacao();
    await prisma.desempenhoTipoRetorno.deleteMany({});
    await servico({ tecnicos: ["t1"], equipamento: "q3" });
    await corretiva("q3", br("2026-11-10", "09:00"));
    expect(await itens()).toEqual([]);
    await prisma.desempenhoTipoRetorno.create({ data: { empresaId: "e1", tipoOsId: "toCorr" } });
    expect(resumo(await itens())).toEqual(["Ana Dias:RETORNO:A_REVISAR"]);
  });

  it("NUNCA penaliza quem REGISTROU o problema: atenção no checklist, ocorrência ou serviço adicional no serviço anterior = sem retorno", async () => {
    await zerarOperacao();
    // 1) Apontou ATENÇÃO no checklist daquele equipamento
    await servico({ tecnicos: ["t1"], equipamento: "q1", relatorio: "atencao" });
    await corretiva("q1", br("2026-11-10", "09:00"));
    // 2) Registrou serviço adicional naquele equipamento
    const adicional = await servico({ tecnicos: ["t2"], equipamento: "q2" });
    await prisma.servicoAdicional.create({ data: { empresaId: "e1", ordemServicoId: adicional.os, atividadeId: adicional.atividade, equipamentoId: "q2", descricao: "Capacitor estufado" } });
    await corretiva("q2", br("2026-11-10", "09:00"));
    // 3) Abriu ocorrência (PMOC) naquela visita
    const comOcorrencia = await servico({ tecnicos: ["t3"], equipamento: "q3" });
    await prisma.pmoc.create({ data: { id: "pm1", empresaId: "e1", clienteId: "c1", unidadeId: "u1", nome: "Plano", dataInicio: new Date("2026-01-01"), dataExpiracao: new Date("2026-12-31") } });
    await prisma.pmocOcorrencia.create({ data: { id: "oc1", empresaId: "e1", pmocId: "pm1", data: new Date("2026-11-05"), descricao: "Vazamento na serpentina", gravidade: "ALTA", atividadeId: comOcorrencia.atividade, equipamentoId: "q3" } });
    await corretiva("q3", br("2026-11-10", "09:00"));
    expect(await itens()).toEqual([]);
    // Sem o registro, a mesma situação É levada à revisão (a regra acima é o que protege quem registrou)
    await prisma.servicoAdicional.deleteMany({}); await prisma.pmocOcorrencia.deleteMany({});
    expect(resumo(await itens())).toEqual(["Bia Reis:RETORNO:A_REVISAR", "Edu Prado:RETORNO:A_REVISAR"]);
  });

  it("OS corretiva nascida de ocorrência registrada ou de orçamento aprovado não é retorno; ocorrência de OUTRO equipamento não protege", async () => {
    await zerarOperacao();
    await servico({ tecnicos: ["t1"], equipamento: "q1" });
    const daOcorrencia = await corretiva("q1", br("2026-11-10", "09:00"));
    await prisma.pmocOcorrencia.create({ data: { id: "oc2", empresaId: "e1", pmocId: "pm1", data: new Date("2026-11-08"), descricao: "Ruído", gravidade: "MEDIA", osCorretivaId: daOcorrencia.os } });
    await servico({ tecnicos: ["t2"], equipamento: "q2" });
    await prisma.orcamento.create({ data: { id: "or1", empresaId: "e1", codigo: "ORC-1", nome: "Troca de compressor", clienteId: "c1", criadoPorId: "uA", tokenPublico: "tok-or1" } });
    await corretiva("q2", br("2026-11-10", "09:00"), { orcamentoOrigemId: "or1" });
    expect(await itens()).toEqual([]);
    // Ocorrência registrada na visita, mas de OUTRO equipamento: não vale para este
    const s = await servico({ tecnicos: ["t3"], equipamento: "q3" });
    await prisma.pmocOcorrencia.create({ data: { id: "oc3", empresaId: "e1", pmocId: "pm1", data: new Date("2026-11-05"), descricao: "Outro aparelho", gravidade: "BAIXA", atividadeId: s.atividade, equipamentoId: "q4" } });
    await corretiva("q3", br("2026-11-10", "09:00"));
    expect(resumo(await itens())).toEqual(["Edu Prado:RETORNO:A_REVISAR"]);
    await prisma.pmocOcorrencia.deleteMany({}); await prisma.orcamento.deleteMany({});
  });

  it("reclamação registrada à mão: nasce 'a revisar' (registrar não é penalizar); editar volta para a revisão; excluir — só as manuais", async () => {
    await zerarOperacao();
    const s = await servico({ tecnicos: ["t1"] });
    const base = { tecnicoId: "t1", data: "2026-11-10", descricao: "Cliente ligou: sala ficou suja" };
    expect(await erro(chamar(R.penalidades, "POST", {}, { ...base, tecnicoId: "t5" }))).toBe("404 Este colaborador não participa do Desempenho.");
    expect(await erro(chamar(R.penalidades, "POST", {}, { ...base, tecnicoId: "tE2" }))).toBe("404 Este colaborador não participa do Desempenho.");
    expect(await erro(chamar(R.penalidades, "POST", {}, { ...base, data: "2026-11-15" }))).toBe("400 A data da reclamação não pode ser no futuro.");
    expect(await erro(chamar(R.penalidades, "POST", {}, { ...base, osNumero: "OS-NAO-EXISTE" }))).toMatch(/^404 OS não encontrada/);
    expect(await erro(chamar(R.penalidades, "POST", {}, { ...base, descricao: "curta" }))).toMatch(/^400 Descreva a reclamação/);
    const antes = await escore("Ana Dias");
    const criada = await chamar(R.penalidades, "POST", {}, { ...base, osNumero: s.numero.toLowerCase() });
    expect(criada.status).toBe(201);
    expect(criada.json).toMatchObject({ tipo: "RECLAMACAO", situacao: "A_REVISAR", manual: true, competencia: MES, criadoPor: "Gil Gestor", ordemServico: { id: s.os }, tecnico: { id: "t1" } });
    expect(criada.json.dataFato).toBe(br("2026-11-10", "12:00").toISOString());
    expect(await escore("Ana Dias")).toBe(antes); // registrada, ainda não pesa
    await decidir(criada.json.id, "CONTA", "Confirmado por foto do cliente");
    expect(await escore("Ana Dias")).toBe(antes - 5);
    // Editar muda o fato: a decisão cai e volta para a revisão
    const editada = await chamar(R.penalidade, "PUT", { id: criada.json.id }, { ...base, data: "2026-11-11", descricao: "Cliente ligou: sala ficou suja de pó" });
    expect(editada.json).toMatchObject({ situacao: "A_REVISAR", motivo: null, revisadoPor: null, descricao: "Cliente ligou: sala ficou suja de pó", ordemServico: null });
    expect(await escore("Ana Dias")).toBe(antes);
    // Reclamação de mês anterior pesa no mês dela
    expect((await chamar(R.penalidade, "PUT", { id: criada.json.id }, { ...base, data: "2026-10-20" })).json.competencia).toBe("2026-10");
    await decidir(criada.json.id, "CONTA", "Vale para outubro");
    expect(await escore("Ana Dias")).toBe(antes); // conta em OUTUBRO: novembro não muda
    // OS de outra empresa não pode ser ligada à minha reclamação
    const daOutra = await servico({ tecnicos: ["tE2"], empresaId: "e2", equipamento: null });
    expect(await erro(chamar(R.penalidades, "POST", {}, { ...base, osNumero: daOutra.numero }))).toMatch(/^404 OS não encontrada/);
    // Outra empresa não edita nem exclui
    gestao({ empresaId: "e2" });
    expect(await erro(chamar(R.penalidade, "PUT", { id: criada.json.id }, base))).toBe("404 Item não encontrado.");
    expect(await erro(chamar(R.penalidade, "DELETE", { id: criada.json.id }))).toBe("404 Item não encontrado.");
    gestao();
    expect((await chamar(R.penalidade, "DELETE", { id: criada.json.id })).status).toBe(200);
    expect(await prisma.desempenhoPenalidade.count({ where: { id: criada.json.id } })).toBe(0);
    // As detectadas (retorno, ressalva, nota) não se editam nem se excluem: decide-se "não conta"
    await servico({ tecnicos: ["t1"], ressalva: "Não resolveu" });
    const [detectada] = await itens();
    expect(await erro(chamar(R.penalidade, "PUT", { id: detectada.id }, base))).toBe("409 Só a reclamação registrada à mão pode ser editada ou excluída.");
    expect(await erro(chamar(R.penalidade, "DELETE", { id: detectada.id }))).toBe("409 Só a reclamação registrada à mão pode ser editada ou excluída.");
    expect(await prisma.desempenhoPenalidade.count()).toBe(1);
  });

  /* ───────── premiação e modo TV ───────── */

  it("premiação do mês: cadastrar (texto + imagem), editar, tirar a imagem, excluir; aparece no painel e na ficha de quem disputa", async () => {
    const prev = await perfilId("Preventiva");
    expect(await erro(chamar(R.premiacoes, "POST", {}, { competencia: MES, titulo: "K" }))).toMatch(/^400 Dê um título/);
    expect(await erro(chamar(R.premiacoes, "POST", {}, { competencia: MES, titulo: "Kit", imagem: "data:image/svg+xml;base64,QUJD" }))).toMatch(/^400 A imagem do brinde/);
    expect(await erro(chamar(R.premiacoes, "POST", {}, { competencia: MES, titulo: "Kit", perfilId: "nao-existe" }))).toBe("404 Perfil não encontrado.");
    const kit = await chamar(R.premiacoes, "POST", {}, { competencia: MES, titulo: "Kit de ferramentas", descricao: "Para o 1º lugar", perfilId: prev, imagem: IMAGEM });
    const jantar = await chamar(R.premiacoes, "POST", {}, { competencia: MES, titulo: "Vale-jantar" });
    const dezembro = await chamar(R.premiacoes, "POST", {}, { competencia: "2026-12", titulo: "Folga extra" });
    expect([kit.status, jantar.status, dezembro.status]).toEqual([201, 201, 201]);
    const lista = (await chamar(R.premiacoes, "GET", {}, undefined, `?mes=${MES}`)).json;
    expect(lista).toEqual([
      { id: kit.json.id, competencia: MES, titulo: "Kit de ferramentas", descricao: "Para o 1º lugar", perfilId: prev, perfil: "Preventiva", temImagem: true },
      { id: jantar.json.id, competencia: MES, titulo: "Vale-jantar", descricao: null, perfilId: null, perfil: null, temImagem: false },
    ]);
    expect(JSON.stringify(lista)).not.toContain("base64"); // a lista não carrega a imagem
    expect((await chamar(R.premiacoes, "GET")).json.map((p: any) => p.titulo)).toEqual(["Folga extra", "Kit de ferramentas", "Vale-jantar"]);
    // A imagem é servida à parte, como imagem
    const img = await chamar(R.imagem, "GET", { id: kit.json.id });
    expect(img).toMatchObject({ status: 200, tipo: "image/jpeg", bytes: 120 });
    expect((await chamar(R.imagem, "GET", { id: jantar.json.id })).status).toBe(404);
    // No painel do mês e na ficha: a Preventiva disputa os dois; a Corretiva só o de todos
    expect((await painel()).premiacoes.map((p: any) => `${p.titulo}:${p.perfil}:${p.temImagem}`)).toEqual(["Kit de ferramentas:Preventiva:true", "Vale-jantar:null:false"]);
    expect((await chamar(R.ficha, "GET", { id: "t1" })).json.premiacoes.map((p: any) => p.titulo)).toEqual(["Kit de ferramentas", "Vale-jantar"]);
    expect((await chamar(R.ficha, "GET", { id: "t3" })).json.premiacoes.map((p: any) => p.titulo)).toEqual(["Vale-jantar"]);
    // Editar sem mandar imagem mantém a imagem; null tira
    expect((await chamar(R.premiacao, "PUT", { id: kit.json.id }, { competencia: MES, titulo: "Kit de ferramentas Bosch", perfilId: prev })).status).toBe(200);
    expect(await prisma.desempenhoPremiacao.findUnique({ where: { id: kit.json.id } })).toMatchObject({ titulo: "Kit de ferramentas Bosch", imagem: IMAGEM, descricao: null });
    expect((await chamar(R.premiacao, "PUT", { id: kit.json.id }, { competencia: MES, titulo: "Kit de ferramentas Bosch", imagem: null })).status).toBe(200);
    expect(await prisma.desempenhoPremiacao.findUnique({ where: { id: kit.json.id } })).toMatchObject({ imagem: null, perfilId: null });
    await chamar(R.premiacao, "PUT", { id: kit.json.id }, { competencia: MES, titulo: "Kit de ferramentas", perfilId: prev, imagem: IMAGEM });
    // Outra empresa: não vê, não edita, não exclui, não baixa a imagem
    gestao({ empresaId: "e2" });
    expect((await chamar(R.premiacoes, "GET")).json).toEqual([]);
    expect(await erro(chamar(R.premiacao, "PUT", { id: kit.json.id }, { competencia: MES, titulo: "Roubada" }))).toBe("404 Premiação não encontrada.");
    expect(await erro(chamar(R.premiacao, "DELETE", { id: kit.json.id }))).toBe("404 Premiação não encontrada.");
    expect((await chamar(R.imagem, "GET", { id: kit.json.id })).status).toBe(404);
    gestao();
    expect((await chamar(R.premiacao, "DELETE", { id: dezembro.json.id })).status).toBe(200);
    expect(await erro(chamar(R.premiacao, "DELETE", { id: dezembro.json.id }))).toBe("404 Premiação não encontrada.");
  });

  it("MODO TV: link público por token — ranking e prêmio do mês corrente, SEM valor em reais; trocar ou desligar o link derruba o anterior", async () => {
    expect((await chamar(R.tvPublica, "GET", { token: "token-que-nao-existe-1234567890" })).status).toBe(404);
    expect((await chamar(R.tvPublica, "GET", { token: "" })).status).toBe(404);
    const { tvToken } = (await chamar(R.tv, "POST")).json;
    expect(tvToken).toMatch(/^[\w-]{32}$/);
    sessao.atual = null; // a TV não tem login
    const tv = await chamar(R.tvPublica, "GET", { token: tvToken });
    expect(tv.status).toBe(200);
    expect(tv.json).toMatchObject({ empresa: "Clima Total", competencia: MES, atualizadoEm: AGORA.toISOString() });
    expect(tv.json.grupos.map((g: any) => g.perfil)).toEqual(["Preventiva", "Corretiva", "Encarregado"]); // "Instalação" não tem ninguém
    expect(Object.keys(tv.json.grupos[0].linhas[0]).sort()).toEqual(["escore", "faixa", "nome", "posicao"]);
    expect(tv.json.premiacoes.map((p: any) => `${p.titulo}:${p.temImagem}`)).toEqual(["Kit de ferramentas:true", "Vale-jantar:false"]);
    const texto = JSON.stringify(tv.json);
    for (const proibido of ["bonus", "valor", "composicao", "penalidade", "desconto", "tecnicoId", "metaMinima", "base64"]) expect(texto, proibido).not.toContain(proibido);
    // A imagem do brinde sai pela rota pública — só com o token da empresa dona
    const kit = await prisma.desempenhoPremiacao.findFirstOrThrow({ where: { titulo: "Kit de ferramentas" } });
    expect(await chamar(R.tvImagem, "GET", { token: tvToken, id: kit.id })).toMatchObject({ status: 200, tipo: "image/jpeg" });
    expect((await chamar(R.tvImagem, "GET", { token: "token-que-nao-existe-1234567890", id: kit.id })).status).toBe(404);
    // Outra empresa com o link DELA não enxerga o brinde da minha
    gestao({ empresaId: "e2" });
    const outra = (await chamar(R.tv, "POST")).json.tvToken;
    expect((await chamar(R.tvImagem, "GET", { token: outra, id: kit.id })).status).toBe(404);
    expect((await chamar(R.tvPublica, "GET", { token: outra })).json).toMatchObject({ empresa: "Outra Climatização", grupos: [], premiacoes: [] });
    await prisma.desempenhoPerfil.deleteMany({ where: { empresaId: "e2" } }); await prisma.desempenhoConfig.deleteMany({ where: { empresaId: "e2" } });
    // Trocar o link: o antigo morre
    gestao();
    const novo = (await chamar(R.tv, "POST")).json.tvToken;
    expect(novo).not.toBe(tvToken);
    expect((await chamar(R.tvPublica, "GET", { token: tvToken })).status).toBe(404);
    expect((await chamar(R.tvPublica, "GET", { token: novo })).status).toBe(200);
    expect((await chamar(R.config, "GET")).json.tvToken).toBe(novo);
    // Desligar
    expect((await chamar(R.tv, "DELETE")).json).toEqual({ tvToken: null });
    expect((await chamar(R.tvPublica, "GET", { token: novo })).status).toBe(404);
  });

  /* ───────── a data de conclusão passa a ser gravada ───────── */

  it("concluir pelo APP grava a hora do TOQUE no aparelho (mesmo chegando depois); repetir não troca a data", async () => {
    await zerarOperacao();
    const s = await servico({ tecnicos: ["t2"], status: "EM_ANDAMENTO", agendada: br("2026-11-12", "09:00") });
    entrar(PRESETS.TECNICO, { id: "uT", role: "TECNICO", tecnicoId: "t2", email: "bia@x.com" });
    // Tocou "concluir" ontem às 17:30, sem sinal; a fila subiu hoje (18h30 depois, no relógio do aparelho)
    const op = { id: randomUUID(), tipo: "concluir", atividadeId: s.atividade, em: "2026-11-12T17:30:00-03:00", dados: {} };
    const r = await chamar("tecnico/sync", "POST", {}, { operacoes: [op], agora: "2026-11-13T12:00:00-03:00" });
    expect(r.json.resultados[0], JSON.stringify(r.json)).toMatchObject({ ok: true });
    const gravada = async () => (await prisma.atividadeOs.findUnique({ where: { id: s.atividade }, select: { status: true, concluidaEm: true } }));
    expect(await gravada()).toEqual({ status: "CONCLUIDA", concluidaEm: br("2026-11-12", "17:30") });
    // No prazo (a agenda era dia 12) — pela hora de chegada (dia 13) teria sido "atrasada"
    gestao();
    expect((await linha("Bia Reis")).composicao[0].detalhe).toBe("1 de 1 atividade");
    // Reenviar a mesma operação e concluir de novo não mexe na data
    entrar(PRESETS.TECNICO, { id: "uT", role: "TECNICO", tecnicoId: "t2", email: "bia@x.com" });
    await chamar("tecnico/sync", "POST", {}, { operacoes: [op, { id: randomUUID(), tipo: "concluir", atividadeId: s.atividade, dados: {} }] });
    expect((await gravada()).concluidaEm).toEqual(br("2026-11-12", "17:30"));
  });

  it("concluir pela tela do ESCRITÓRIO grava agora; reabrir limpa; editar outra coisa não mexe na data", async () => {
    const s = await servico({ tecnicos: ["t1"], status: "EM_ANDAMENTO" });
    entrar(permissoesTotais(), { id: "uA", role: "ADMIN" });
    const rota = "ordens/[id]/atividades/[atividadeId]", params = { id: s.os, atividadeId: s.atividade };
    const data = async () => (await prisma.atividadeOs.findUnique({ where: { id: s.atividade }, select: { concluidaEm: true } })).concluidaEm;
    expect(await data()).toBeNull();
    expect((await chamar(rota, "PUT", params, { status: "CONCLUIDA" })).status).toBe(200);
    expect(await data()).toEqual(AGORA);
    vi.setSystemTime(new Date("2026-11-13T18:00:00Z"));
    expect((await chamar(rota, "PUT", params, { titulo: "Visita geral" })).status).toBe(200);
    expect((await chamar(rota, "PUT", params, { status: "CONCLUIDA" })).status).toBe(200); // já estava concluída
    expect(await data()).toEqual(AGORA);
    expect((await chamar(rota, "PUT", params, { status: "EM_ANDAMENTO" })).status).toBe(200);
    expect(await data()).toBeNull();
    expect((await chamar(rota, "PUT", params, { status: "CONCLUIDA" })).status).toBe(200);
    expect(await data()).toEqual(new Date("2026-11-13T18:00:00Z")); // concluiu de novo: a data nova
  });

  /* ───────── RBAC ───────── */

  it("RBAC: cada rota pede a sua permissão — ver, revisar, gerenciar; sem login, 401", async () => {
    const algumPerfil = await perfilId("Instalação");
    const kit = (await prisma.desempenhoPremiacao.findFirstOrThrow({ where: { titulo: "Kit de ferramentas" } })).id;
    const rotas: [string, string, Record<string, string>, Acao][] = [
      [R.painel, "GET", {}, "visualizar"], [R.ficha, "GET", { id: "t1" }, "visualizar"], [R.premiacoes, "GET", {}, "visualizar"], [R.imagem, "GET", { id: kit }, "visualizar"],
      [R.penalidades, "GET", {}, "revisar"], [R.penalidades, "POST", {}, "revisar"], [R.penalidade, "PUT", { id: "x" }, "revisar"], [R.penalidade, "DELETE", { id: "x" }, "revisar"],
      [R.decisao, "POST", { id: "x" }, "revisar"],
      [R.config, "GET", {}, "gerenciar"], [R.config, "PUT", {}, "gerenciar"], [R.tv, "POST", {}, "gerenciar"], [R.tv, "DELETE", {}, "gerenciar"], [R.perfis, "POST", {}, "gerenciar"],
      [R.perfil, "PUT", { id: algumPerfil }, "gerenciar"], [R.perfil, "DELETE", { id: "x" }, "gerenciar"], [R.regra, "PUT", { id: algumPerfil }, "gerenciar"],
      [R.regra, "DELETE", { id: algumPerfil }, "gerenciar"], [R.participantes, "POST", {}, "gerenciar"], [R.participante, "DELETE", { tecnicoId: "x" }, "gerenciar"],
      [R.premiacoes, "POST", {}, "gerenciar"], [R.premiacao, "PUT", { id: kit }, "gerenciar"], [R.premiacao, "DELETE", { id: "x" }, "gerenciar"],
    ];
    const tvAntes = (await prisma.desempenhoConfig.findFirstOrThrow()).tvToken;
    const corpo = (metodo: string) => (metodo === "GET" || metodo === "DELETE" ? undefined : {});
    const outras: Record<Acao, Acao[]> = { visualizar: [], revisar: ["visualizar"], gerenciar: ["visualizar", "revisar"] } as never;
    for (const [rota, metodo, params, acao] of rotas) {
      const nome = `${metodo} ${rota}`;
      sessao.atual = null;
      expect((await chamar(rota, metodo, params, corpo(metodo))).status, `${nome} sem login`).toBe(401);
      // Tudo do sistema MENOS o Desempenho: 403
      entrar({ ...permissoesTotais(), desempenho: {} });
      expect((await chamar(rota, metodo, params, corpo(metodo))).status, `${nome} sem o módulo`).toBe(403);
      // As permissões "de baixo" não bastam
      if (outras[acao].length) { com(outras[acao]); expect((await chamar(rota, metodo, params, corpo(metodo))).status, `${nome} com ${outras[acao].join("+")}`).toBe(403); }
      // A permissão exata passa do portão (o corpo vazio pode dar 400/404 — nunca 401/403)
      com([acao]);
      expect([401, 403], `${nome} com ${acao}`).not.toContain((await chamar(rota, metodo, params, corpo(metodo))).status);
    }
    // O papel ADMIN tem tudo, mesmo sem perfil de acesso
    entrar({}, { id: "uA", role: "ADMIN" });
    expect((await chamar(R.config, "GET")).status).toBe(200);
    // Nada do que foi negado mudou o banco (o POST /tv com Gerenciar acima gerou um link: é o esperado)
    expect(await prisma.desempenhoPerfil.count()).toBe(4);
    expect(tvAntes).toBeNull();
    await prisma.desempenhoConfig.updateMany({ data: { tvToken: null } });
  });

  it("o COLABORADOR vê o DELE: a própria ficha (com o bônus projetado dele), sem permissão de Desempenho — e nunca a de outro", async () => {
    await zerarOperacao();
    await servico({ tecnicos: ["t2"], nota: 5 });
    await servico({ tecnicos: ["t1"], nota: 3 });
    const comoBia = () => entrar(PRESETS.TECNICO, { id: "uT", role: "TECNICO", tecnicoId: "t2", email: "bia@x.com" });
    comoBia();
    const meu = await chamar(R.meu, "GET", {}, undefined, `?mes=${MES}`);
    expect(meu.status).toBe(200);
    expect(meu.json).toMatchObject({ participa: true, ficha: { tecnico: { id: "t2", nome: "Bia Reis" }, perfil: { nome: "Preventiva" }, linha: { escore: 100, posicao: 1, faixa: "Ouro", bonus: 350 }, participantes: 2 } });
    expect(JSON.stringify(meu.json)).not.toContain("Ana Dias"); // nenhum dado de colega
    // Não adianta pedir outro colaborador: a rota não aceita id, e as rotas do painel são 403 para ela
    expect((await chamar(R.meu, "GET", {}, undefined, "?mes=2026-11&tecnicoId=t1&id=t1")).json.ficha.tecnico.id).toBe("t2");
    expect((await chamar(R.ficha, "GET", { id: "t1" })).status).toBe(403);
    expect((await chamar(R.ficha, "GET", { id: "t2" })).status).toBe(403);
    expect((await chamar(R.painel, "GET")).status).toBe(403);
    expect((await chamar(R.penalidades, "GET")).status).toBe(403);
    // Ligado pelo e-mail (login feito antes de ser ligado ao cadastro): também acha o dele
    entrar(PRESETS.TECNICO, { id: "uT", role: "TECNICO", tecnicoId: null, email: "bia@x.com" });
    expect((await chamar(R.meu, "GET")).json.ficha.tecnico.id).toBe("t2");
    // Usuário sem colaborador, colaborador fora do Desempenho e empresa sem o módulo: "não participa", sem erro
    entrar(PRESETS.TECNICO, { id: "uG", role: "TECNICO", tecnicoId: null, email: "ninguem@x.com" });
    expect((await chamar(R.meu, "GET")).json).toEqual({ participa: false, ficha: null });
    entrar(PRESETS.TECNICO, { id: "uG", role: "TECNICO", tecnicoId: "t5" });
    expect((await chamar(R.meu, "GET")).json).toEqual({ participa: false, ficha: null });
    entrar(PRESETS.TECNICO, { empresaId: "e2", id: "uB", role: "TECNICO", tecnicoId: "tE2" });
    expect((await chamar(R.meu, "GET")).json).toEqual({ participa: false, ficha: null });
    sessao.atual = null;
    expect((await chamar(R.meu, "GET")).status).toBe(401);
  });

  it("MULTIEMPRESA: a outra empresa configura o Desempenho dela sem ver nem mexer no meu", async () => {
    gestao({ empresaId: "e2" });
    const cfg = (await chamar(R.config, "GET")).json;
    expect(cfg.perfis.map((p: any) => p.nome)).toEqual(["Preventiva", "Corretiva", "Instalação", "Encarregado"]); // os perfis DELA (mesmos nomes, outros ids)
    expect(cfg.perfis.every((p: any) => p.vigente === null && p.participantes.length === 0)).toBe(true);
    expect(cfg.disponiveis.map((t: any) => t.nome)).toEqual(["Técnico da outra"]);
    expect(cfg.tiposOs.map((t: any) => t.nome)).toEqual(["Corretiva da outra"]);
    const meu = await perfilId("Preventiva", "e1"), dela = await perfilId("Preventiva", "e2");
    expect(meu).not.toBe(dela);
    await servico({ tecnicos: ["tE2"], empresaId: "e2", equipamento: null, ressalva: "Ficou pingando" });
    expect((await chamar(R.participantes, "POST", {}, { tecnicoId: "tE2", perfilId: dela })).status).toBe(200);
    expect(await erro(chamar(R.participantes, "POST", {}, { tecnicoId: "tE2", perfilId: meu }))).toBe("404 Perfil não encontrado.");
    expect((await chamar(R.regra, "PUT", { id: dela }, REGRA())).json).toEqual({ vigenteDesde: "2026-11", imediata: true });
    const p = await painel();
    expect(p.grupos.flatMap((g: any) => g.linhas.map((l: any) => l.nome))).toEqual(["Técnico da outra"]);
    expect(p.equipes).toEqual([]);
    expect(resumo(await itens())).toEqual(["Técnico da outra:RESSALVA:A_REVISAR"]);
    // O meu painel continua só com os meus
    gestao();
    expect((await painel()).grupos.flatMap((g: any) => g.linhas.map((l: any) => l.nome))).not.toContain("Técnico da outra");
    expect((await itens()).every((i) => i.tecnico.nome !== "Técnico da outra")).toBe(true);
    expect((await prisma.desempenhoRegra.findMany({ where: { perfilId: meu } })).every((r: any) => r.empresaId === "e1")).toBe(true);
  });

  /* ───────── PR 2: fechamento, folha de bônus, histórico ───────── */

  const DEZEMBRO = new Date("2026-12-02T15:00:00Z");
  const previa = async (mes = MES) => (await chamar(R.fechamentos, "GET", {}, undefined, `?mes=${mes}`)).json.mes;
  const fechar = (competencia = MES, ciente?: boolean) => chamar(R.fechamentos, "POST", {}, { competencia, ...(ciente !== undefined && { ciente }) });
  const versoes = async () => (await prisma.desempenhoFechamento.findMany({ where: { empresaId: "e1" }, orderBy: [{ competencia: "asc" }, { versao: "asc" }] })).map((f: any) => `${f.competencia}:${f.versao}:${f.situacao}`);
  const folhaTxt = (f: any) => f.linhas.map((l: any) => `${l.posicao ?? "-"}|${l.nome}|${l.perfil}|${l.escore}|${l.faixa}|${l.valor}`);
  async function csv(id: string) {
    const mod = await import("@/app/api/desempenho/fechamentos/[id]/exportar/route");
    const res: Response = await mod.GET(new NextRequest(`${ORIGEM}/api/x`), { params: Promise.resolve({ id }) });
    return { status: res.status, tipo: res.headers.get("content-type"), arquivo: res.headers.get("content-disposition"), texto: res.status === 200 ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer()) : "" };
  }
  let reclamacaoDoEdu = "";
  let ressalvaDaBia = "";

  it("FECHAMENTO · antes de fechar só há PROJEÇÃO: a prévia mostra a folha, quem ganharia a premiação e os avisos — e nada fica gravado", async () => {
    await zerarOperacao();
    for (const nota of [5, 5, undefined]) await servico({ tecnicos: ["t1"], nota });                                  // Ana: 3 no prazo, média 5 → 100
    await servico({ tecnicos: ["t2"], equipeId: "eqA", equipamento: "q2", nota: 5 });                                  // Bia: 2 no prazo, média 5 → 100
    await servico({ tecnicos: ["t2"], equipeId: "eqA", equipamento: "q2", ressalva: "O dreno voltou a pingar" });      // ressalva sem nota: a revisar
    await servico({ tecnicos: ["t3"], equipamento: "q3", nota: 4 });                                                   // Edu: 94
    reclamacaoDoEdu = (await chamar(R.penalidades, "POST", {}, { tecnicoId: "t3", data: "2026-11-10", descricao: "Cliente ligou: deixou a sala suja" })).json.id;
    ressalvaDaBia = (await itens()).find((i) => i.tipo === "RESSALVA").id;

    const p = await previa();
    expect(p).toMatchObject({ competencia: MES, situacao: "ABERTO", bloqueio: null, fechamento: null });
    expect(folhaTxt(p.folha)).toEqual(["1|Ana Dias|Preventiva|100|Ouro|350", "1|Bia Reis|Preventiva|100|Ouro|350", "1|Edu Prado|Corretiva|94|Ouro|350", "1|Carlos Lider|Encarregado|100|Ouro|500"]);
    expect(p.folha.total).toBe(1550);
    // Hoje é 13/11: o mês está em andamento e há 2 itens sem revisão — os dois avisos
    expect(p.avisos).toEqual(["O mês ainda não terminou. O que acontecer depois do fechamento não entra no escore nem no bônus.", "Há 2 itens a revisar neste mês. Sem revisão, eles não pesam no escore fechado."]);
    // PREMIAÇÃO: Ana e Bia empatam em escore (100), em avaliação (5,0) e em penalidades (0) → ganha quem tem mais atividades no prazo
    expect(p.premios.map((x: any) => `${x.titulo}|${x.perfil}|${x.criterio}|${x.ganhadores.map((g: any) => `${g.nome}:${g.escore}`)}`)).toEqual([
      "Kit de ferramentas|Preventiva|PRAZO|Ana Dias:100", "Vale-jantar|null|PRAZO|Ana Dias:100",
    ]);
    expect(await prisma.desempenhoFechamento.count()).toBe(0);
    expect((await painel()).fechamento).toBeNull();
    expect((await chamar(R.ficha, "GET", { id: "t1" })).json).toMatchObject({ fechamento: null, premiosGanhos: [], linha: { bonus: 350 } });
    // Mês que ainda não começou não fecha; sem confirmar os avisos, também não
    expect((await previa("2026-12")).bloqueio).toBe("Este mês ainda não começou.");
    expect(await erro(fechar("2026-12", true))).toBe("409 Este mês ainda não começou.");
    expect(await erro(fechar(MES))).toMatch(/^409 O mês ainda não terminou\..* Há 2 itens a revisar neste mês\..* Confirme os avisos para fechar o mês\.$/);
    expect(await erro(fechar(MES, false))).toMatch(/Confirme os avisos/);
    expect(await erro(chamar(R.fechamentos, "POST", {}, { competencia: "11/2026" }))).toBe("400 Informe o mês a fechar.");
    expect(await erro(chamar(R.fechamentos, "POST", {}, { competencia: MES, ganhadores: { x: ["t1"] } }))).toMatch(/^400/); // ninguém escolhe o ganhador à mão
    expect(await prisma.desempenhoFechamento.count()).toBe(0);
  });

  it("FECHAR congela: escore, faixa e bônus de cada colaborador viram definitivos; a folha e os premiados ficam gravados, com quem fechou e quando", async () => {
    vi.setSystemTime(DEZEMBRO);
    // Mês terminado: sobra só o aviso dos itens sem revisão — e ele precisa ser confirmado
    expect((await previa()).avisos).toEqual(["Há 2 itens a revisar neste mês. Sem revisão, eles não pesam no escore fechado."]);
    expect(await erro(fechar(MES))).toMatch(/^409 Há 2 itens a revisar/);
    const r = await fechar(MES, true);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ competencia: MES, versao: 1, situacao: "FECHADO", total: 1550, fechadoPor: "Gestora", fechadoEm: DEZEMBRO.toISOString(), reabertoEm: null, reabertoPor: null, reaberturaMotivo: null });
    expect(folhaTxt(r.json.folha)).toEqual(["1|Ana Dias|Preventiva|100|Ouro|350", "1|Bia Reis|Preventiva|100|Ouro|350", "1|Edu Prado|Corretiva|94|Ouro|350", "1|Carlos Lider|Encarregado|100|Ouro|500"]);
    const gravado = await prisma.desempenhoFechamento.findFirstOrThrow({ include: { linhas: { orderBy: { nome: "asc" } } } });
    expect(gravado).toMatchObject({ empresaId: "e1", competencia: MES, versao: 1, situacao: "FECHADO", fechadoPorId: "uG", fechadoPorNome: "Gestora" });
    expect(gravado.totalBonus.toNumber()).toBe(1550);
    expect(gravado.linhas.map((l: any) => `${l.tecnicoId}|${l.nome}|${l.perfil}|${l.posicao}|${l.escore}|${l.faixa}|${l.valor}|${l.empresaId}`)).toEqual([
      "t1|Ana Dias|Preventiva|1|100|Ouro|350|e1", "t2|Bia Reis|Preventiva|1|100|Ouro|350|e1", "t4|Carlos Lider|Encarregado|1|100|Ouro|500|e1", "t3|Edu Prado|Corretiva|1|94|Ouro|350|e1",
    ]);
    expect(gravado.premios.map((x: any) => `${x.titulo}|${x.criterio}|${x.ganhadores.map((g: any) => g.tecnicoId)}`)).toEqual(["Kit de ferramentas|PRAZO|t1", "Vale-jantar|PRAZO|t1"]);
    // A prévia do mês passa a ser a folha gravada
    expect(await previa()).toMatchObject({ situacao: "FECHADO", bloqueio: "Este mês já está fechado.", avisos: [], fechamento: { id: gravado.id, versao: 1 }, folha: { total: 1550 } });
    // Fechar de novo: recusado, nada duplicado
    expect(await erro(fechar(MES, true))).toBe("409 Este mês já está fechado.");
    expect(await versoes()).toEqual(["2026-11:1:FECHADO"]);
  });

  it("CONGELADO de verdade: atividade, avaliação, troca de perfil, de equipe, de regra ou de premiação depois do fechamento NÃO mudam o mês fechado", async () => {
    vi.setSystemTime(DEZEMBRO);
    const antes = await painel();
    await servico({ tecnicos: ["t1"], agendada: br("2026-11-20"), concluida: br("2026-11-25", "10:00"), nota: 1 });   // atrasada e nota 1 para a Ana
    await participar("t1", "Corretiva");                                                                               // Ana muda de perfil
    await prisma.equipe.update({ where: { id: "eqA" }, data: { liderId: null } });                                     // Carlos deixa de liderar
    await prisma.desempenhoRegra.updateMany({ where: { vigenteDesde: MES }, data: { metaMinima: 99, faixas: [{ nome: "Única", minimo: 99, valor: 1 }] } });
    await prisma.desempenhoPremiacao.deleteMany({ where: { titulo: "Vale-jantar" } });
    await prisma.tecnico.update({ where: { id: "t2" }, data: { nome: "Bia Reis Souza" } });
    const depois = await painel();
    expect(depois.fechamento).toEqual({ id: expect.any(String), versao: 1, fechadoEm: DEZEMBRO.toISOString(), fechadoPor: "Gestora" });
    expect({ ...depois, fechamento: null, aRevisar: 0, semPerfil: 0 }).toEqual({ ...antes, fechamento: null, aRevisar: 0, semPerfil: 0 });
    expect(depois.grupos[0].linhas.map((l: any) => `${l.nome}:${l.escore}:${l.faixa}:${l.bonus}`)).toEqual(["Ana Dias:100:Ouro:350", "Bia Reis:100:Ouro:350"]);
    expect(depois.premiacoes.map((x: any) => x.titulo)).toEqual(["Kit de ferramentas", "Vale-jantar"]);
    // A ficha do mês fechado: bônus DEFINITIVO e a premiação que ela ganhou
    const ficha = (await chamar(R.ficha, "GET", { id: "t1" }, undefined, `?mes=${MES}`)).json;
    expect(ficha).toMatchObject({ perfil: { nome: "Preventiva" }, linha: { escore: 100, bonus: 350, faixa: "Ouro" }, fechamento: { versao: 1 }, premiosGanhos: ["Kit de ferramentas", "Vale-jantar"] });
    expect((await chamar(R.ficha, "GET", { id: "t2" }, undefined, `?mes=${MES}`)).json.premiosGanhos).toEqual([]);
    // Quem só visualiza vê o mês fechado SEM os valores em reais
    com(["visualizar", "revisar"]);
    const semValor = await painel();
    expect(semValor.grupos.flatMap((g: any) => g.linhas.map((l: any) => l.bonus))).toEqual([null, null, null, null]);
    expect(semValor.grupos[0].regra.faixas.map((f: any) => f.valor)).toEqual([null, null, null]);
    expect(semValor.grupos[0].linhas.map((l: any) => `${l.nome}:${l.escore}:${l.faixa}`)).toEqual(["Ana Dias:100:Ouro", "Bia Reis:100:Ouro"]);
    expect((await chamar(R.ficha, "GET", { id: "t1" }, undefined, `?mes=${MES}`)).json.linha.bonus).toBeNull();
    gestao();
    // O mês SEGUINTE (aberto) já usa o estado novo: é só o fechado que não muda
    expect((await painel("2026-12")).fechamento).toBeNull();
    // Desfaz as mudanças para os próximos testes
    await participar("t1", "Preventiva");
    await prisma.equipe.update({ where: { id: "eqA" }, data: { liderId: "t4" } });
    await prisma.desempenhoRegra.updateMany({ where: { vigenteDesde: MES, perfil: { nome: { in: ["Preventiva", "Corretiva"] } } }, data: { metaMinima: 70, faixas: REGRA().faixas } });
    await prisma.desempenhoRegra.updateMany({ where: { vigenteDesde: MES, perfil: { nome: "Encarregado" } }, data: { metaMinima: 70, faixas: [{ nome: "Ouro", minimo: 90, valor: 500 }] } });
    await prisma.tecnico.update({ where: { id: "t2" }, data: { nome: "Bia Reis" } });
    await chamar(R.premiacoes, "POST", {}, { competencia: MES, titulo: "Vale-jantar" });
  });

  it("mês fechado TRAVA a revisão: decidir, registrar, editar e excluir penalidade dele é recusado; item novo não nasce em mês fechado", async () => {
    vi.setSystemTime(DEZEMBRO);
    const MSG = "409 O mês 11/2026 está fechado. Reabra o mês para mudar.";
    expect(await erro(decidir(ressalvaDaBia, "CONTA", "O dreno não foi desentupido"))).toBe(MSG);
    expect(await erro(decidir(ressalvaDaBia, "NAO_CONTA", "Vazamento de outro aparelho"))).toBe(MSG);
    const base = { tecnicoId: "t3", data: "2026-11-12", descricao: "Cliente ligou: aparelho voltou a parar" };
    expect(await erro(chamar(R.penalidades, "POST", {}, base))).toBe(MSG);
    expect(await erro(chamar(R.penalidade, "PUT", { id: reclamacaoDoEdu }, base))).toBe(MSG);
    expect(await erro(chamar(R.penalidade, "DELETE", { id: reclamacaoDoEdu }))).toBe(MSG);
    // Reclamação de mês ABERTO não pode ser empurrada para o mês fechado (nem o contrário)
    const dezembro = await chamar(R.penalidades, "POST", {}, { ...base, data: "2026-12-01" });
    expect(dezembro.status).toBe(201);
    expect(await erro(chamar(R.penalidade, "PUT", { id: dezembro.json.id }, base))).toBe(MSG);
    await chamar(R.penalidade, "DELETE", { id: dezembro.json.id });
    // Ressalva de novembro que só aparece agora: a detecção não cria item no mês fechado
    const total = await prisma.desempenhoPenalidade.count();
    await servico({ tecnicos: ["t2"], ressalva: "Ficou barulho", confirmadoEm: br("2026-11-28", "10:00") });
    const lista = await itens();
    expect(await prisma.desempenhoPenalidade.count()).toBe(total);
    // Os itens do mês fechado continuam na lista, marcados — e fora da contagem do que há a revisar
    expect(lista.map((i) => `${i.tipo}:${i.situacao}:${i.mesFechado}`).sort()).toEqual(["RECLAMACAO:A_REVISAR:true", "RESSALVA:A_REVISAR:true"]);
    expect((await chamar(R.penalidades, "GET")).json.aRevisar).toBe(0);
    expect((await painel("2026-12")).aRevisar).toBe(0);
    expect(await prisma.desempenhoPenalidade.findUnique({ where: { id: ressalvaDaBia }, select: { situacao: true, motivo: true } })).toEqual({ situacao: "A_REVISAR", motivo: null });
  });

  it("FOLHA DE BÔNUS exportável: CSV para o financeiro (Excel brasileiro) — só o valor do bônus, sem imposto nem encargo", async () => {
    vi.setSystemTime(DEZEMBRO);
    const { id } = await prisma.desempenhoFechamento.findFirstOrThrow({ where: { situacao: "FECHADO" } });
    const folha = (await chamar(R.fechamento, "GET", { id })).json;
    expect(folha).toMatchObject({ id, competencia: MES, versao: 1, situacao: "FECHADO", total: 1550, folha: { total: 1550 } });
    expect(folha.premios.map((x: any) => `${x.titulo}:${x.ganhadores.map((g: any) => g.nome)}`)).toEqual(["Kit de ferramentas:Ana Dias", "Vale-jantar:Ana Dias"]);
    const arquivo = await csv(id);
    expect(arquivo).toMatchObject({ status: 200, tipo: "text/csv; charset=utf-8", arquivo: 'attachment; filename="bonus-desempenho-2026-11.csv"' });
    expect(arquivo.texto.charCodeAt(0)).toBe(0xfeff); // BOM: acentos certos ao abrir com dois cliques
    expect(arquivo.texto.slice(1).trimEnd().split("\r\n")).toEqual([
      "Competência;Colaborador;Perfil;Posição;Escore (%);Faixa;Bônus (R$);Premiação",
      "11/2026;Ana Dias;Preventiva;1;100,0;Ouro;350,00;Kit de ferramentas / Vale-jantar",
      "11/2026;Bia Reis;Preventiva;1;100,0;Ouro;350,00;",
      "11/2026;Edu Prado;Corretiva;1;94,0;Ouro;350,00;",
      "11/2026;Carlos Lider;Encarregado;1;100,0;Ouro;500,00;",
      ";Total;;;;;1550,00;",
    ]);
    expect(arquivo.texto).not.toMatch(/imposto|encargo|inss|irrf|l[ií]quido|fgts/i);
    expect((await chamar(R.fechamento, "GET", { id: "nao-existe" })).status).toBe(404);
    expect((await csv("nao-existe")).status).toBe(404);
  });

  it("REABRIR exige motivo e fica REGISTRADO (quem, quando, por quê); o mês volta a ser calculado e o fechamento antigo não é apagado", async () => {
    vi.setSystemTime(new Date("2026-12-03T15:00:00Z"));
    const { id } = await prisma.desempenhoFechamento.findFirstOrThrow({ where: { situacao: "FECHADO" } });
    const reabrir = (motivo?: unknown, qual = id) => chamar(R.reabrir, "POST", { id: qual }, motivo === undefined ? {} : { motivo });
    expect(await erro(reabrir())).toBe("400 Explique por que o mês está sendo reaberto (mínimo 10 caracteres).");
    expect(await erro(reabrir("   erro    "))).toBe("400 Explique por que o mês está sendo reaberto (mínimo 10 caracteres).");
    expect(await erro(reabrir("x".repeat(501)))).toMatch(/^400 Motivo com no máximo 500/);
    expect(await erro(reabrir("Motivo válido aqui", "nao-existe"))).toBe("404 Fechamento não encontrado.");
    expect(await versoes()).toEqual(["2026-11:1:FECHADO"]);
    entrar(montarPermissoes({ desempenho: ["visualizar", "revisar", "gerenciar"] }), { id: "uA" }); // outra pessoa reabre
    sessao.atual.user.name = "Ana Admin";
    const r = await reabrir("  Faltou revisar a ressalva da Bia  ");
    expect(r.json).toMatchObject({ id, situacao: "REABERTO", versao: 1, reabertoPor: "Ana Admin", reabertoEm: "2026-12-03T15:00:00.000Z", reaberturaMotivo: "Faltou revisar a ressalva da Bia", fechadoPor: "Gestora", total: 1550 });
    expect(await prisma.desempenhoFechamento.findUnique({ where: { id }, select: { reabertoPorId: true, fechadoPorId: true } })).toEqual({ reabertoPorId: "uA", fechadoPorId: "uG" });
    expect(await erro(reabrir("Reabrindo de novo sem querer"))).toBe("409 Este fechamento já foi reaberto.");
    expect(await prisma.desempenhoFechamentoLinha.count({ where: { fechamentoId: id } })).toBe(4); // a folha antiga continua gravada
    gestao();
    // O mês voltou a ser calculado: a atividade atrasada e a nota 1 da Ana (lançadas depois do fechamento) agora entram
    const p = await painel();
    expect(p.fechamento).toBeNull();
    // 3 de 4 no prazo (30,0) + 4 de 4 relatórios (30,0) + notas 5, 5 e 1 = média 3,67 → 73,4% (22,0) = 82,0
    expect(await linha("Ana Dias")).toMatchObject({ escore: 82, faixa: "Prata", bonus: 200 });
    // A revisão destrava; a ressalva de 28/11, que não tinha entrado, agora é detectada
    expect((await decidir(ressalvaDaBia, "CONTA", "O dreno não foi desentupido")).status).toBe(200);
    expect((await chamar(R.penalidade, "DELETE", { id: reclamacaoDoEdu })).status).toBe(200);
    expect(resumo(await itens())).toEqual(["Bia Reis:RESSALVA:A_REVISAR", "Bia Reis:RESSALVA:CONTA"]);
    expect(await linha("Bia Reis")).toMatchObject({ escore: 95, desconto: 5 });
    // Premiação recalculada: sem empate, ganha o maior escore — do perfil (Bia) e geral (Carlos, o encarregado)
    expect((await previa()).premios.map((x: any) => `${x.titulo}|${x.criterio}|${x.ganhadores.map((g: any) => g.nome)}`)).toEqual(["Kit de ferramentas|ESCORE|Bia Reis", "Vale-jantar|ESCORE|Carlos Lider"]);
  });

  it("fechar de novo cria a VERSÃO seguinte (dois cliques ao mesmo tempo fecham uma vez só); o HISTÓRICO guarda todas, só leitura", async () => {
    vi.setSystemTime(new Date("2026-12-04T15:00:00Z"));
    const [a, b] = await Promise.all([fechar(MES, true), fechar(MES, true)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await versoes()).toEqual(["2026-11:1:REABERTO", "2026-11:2:FECHADO"]);
    const h = (await chamar(R.fechamentos, "GET", {}, undefined, `?mes=${MES}`)).json.historico;
    expect(h.map((f: any) => `${f.competencia}|v${f.versao}|${f.situacao}|${f.total}|${f.fechadoPor}|${f.reabertoPor ?? "-"}|${f.reaberturaMotivo ?? "-"}`)).toEqual([
      "2026-11|v2|FECHADO|1400|Gestora|-|-", "2026-11|v1|REABERTO|1550|Gestora|Ana Admin|Faltou revisar a ressalva da Bia",
    ]);
    expect(h[0].premios.map((x: any) => `${x.titulo}:${x.ganhadores.map((g: any) => g.nome)}`)).toEqual(["Kit de ferramentas:Bia Reis", "Vale-jantar:Carlos Lider"]);
    // A folha de cada versão é a DELA: a v1 continua com os valores de quando foi fechada
    const [v2, v1] = await Promise.all(h.map((f: any) => chamar(R.fechamento, "GET", { id: f.id })));
    expect(folhaTxt(v1.json.folha)).toEqual(["1|Ana Dias|Preventiva|100|Ouro|350", "1|Bia Reis|Preventiva|100|Ouro|350", "1|Edu Prado|Corretiva|94|Ouro|350", "1|Carlos Lider|Encarregado|100|Ouro|500"]);
    expect(folhaTxt(v2.json.folha)).toEqual(["1|Bia Reis|Preventiva|95|Ouro|350", "2|Ana Dias|Preventiva|82|Prata|200", "1|Edu Prado|Corretiva|94|Ouro|350", "1|Carlos Lider|Encarregado|100|Ouro|500"]);
    expect((await csv(h[1].id)).texto).toContain("11/2026;Ana Dias;Preventiva;1;100,0;Ouro;350,00;Kit de ferramentas / Vale-jantar"); // exporta a versão antiga também
    expect((await csv(h[0].id)).arquivo).toBe('attachment; filename="bonus-desempenho-2026-11-v2.csv"');
    // O painel do mês lê a versão que está valendo
    expect((await painel()).fechamento).toMatchObject({ versao: 2 });
    expect(await linha("Ana Dias")).toMatchObject({ escore: 82, bonus: 200 });
    // Histórico é só leitura: não há rota para alterar nem apagar um fechamento
    const rotas = await import("@/app/api/desempenho/fechamentos/[id]/route");
    expect(Object.keys(rotas).sort()).toEqual(["GET"]);
  });

  it("apagar o colaborador ou quem fechou NÃO apaga a folha: o nome e o valor ficam gravados", async () => {
    await prisma.tecnico.create({ data: { id: "tTemp", empresaId: "e1", nome: "Temporário", cpf: "9", telefone: "9" } });
    const f = await prisma.desempenhoFechamento.findFirstOrThrow({ where: { situacao: "FECHADO" } });
    await prisma.desempenhoFechamentoLinha.create({ data: { id: "linhaTemp", fechamentoId: f.id, empresaId: "e1", tecnicoId: "tTemp", nome: "Temporário", perfil: "Preventiva", valor: 123.45 } });
    await prisma.tecnico.delete({ where: { id: "tTemp" } });
    const l = await prisma.desempenhoFechamentoLinha.findUniqueOrThrow({ where: { id: "linhaTemp" } });
    expect({ tecnicoId: l.tecnicoId, nome: l.nome, valor: l.valor.toNumber() }).toEqual({ tecnicoId: null, nome: "Temporário", valor: 123.45 });
    await prisma.desempenhoFechamentoLinha.delete({ where: { id: "linhaTemp" } });
  });

  it("FECHAMENTO · RBAC: ver a folha, exportar, fechar e reabrir são de quem tem 'Gerenciar'; outra empresa não enxerga nem mexe", async () => {
    vi.setSystemTime(new Date("2026-12-04T15:00:00Z"));
    const { id } = await prisma.desempenhoFechamento.findFirstOrThrow({ where: { situacao: "FECHADO" } });
    const rotas: [string, string, Record<string, string>, unknown][] = [
      [R.fechamentos, "GET", {}, undefined], [R.fechamentos, "POST", {}, { competencia: "2026-12", ciente: true }], [R.fechamento, "GET", { id }, undefined],
      [R.exportar, "GET", { id }, undefined], [R.reabrir, "POST", { id }, { motivo: "Sem permissão para reabrir" }],
    ];
    for (const [rota, metodo, params, corpo] of rotas) {
      const nome = `${metodo} ${rota}`;
      sessao.atual = null;
      expect((await chamar(rota, metodo, params, corpo)).status, `${nome} sem login`).toBe(401);
      for (const acoes of [["visualizar"], ["visualizar", "revisar"]] as Acao[][]) { com(acoes); expect((await chamar(rota, metodo, params, corpo)).status, `${nome} com ${acoes}`).toBe(403); }
      entrar({ ...permissoesTotais(), desempenho: { visualizar: true, revisar: true } });
      expect((await chamar(rota, metodo, params, corpo)).status, `${nome} com tudo menos Gerenciar`).toBe(403);
      entrar(PRESETS.TECNICO, { id: "uT", role: "TECNICO", tecnicoId: "t2" });
      expect((await chamar(rota, metodo, params, corpo)).status, `${nome} como técnico`).toBe(403);
    }
    expect(await versoes()).toEqual(["2026-11:1:REABERTO", "2026-11:2:FECHADO"]); // nada mudou
    // Outra empresa (com Gerenciar na DELA): não vê o meu histórico, a minha folha nem reabre o meu mês
    gestao({ empresaId: "e2" });
    expect((await chamar(R.fechamentos, "GET")).json.historico).toEqual([]);
    expect((await chamar(R.fechamento, "GET", { id })).status).toBe(404);
    expect((await csv(id)).status).toBe(404);
    expect(await erro(chamar(R.reabrir, "POST", { id }, { motivo: "Tentando reabrir o mês alheio" }))).toBe("404 Fechamento não encontrado.");
    expect((await painel()).fechamento).toBeNull(); // o novembro DELA está aberto
    // A outra empresa fecha o novembro dela sem tocar no meu (versão 1 lá, versão 2 aqui)
    expect((await fechar(MES, true)).json).toMatchObject({ versao: 1, situacao: "FECHADO", fechadoPor: "Gestora" });
    expect(await prisma.desempenhoFechamento.count({ where: { empresaId: "e2" } })).toBe(1);
    gestao();
    expect(await versoes()).toEqual(["2026-11:1:REABERTO", "2026-11:2:FECHADO"]);
    expect((await chamar(R.fechamentos, "GET")).json.historico).toHaveLength(2);
  });

  it("empresa sem o módulo e mês sem ninguém: não há o que fechar", async () => {
    await prisma.empresa.create({ data: { id: "e3", nome: "Sem módulo", cnpj: "11.111.111/0001-11", email: "s@x.com" } });
    await prisma.usuario.create({ data: { id: "uC", empresaId: "e3", nome: "Carla", email: "uC@x.com", senha: "x", role: "ADMIN" } });
    gestao({ empresaId: "e3", id: "uC" });
    expect((await previa()).bloqueio).toBe("O Desempenho ainda não foi configurado nesta empresa.");
    expect(await erro(fechar(MES, true))).toBe("409 O Desempenho ainda não foi configurado nesta empresa.");
    await chamar(R.config, "GET"); // abre o módulo: perfis sem ninguém
    expect((await previa("2026-10")).bloqueio).toBe("Nenhum colaborador participa do Desempenho: não há o que fechar.");
    expect(await erro(fechar("2026-10", true))).toBe("409 Nenhum colaborador participa do Desempenho: não há o que fechar.");
    expect(await prisma.desempenhoFechamento.count({ where: { empresaId: "e3" } })).toBe(0);
  });

  it("O COLABORADOR NO APP: vê o DELE no mês fechado (bônus definitivo) e no aberto (projeção) — a média das avaliações, nunca o que o cliente escreveu", async () => {
    vi.setSystemTime(new Date("2026-12-04T15:00:00Z"));
    const comoBia = () => entrar(PRESETS.TECNICO, { id: "uT", role: "TECNICO", tecnicoId: "t2", email: "bia@x.com" });
    // Um retorno da Bia em dezembro (mês aberto), para conferir o que vai e o que não vai
    gestao();
    await servico({ tecnicos: ["t2"], equipamento: "q4", agendada: br("2026-12-01"), concluida: br("2026-12-01", "16:00"), nota: 3, comentario: "Técnica atrasou e foi grosseira" });
    await corretiva("q4", br("2026-12-03", "09:00"));
    await servico({ tecnicos: ["t2"], equipamento: "q1", agendada: br("2026-12-02"), concluida: br("2026-12-02", "16:00"), ressalva: "Deixou a tampa solta", confirmadoEm: br("2026-12-02", "18:00") });
    await itens();
    comoBia();
    const fechado = (await chamar(R.meu, "GET", {}, undefined, `?mes=${MES}`)).json;
    expect(fechado.ficha).toMatchObject({ tecnico: { id: "t2" }, linha: { escore: 95, posicao: 1, faixa: "Ouro", bonus: 350, desconto: 5 }, fechamento: { versao: 2 }, premiosGanhos: ["Kit de ferramentas"], participantes: 2 });
    // A ressalva que contou aparece (tipo, data, situação) — SEM o texto do cliente
    expect(fechado.ficha.penalidades.map((p: any) => `${p.tipo}|${p.situacao}|${p.descricao}`)).toEqual(["RESSALVA|CONTA|null", "RESSALVA|A_REVISAR|null"]);
    // O motivo da decisão (palavras da gestão, não do cliente) vai: ele precisa saber por que contou
    expect(fechado.ficha.penalidades[0].motivo).toBe("O dreno não foi desentupido");
    const aberto = (await chamar(R.meu, "GET", {}, undefined, "?mes=2026-12")).json;
    expect(aberto.ficha).toMatchObject({ fechamento: null, premiosGanhos: [], linha: { bonus: expect.any(Number) } });
    expect(aberto.ficha.penalidades.map((p: any) => `${p.tipo}|${p.descricao === null ? "sem texto" : "com texto"}`).sort()).toEqual(["RESSALVA|sem texto", "RETORNO|com texto"]);
    expect(aberto.ficha.linha.composicao.find((c: any) => c.metrica === "avaliacao").detalhe).toBe("média 3,0 em 1 avaliação"); // a MÉDIA
    for (const resposta of [fechado, aberto]) {
      const texto = JSON.stringify(resposta);
      for (const proibido of ["voltou a pingar", "tampa solta", "grosseira", "barulho", "Ana Dias", "Edu Prado", "Carlos Lider"]) expect(texto, proibido).not.toContain(proibido);
    }
    // A gestão continua vendo o texto (é ela quem revisa)
    gestao();
    expect((await chamar(R.ficha, "GET", { id: "t2" }, undefined, "?mes=2026-12")).json.penalidades.find((p: any) => p.tipo === "RESSALVA").descricao).toContain("Deixou a tampa solta");
    // A imagem do prêmio em disputa, pela rota do app: só para quem participa, só da empresa dele
    const kit = (await prisma.desempenhoPremiacao.findFirstOrThrow({ where: { titulo: "Kit de ferramentas" } })).id;
    comoBia();
    expect(await chamar(R.meuPremio, "GET", { id: kit })).toMatchObject({ status: 200, tipo: "image/jpeg" });
    expect((await chamar(R.meuPremio, "GET", { id: "nao-existe" })).status).toBe(404);
    entrar(PRESETS.TECNICO, { id: "uG", role: "TECNICO", tecnicoId: "t5" });   // não participa do Desempenho
    expect((await chamar(R.meuPremio, "GET", { id: kit })).status).toBe(404);
    entrar(PRESETS.TECNICO, { empresaId: "e2", id: "uB", role: "TECNICO", tecnicoId: "tE2" }); // participa, em outra empresa
    expect((await chamar(R.meuPremio, "GET", { id: kit })).status).toBe(404);
    sessao.atual = null;
    expect((await chamar(R.meuPremio, "GET", { id: kit })).status).toBe(401);
  });
});
