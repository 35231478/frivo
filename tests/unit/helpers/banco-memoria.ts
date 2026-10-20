/**
 * Banco em memória para testes de rota (substitui `@/lib/prisma`). Cobre o que as rotas usam:
 * findFirst/findUnique/findMany/count/create/createMany/update/updateMany/upsert/delete/deleteMany e
 * $transaction. findMany respeita orderBy (ver `comparador`), skip e take. Filtros: igualdade, in/notIn/not/has/contains, lt/lte/gt/gte, AND/OR, chave composta
 * (`cpf_empresaId`) e filtro por relação (`formularioTemplate: { ativo: true }`), resolvido
 * pelas relações declaradas em `relacoes`. `select`/`include` não recortam colunas (devolve a
 * linha inteira com as relações hidratadas), mas o `where` de uma relação lista aninhada
 * (`campos: { where: { ativo: true } }`) é aplicado, em qualquer nível.
 * Escrita aninhada (`itens: { create: [...] }`, `etapas: { deleteMany: {}, create: [...] }`) só para as
 * relações declaradas em `aninhadas` ({ modelo: { campo: [modeloFilho, chaveEstrangeira] } }); as
 * demais são ignoradas, como sempre. `update` aceita { increment } / { decrement } em campo numérico.
 */
export type Linha = Record<string, any>;
export interface Banco { t: Record<string, Linha[]>; escritas: string[]; seq: number }
export type Relacoes = Record<string, (linha: Linha, t: (m: string) => Linha[]) => Linha>;
export type Aninhadas = Record<string, Record<string, [filho: string, fk: string]>>;

const ehObjeto = (v: unknown): v is Linha => !!v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && !ehNuloJson(v);
/** Prisma.DbNull / Prisma.JsonNull (coluna Json? = NULL): gravado aqui como null */
const ehNuloJson = (v: unknown) => !!v && typeof v === "object" && ["DbNull", "JsonNull"].includes((v as object).constructor?.name ?? "");

function casa(row: Linha, where: Linha = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "AND") return (v as Linha[]).every((w) => casa(row, w));
    if (k === "OR") return (v as Linha[]).some((w) => casa(row, w));
    if (k === "NOT") return !casa(row, v);
    if (ehObjeto(v)) {
      if (!(k in row)) return casa(row, v); // chave composta (ex.: cpf_empresaId)
      if ("in" in v) return v.in.includes(row[k]);
      if ("notIn" in v) return !v.notIn.includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      if ("has" in v) return (row[k] ?? []).includes(v.has);
      if ("contains" in v) return String(row[k] ?? "").toLowerCase().includes(String(v.contains).toLowerCase());
      if ("equals" in v) return v.mode === "insensitive" ? String(row[k] ?? "").toLowerCase() === String(v.equals).toLowerCase() : row[k] === v.equals;
      if ("some" in v) return (row[k] ?? []).some((x: Linha) => casa(x, v.some));
      if (["lt", "lte", "gt", "gte"].some((op) => op in v)) {
        if (row[k] == null) return false; // NULL não compara (como no SQL)
        const n = Number(row[k]);
        return (!("lt" in v) || n < Number(v.lt)) && (!("lte" in v) || n <= Number(v.lte))
          && (!("gt" in v) || n > Number(v.gt)) && (!("gte" in v) || n >= Number(v.gte));
      }
      if (ehObjeto(row[k])) return casa(row[k], v); // filtro por relação 1-1
      if (row[k] === null && !("is" in v) && !("isNot" in v)) return false; // relação vazia não casa (como o Prisma)
      return true;
    }
    return row[k] === v;
  });
}

/** Aplica o `where` das relações listadas em select/include (recursivo). */
function projetar(row: Linha, sel?: Linha): Linha {
  if (!sel || !ehObjeto(row)) return row;
  const out: Linha = { ...row };
  for (const [k, v] of Object.entries(sel)) {
    if (!ehObjeto(v) || !(k in out)) continue;
    const filho = v.select ?? v.include;
    if (Array.isArray(out[k])) {
      out[k] = (out[k] as Linha[]).filter((x) => casa(x, v.where)).map((x) => projetar(x, filho));
    } else if (ehObjeto(out[k])) {
      out[k] = projetar(out[k], filho);
    }
  }
  return out;
}

/**
 * orderBy do Prisma em memória: campo escalar (asc/desc ou { sort, nulls }), campo de relação 1-1
 * ({ cliente: { nome: "asc" } }) e contagem ({ itens: { _count: "desc" } }, pela relação hidratada).
 * Nulos como no PostgreSQL: por último no asc, primeiro no desc (salvo `nulls`). Texto: pt-BR.
 */
function comparador(ordens: Linha[]) {
  const valor = (r: Linha, o: Linha): [unknown, string, string | undefined] => {
    const [k, v] = Object.entries(o)[0];
    if (typeof v === "string") return [r[k], v, undefined];
    if (ehObjeto(v) && "sort" in v) return [r[k], v.sort, v.nulls];
    if (ehObjeto(v) && "_count" in v) return [Array.isArray(r[k]) ? r[k].length : (r._count?.[k] ?? 0), v._count, undefined];
    if (ehObjeto(v)) return valor(r[k] ?? {}, v);
    return [undefined, "asc", undefined];
  };
  return (a: Linha, b: Linha) => {
    for (const o of ordens) {
      const [va, dir, nulls] = valor(a, o);
      const [vb] = valor(b, o);
      const sinal = dir === "desc" ? -1 : 1;
      const na = va == null, nb = vb == null;
      if (na || nb) {
        if (na && nb) continue;
        const nulosPrimeiro = nulls ? nulls === "first" : dir === "desc";
        return (na ? -1 : 1) * (nulosPrimeiro ? 1 : -1);
      }
      const c = typeof va === "string" && typeof vb === "string" ? va.localeCompare(vb, "pt-BR")
        : va instanceof Date && vb instanceof Date ? va.getTime() - vb.getTime()
        : Number(va) - Number(vb);
      if (c) return c * sinal;
    }
    return 0;
  };
}

export function criarPrisma(db: Banco, relacoes: Relacoes = {}, aninhadas: Aninhadas = {}) {
  const T = (m: string) => (db.t[m] ??= []);
  const hidratar = (m: string, r: Linha) => (relacoes[m] ? { ...r, ...relacoes[m](r, T) } : { ...r });
  const linhas = (m: string, where?: Linha) => T(m).filter((x) => casa(hidratar(m, x), where));
  const escrever = (m: string, op: string, r?: Linha) => db.escritas.push(`${m}.${op}:${r?.id ?? ""}`);
  const naoAchou = () => Object.assign(new Error("not found"), { code: "P2025" });
  /** Grava os filhos de uma relação aninhada declarada (deleteMany antes de create, como o Prisma). */
  const gravarFilhos = (m: string, pai: Linha, data: Linha) => {
    for (const [campo, [filho, fk]] of Object.entries(aninhadas[m] ?? {})) {
      const op = data[campo];
      if (!ehObjeto(op)) continue;
      if ("deleteMany" in op) { db.t[filho] = T(filho).filter((x) => x[fk] !== pai.id); escrever(filho, "deleteMany"); }
      for (const d of [op.create ?? []].flat()) { const r = { id: `${filho}-${++db.seq}`, ...d, [fk]: pai.id }; T(filho).push(r); escrever(filho, "create", r); }
    }
  };
  const model = (m: string) => ({
    findFirst: async ({ where, select, include }: any = {}) => { const r = linhas(m, where)[0]; return r ? projetar(hidratar(m, r), select ?? include) : null; },
    findUnique: async ({ where, select, include }: any = {}) => { const r = linhas(m, where)[0]; return r ? projetar(hidratar(m, r), select ?? include) : null; },
    findFirstOrThrow: async ({ where, select, include }: any = {}) => { const r = linhas(m, where)[0]; if (!r) throw naoAchou(); return projetar(hidratar(m, r), select ?? include); },
    findUniqueOrThrow: async ({ where, select, include }: any = {}) => { const r = linhas(m, where)[0]; if (!r) throw naoAchou(); return projetar(hidratar(m, r), select ?? include); },
    findMany: async ({ where, take, skip, orderBy, select, include }: any = {}) => {
      const hs = linhas(m, where).map((r) => hidratar(m, r));
      if (orderBy) hs.sort(comparador([orderBy].flat()));
      const rs = hs.slice(skip ?? 0).map((r) => projetar(r, select ?? include));
      return take ? rs.slice(0, take) : rs;
    },
    count: async ({ where }: any = {}) => linhas(m, where).length,
    aggregate: async ({ where, _sum }: any = {}) => ({
      _sum: Object.fromEntries(Object.keys(_sum ?? {}).map((k) => [k, linhas(m, where).reduce((t, r) => t + Number(r[k] ?? 0), 0)])),
    }),
    create: async ({ data }: any) => {
      const { campos, ...resto } = data ?? {};
      const r: Linha = { id: `${m}-${++db.seq}`, ...resto };
      for (const [k, v] of Object.entries(r)) if (ehObjeto(v) && ("create" in v || "connect" in v)) delete r[k];
      T(m).push(r); escrever(m, "create", r); gravarFilhos(m, r, resto); void campos; return hidratar(m, r);
    },
    createMany: async ({ data }: any) => { for (const d of data) T(m).push({ id: `${m}-${++db.seq}`, ...d }); escrever(m, "createMany"); return { count: data.length }; },
    update: async ({ where, data, include, select }: any) => {
      const r = T(m).find((x) => casa(x, where));
      if (!r) throw naoAchou();
      for (const [k, v] of Object.entries(data ?? {})) {
        if (ehObjeto(v) && "increment" in v) r[k] = Number(r[k] ?? 0) + Number(v.increment);
        else if (ehObjeto(v) && "decrement" in v) r[k] = Number(r[k] ?? 0) - Number(v.decrement);
        else if (ehNuloJson(v)) r[k] = null;
        else if (v !== undefined && !ehObjeto(v)) r[k] = v; // undefined = não mexe (como o Prisma); relações aninhadas: só as declaradas
      }
      escrever(m, "update", r); gravarFilhos(m, r, data ?? {}); return projetar(hidratar(m, r), include ?? select);
    },
    upsert: async ({ where, create, update }: any) => {
      const r = T(m).find((x) => casa(x, where));
      if (r) { Object.assign(r, update); escrever(m, "update", r); return hidratar(m, r); }
      const novo = { id: `${m}-${++db.seq}`, ...create }; T(m).push(novo); escrever(m, "create", novo); return hidratar(m, novo);
    },
    updateMany: async ({ where, data }: any) => { const rs = T(m).filter((x) => casa(x, where)); rs.forEach((r) => Object.assign(r, data)); return { count: rs.length }; },
    delete: async ({ where }: any) => { const i = T(m).findIndex((x) => casa(x, where)); if (i < 0) throw naoAchou(); escrever(m, "delete"); return T(m).splice(i, 1)[0]; },
    deleteMany: async ({ where }: any = {}) => { const antes = T(m).length; db.t[m] = T(m).filter((x) => !casa(x, where)); escrever(m, "deleteMany"); return { count: antes - db.t[m].length }; },
  });
  const cache: Record<string, any> = {};
  const prisma: any = new Proxy({}, {
    get: (_t, m: string) => {
      if (m === "$transaction") return async (arg: any) => (typeof arg === "function" ? arg(prisma) : Promise.all(arg));
      if (m === "$queryRaw") return async () => [{ max: 0 }];
      if (typeof m !== "string" || m === "then") return undefined;
      return (cache[m] ??= model(m));
    },
  });
  return prisma;
}
