/**
 * Banco em memória para testes de rota (substitui `@/lib/prisma`). Cobre o que as rotas usam:
 * findFirst/findUnique/findMany/count/create/createMany/update/updateMany/upsert/delete/deleteMany e
 * $transaction. Filtros: igualdade, in/notIn/not/has/contains, AND/OR, chave composta
 * (`cpf_empresaId`) e filtro por relação (`formularioTemplate: { ativo: true }`), resolvido
 * pelas relações declaradas em `relacoes`. `select`/`include` não recortam colunas (devolve a
 * linha inteira com as relações hidratadas), mas o `where` de uma relação lista aninhada
 * (`campos: { where: { ativo: true } }`) é aplicado, em qualquer nível.
 */
export type Linha = Record<string, any>;
export interface Banco { t: Record<string, Linha[]>; escritas: string[]; seq: number }
export type Relacoes = Record<string, (linha: Linha, t: (m: string) => Linha[]) => Linha>;

const ehObjeto = (v: unknown): v is Linha => !!v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v);

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
      if ("some" in v) return (row[k] ?? []).some((x: Linha) => casa(x, v.some));
      if (ehObjeto(row[k])) return casa(row[k], v); // filtro por relação 1-1
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

export function criarPrisma(db: Banco, relacoes: Relacoes = {}) {
  const T = (m: string) => (db.t[m] ??= []);
  const hidratar = (m: string, r: Linha) => (relacoes[m] ? { ...r, ...relacoes[m](r, T) } : { ...r });
  const linhas = (m: string, where?: Linha) => T(m).filter((x) => casa(hidratar(m, x), where));
  const escrever = (m: string, op: string, r?: Linha) => db.escritas.push(`${m}.${op}:${r?.id ?? ""}`);
  const naoAchou = () => Object.assign(new Error("not found"), { code: "P2025" });
  const model = (m: string) => ({
    findFirst: async ({ where, select, include }: any = {}) => { const r = linhas(m, where)[0]; return r ? projetar(hidratar(m, r), select ?? include) : null; },
    findUnique: async ({ where, select, include }: any = {}) => { const r = linhas(m, where)[0]; return r ? projetar(hidratar(m, r), select ?? include) : null; },
    findUniqueOrThrow: async ({ where, select, include }: any = {}) => { const r = linhas(m, where)[0]; if (!r) throw naoAchou(); return projetar(hidratar(m, r), select ?? include); },
    findMany: async ({ where, take, select, include }: any = {}) => {
      const rs = linhas(m, where).map((r) => projetar(hidratar(m, r), select ?? include));
      return take ? rs.slice(0, take) : rs;
    },
    count: async ({ where }: any = {}) => linhas(m, where).length,
    create: async ({ data }: any) => {
      const { campos, ...resto } = data ?? {};
      const r: Linha = { id: `${m}-${++db.seq}`, ...resto };
      for (const [k, v] of Object.entries(r)) if (ehObjeto(v) && ("create" in v || "connect" in v)) delete r[k];
      T(m).push(r); escrever(m, "create", r); void campos; return hidratar(m, r);
    },
    createMany: async ({ data }: any) => { for (const d of data) T(m).push({ id: `${m}-${++db.seq}`, ...d }); escrever(m, "createMany"); return { count: data.length }; },
    update: async ({ where, data, include, select }: any) => {
      const r = T(m).find((x) => casa(x, where));
      if (!r) throw naoAchou();
      for (const [k, v] of Object.entries(data ?? {})) if (!ehObjeto(v)) r[k] = v; // relações aninhadas: ignoradas
      escrever(m, "update", r); return projetar(hidratar(m, r), include ?? select);
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
