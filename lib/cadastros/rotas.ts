import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode, type Permissoes } from "@/lib/permissoes";
import { definirAtivoCadastro, statusHttp } from "@/lib/acoes-massa/regras";
import {
  CADASTROS, ehEntidadeCadastro, lerFiltroAtivo, type AcaoCadastro, type DefCadastro, type EntidadeCadastro, type FiltroAtivo,
} from "@/lib/cadastros/registro";
import { criarCadastro, editarCadastro, impactoCadastro, listarCadastro, obterCadastro } from "@/lib/cadastros/servidor";

/**
 * Handlers HTTP dos cadastros padronizados. Os mesmos atendem:
 *  - a rota genérica /api/cadastros/[entidade] (+ /[id], /[id]/impacto);
 *  - as rotas antigas (/api/produtos, /api/servicos, /api/cargos, /api/categorias-financeiras), que só
 *    fixam a entidade — uma regra só, sem duplicar validação.
 *
 *   GET    coleção   ?ativo=sim|nao|todos &q=busca        (listar)
 *   POST   coleção   { campos }                             (criar — campo desconhecido = 400)
 *   GET    item                                             (obter)
 *   PATCH  item      { campos } e/ou { ativo }              (editar parcial / inativar / reativar)
 *   PUT    item      = PATCH (compatibilidade)
 *   DELETE item      { motivo? }                            (inativar — nunca apaga)
 *   GET    item/impacto                                     (quantos registros usam)
 * empresaId vem SEMPRE da sessão; permissão conferida por ação.
 */

type Ctx = { params: Promise<Record<string, string>> };
type Sessao = { user: { id: string; name?: string | null; email?: string | null; empresaId: string; role?: string; permissoes: unknown } };

const json = (corpo: unknown, status = 200) => NextResponse.json(corpo, { status });

/** Sessão + permissão da ação (requisito null = basta estar logado). */
export async function exigirCadastro(def: DefCadastro, acao: AcaoCadastro): Promise<{ sessao: Sessao } | { resposta: NextResponse }> {
  const session = (await auth()) as Sessao | null;
  if (!session?.user) return { resposta: json({ erro: "Não autorizado" }, 401) };
  const req = def.permissoes[acao];
  const u = session.user;
  if (req && !req.some(([m, a]) => pode(u.permissoes as Permissoes, m, a, u.role)))
    return { resposta: json({ erro: "Sem permissão para esta ação" }, 403) };
  return { sessao: session };
}

async function resolver(ctx: Ctx, fixa?: EntidadeCadastro) {
  const p = await ctx.params;
  const entidade = fixa ?? p.entidade;
  return { def: entidade && ehEntidadeCadastro(entidade) ? CADASTROS[entidade] : null, id: p.id };
}
const naoExiste = () => json({ erro: "Cadastro inexistente" }, 404);

async function lerCorpo(req: NextRequest): Promise<Record<string, unknown> | null> {
  const c = await req.json().catch(() => null);
  return c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : null;
}

/** Coleção: listar e criar. `ativoPadrao`: as rotas antigas devolvem todos (como sempre fizeram). */
export function rotasColecao(fixa?: EntidadeCadastro, opts: { ativoPadrao?: FiltroAtivo } = {}) {
  return {
    async GET(req: NextRequest, ctx: Ctx) {
      const { def } = await resolver(ctx, fixa);
      if (!def) return naoExiste();
      const g = await exigirCadastro(def, "listar");
      if ("resposta" in g) return g.resposta;
      const sp = req.nextUrl.searchParams;
      const itens = await listarCadastro(def, g.sessao.user.empresaId, { ativo: lerFiltroAtivo(sp.get("ativo"), opts.ativoPadrao ?? "sim"), q: sp.get("q") });
      return json(itens);
    },
    async POST(req: NextRequest, ctx: Ctx) {
      const { def } = await resolver(ctx, fixa);
      if (!def) return naoExiste();
      const g = await exigirCadastro(def, "criar");
      if ("resposta" in g) return g.resposta;
      const corpo = await lerCorpo(req);
      if (!corpo) return json({ erro: "Dados inválidos." }, 400);
      const r = await criarCadastro(def, g.sessao.user.empresaId, corpo);
      return r.ok ? json(r.item, 201) : json({ erro: r.erro }, r.status);
    },
  };
}

/** Item: obter, editar parcial (PATCH/PUT), inativar (DELETE). */
export function rotasItem(fixa?: EntidadeCadastro) {
  async function editar(req: NextRequest, ctx: Ctx) {
    const { def, id } = await resolver(ctx, fixa);
    if (!def || !id) return naoExiste();
    const corpo = await lerCorpo(req);
    if (!corpo) return json({ erro: "Dados inválidos." }, 400);
    const { ativo, ...campos } = corpo;
    if (ativo !== undefined && typeof ativo !== "boolean") return json({ erro: "ativo deve ser true ou false." }, 400);
    const temCampos = Object.keys(campos).length > 0;

    // Todas as permissões ANTES de gravar (ou de responder qualquer coisa): editar campos; inativar/reativar
    let sessao: Sessao | null = null;
    const acoes = [(temCampos || ativo === undefined) && "editar", typeof ativo === "boolean" && (ativo ? "reativar" : "inativar")];
    for (const acao of acoes.filter(Boolean) as AcaoCadastro[]) {
      const g = await exigirCadastro(def, acao);
      if ("resposta" in g) return g.resposta;
      sessao = g.sessao;
    }
    const u = sessao!.user;
    if (!temCampos && ativo === undefined) return json({ erro: "Nada para alterar." }, 400);

    if (temCampos) {
      const r = await editarCadastro(def, u.empresaId, id, campos);
      if (!r.ok) return json({ erro: r.erro }, r.status);
    }
    // Ativo: a MESMA regra das ações em massa
    if (typeof ativo === "boolean") {
      const r = await definirAtivoCadastro(def.entidade, id, ativo, { empresaId: u.empresaId, usuarioId: u.id, usuarioNome: u.name ?? "usuário", origem: "individual" });
      if (!r.ok) return json({ erro: r.motivo }, statusHttp(r));
    }
    return json(await obterCadastro(def, u.empresaId, id));
  }

  return {
    async GET(_req: NextRequest, ctx: Ctx) {
      const { def, id } = await resolver(ctx, fixa);
      if (!def || !id) return naoExiste();
      const g = await exigirCadastro(def, "listar");
      if ("resposta" in g) return g.resposta;
      const item = await obterCadastro(def, g.sessao.user.empresaId, id);
      return item ? json(item) : json({ erro: "Não encontrado" }, 404);
    },
    PATCH: editar,
    PUT: editar,
    async DELETE(_req: NextRequest, ctx: Ctx) {
      const { def, id } = await resolver(ctx, fixa);
      if (!def || !id) return naoExiste();
      const g = await exigirCadastro(def, "inativar");
      if ("resposta" in g) return g.resposta;
      const u = g.sessao.user;
      const r = await definirAtivoCadastro(def.entidade, id, false, { empresaId: u.empresaId, usuarioId: u.id, usuarioNome: u.name ?? "usuário", origem: "individual" });
      return r.ok ? json({ ok: true, detalhe: r.detalhe }) : json({ erro: r.motivo }, statusHttp(r));
    },
  };
}

/** Impacto (antes de inativar): exige a mesma permissão de inativar. */
export function rotaImpacto(fixa?: EntidadeCadastro) {
  return {
    async GET(_req: NextRequest, ctx: Ctx) {
      const { def, id } = await resolver(ctx, fixa);
      if (!def || !id) return naoExiste();
      const g = await exigirCadastro(def, "inativar");
      if ("resposta" in g) return g.resposta;
      const impacto = await impactoCadastro(def.entidade, id, g.sessao.user.empresaId);
      return impacto ? json(impacto) : json({ erro: "Não encontrado" }, 404);
    },
  };
}
