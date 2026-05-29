import type { ResponsavelPrazo, CanalNotificacao } from "@prisma/client";

export interface EtapaTemplateLike {
  nome: string;
  prazoHoras: number;
  responsavel: ResponsavelPrazo;
  canal: CanalNotificacao;
  mensagem?: string | null;
  ordem: number;
}

export interface EtapaCalculada {
  nome: string;
  prazoHoras: number;
  prazoLimite: Date;
  responsavel: ResponsavelPrazo;
  canal: CanalNotificacao;
  mensagem: string | null;
  ordem: number;
  status: "EM_ANDAMENTO" | "PENDENTE";
}

/**
 * Monta as etapas de um prazo de OS a partir das etapas de um template,
 * calculando o prazo-limite cumulativo de cada etapa a partir de uma base.
 * A primeira etapa começa EM_ANDAMENTO; as demais ficam PENDENTE.
 */
export function montarEtapas(etapas: EtapaTemplateLike[], base: Date): EtapaCalculada[] {
  const ordenadas = [...etapas].sort((a, b) => a.ordem - b.ordem);
  let acumuladoHoras = 0;
  return ordenadas.map((e, idx) => {
    acumuladoHoras += e.prazoHoras;
    const prazoLimite = new Date(base.getTime() + acumuladoHoras * 60 * 60 * 1000);
    return {
      nome: e.nome,
      prazoHoras: e.prazoHoras,
      prazoLimite,
      responsavel: e.responsavel,
      canal: e.canal,
      mensagem: e.mensagem ?? null,
      ordem: idx,
      status: idx === 0 ? "EM_ANDAMENTO" : "PENDENTE",
    };
  });
}

/** Converte um valor + unidade (horas/dias) em horas. */
export function paraHoras(valor: number, unidade: "horas" | "dias"): number {
  return unidade === "dias" ? valor * 24 : valor;
}
