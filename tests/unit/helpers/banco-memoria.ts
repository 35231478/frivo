/**
 * Banco em memória para testes de rota (substitui `@/lib/prisma`). Cobre o que as rotas usam:
 * findFirst/findUnique/findMany/count/create/createMany/update/updateMany/delete/deleteMany e
 * $transaction. Filtros: igualdade, in/notIn/not/has/contains, AND/OR, chave composta
 * (`cpf_empresaId`) e filtro por relação (`formularioTemplate: { ativo: true }`), resolvido
 * pelas relações declaradas em `relacoes`. `select`/`include` são ignorados: devolve a linha
 * inteira com as relações hidratadas.
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

export function criarPrisma(db: Banco, relacoes: Relacoes = {}) {
  const T = (m: string) => (db.t[m] ??= []);
  const hidratar = (m: string, r: Linha) => (relacoes[m] ? { ...r, ...relacoes[m](r, T) } : { ...r });
  const linhas = (m: string, where?: Linha) => T(m).filter((x) => casa(hidratar(m, x), where));
  const escrever = (m: string, op: string, r?: Linha) => db.escritas.push(`${m}.${op}:${r?.id ?? ""}`);
  const naoAchou = () => Object.assign(new Error("not found"), { code: "P2025" });
  const model = (m: string) => ({
    findFirst: async ({ where }: any = {}) => { const r = linhas(m, where)[0]; return r ? hidratar(m, r) : null; },
    findUnique: async ({ where }: any = {}) => { const r = linhas(m, where)[0]; return r ? hidratar(m, r) : null; },
    findUniqueOrThrow: async ({ where }: any = {}) => { const r = linhas(m, where)[0]; if (!r) throw naoAchou(); return hidratar(m, r); },
    findMany: async ({ where, take }: any = {}) => { const rs = linhas(m, where).map((r) => hidratar(m, r)); return take ? rs.slice(0, take) : rs; },
    count: async ({ where }: any = {}) => linhas(m, where).length,
    create: async ({ data }: any) => {
      const { campos, ...resto } = data ?? {};
      const r: Linha = { id: `${m}-${++db.seq}`, ...resto };
      for (const [k, v] of Object.entries(r)) if (ehObjeto(v) && ("create" in v || "connect" in v)) delete r[k];
      T(m).push(r); escrever(m, "create", r); void campos; return hidratar(m, r);
    },
    createMany: async ({ data }: any) => { for (const d of data) T(m).push({ id: `${m}-${++db.seq}`, ...d }); escrever(m, "createMany"); return { count: data.length }; },
    update: async ({ where, data }: any) => {
      const r = T(m).find((x) => casa(x, where));
      if (!r) throw naoAchou();
      for (const [k, v] of Object.entries(data ?? {})) if (!ehObjeto(v)) r[k] = v; // relações aninhadas: ignoradas
      escrever(m, "update", r); return hidratar(m, r);
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
