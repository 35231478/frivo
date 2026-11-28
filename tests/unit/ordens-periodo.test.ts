/**
 * Lista de OS × período do seletor (lib/listas/filtros.ts, puro): por padrão o mês atual; o atalho vale sobre a data
 * AGENDADA / DE EXECUÇÃO das atividades (agendada, iniciada, concluída) e a previsão da OS (dia civil e com hora) —
 * Leva I: a abertura e o prazo não contam mais; os links antigos
 * (`?data=` da navegação por dia e `dataInicio`/`dataFim`) continuam funcionando.
 */
import { describe, expect, it } from "vitest";
import { periodoOrdens, whereOrdens } from "@/lib/listas/filtros";

const AGORA = new Date("2026-11-04T01:30:00.000Z"); // terça 03/11/2026 22:30 em Brasília
const iso = (d?: Date) => d?.toISOString();
const faixaDe = (where: any) => {
  const ou = where.AND?.[0]?.OR;
  // ordem (Leva I): atividade (agendada | iniciada | concluída), data prevista (dia), data prevista (com hora)
  if (!ou) return null;
  const [agendada, iniciada, concluida] = ou[0].atividades.some.OR;
  return { agenda: agendada.dataAgendada, iniciada: iniciada.iniciadaEm, concluida: concluida.concluidaEm, previsaoDia: ou[1].previsaoConclusao, previsaoHora: ou[2].previsaoConclusao, qtd: ou.length };
};

describe("período da lista de OS", () => {
  it("sem nada na URL: o MÊS ATUAL (o padrão pedido pelo Zé); 'todos' explícito: nenhuma condição de data", () => {
    const p = periodoOrdens({}, AGORA);
    expect([p.tipo, p.mes]).toEqual(["mes", "2026-11"]);
    expect(faixaDe(whereOrdens("e1", {}, AGORA))!.agenda).toEqual({ gte: new Date("2026-11-01T03:00:00.000Z"), lt: new Date("2026-12-01T03:00:00.000Z") });
    expect(periodoOrdens({ periodo: "todos" }, AGORA).tipo).toBe("todos");
    expect(whereOrdens("e1", { periodo: "todos" }, AGORA).AND).toBeUndefined();
  });
  it("hoje: dia de Brasília nos instantes (agendada, iniciada, concluída, previsão com hora) e dia civil na previsão; sem abertura nem prazo", () => {
    const f = faixaDe(whereOrdens("e1", { periodo: "hoje" }, AGORA))!;
    expect([iso(f.agenda.gte), iso(f.agenda.lt)]).toEqual(["2026-11-03T03:00:00.000Z", "2026-11-04T03:00:00.000Z"]);
    expect([f.iniciada, f.concluida, f.previsaoHora]).toEqual([f.agenda, f.agenda, f.agenda]);
    expect([iso(f.previsaoDia.gte), iso(f.previsaoDia.lt)]).toEqual(["2026-11-03T00:00:00.000Z", "2026-11-04T00:00:00.000Z"]);
    expect(f.qtd).toBe(3);
    const w = JSON.stringify(whereOrdens("e1", { periodo: "hoje" }, AGORA));
    expect(w).not.toContain("criadoEm");
    expect(w).not.toContain("prazoExecucao");
  });
  it("esta semana e este mês: a faixa inteira; a empresa sempre da sessão", () => {
    const w = whereOrdens("e1", { periodo: "semana" }, AGORA);
    expect(w.empresaId).toBe("e1");
    const f = faixaDe(w)!;
    expect([iso(f.agenda.gte), iso(f.agenda.lt)]).toEqual(["2026-11-02T03:00:00.000Z", "2026-11-09T03:00:00.000Z"]);
    expect(faixaDe(whereOrdens("e1", { mes: "2026-10" }, AGORA))!.agenda).toEqual({ gte: new Date("2026-10-01T03:00:00.000Z"), lt: new Date("2026-11-01T03:00:00.000Z") });
  });
  it("links antigos: ?data= vira 'Hoje' navegado naquele dia; dataInicio/dataFim viram o período personalizado", () => {
    const p = periodoOrdens({ data: "2026-10-20" }, AGORA);
    expect([p.tipo, p.ref, p.dias?.de, p.dias?.ate]).toEqual(["hoje", "2026-10-20", "2026-10-20", "2026-10-20"]);
    const q = periodoOrdens({ dataInicio: "2026-10-01", dataFim: "2026-10-15" }, AGORA);
    expect([q.tipo, q.de, q.ate]).toEqual(["intervalo", "2026-10-01", "2026-10-15"]);
    // Com o período novo na URL, o `data` antigo é ignorado
    expect(periodoOrdens({ data: "2026-10-20", periodo: "semana" }, AGORA).tipo).toBe("semana");
  });
  it("o período convive com os outros filtros (status, busca) sem derrubá-los", () => {
    const w = whereOrdens("e1", { periodo: "hoje", status: "ABERTA,AGENDADA", busca: "split" }, AGORA);
    expect(w.status).toEqual({ in: ["ABERTA", "AGENDADA"] });
    expect(w.OR).toHaveLength(5); // a busca (leva 4 de cadastros: + o nome fantasia do cliente)
    expect(w.AND).toHaveLength(1); // o período
  });
});
