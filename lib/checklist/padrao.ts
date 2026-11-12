/**
 * Checklists sugeridos por tipo de equipamento (manutenção preventiva AVAC). São RASCUNHO: a empresa
 * ajusta no cadastro do tipo ("Usar checklist sugerido" quando o tipo ainda não tem itens).
 *
 * Duas versões, fonte única dos SQLs (os testes conferem item a item):
 *  - `TIPOS_PADRAO_E1` / `ITENS_BASE_E1`: o que o SQL da etapa 1 (…_execucao_os_checklist.sql) semeou;
 *  - `TIPOS_PADRAO` / `ITENS_BASE` (atual): as medições viram itens de MEDIÇÃO (número + unidade,
 *    sem avaliar no app). O SQL da etapa 2 (…_app_tecnico.sql) troca a versão 1 pela atual só nos
 *    tipos cujo checklist ainda é exatamente o de fábrica.
 */

export interface ItemChecklistPadrao {
  texto: string;
  /** Pede foto do item (o técnico anexa; "Não se aplica" dispensa) */
  pedirFoto?: boolean;
  /** Pede observação; "Não se aplica" dispensa */
  pedirObservacao?: boolean;
  /** Medição: o técnico captura número + unidade (sem avaliar se está bom ou ruim) */
  tipoResposta?: "MEDICAO";
  /** Unidade da medição (psi, °C, A…) */
  unidade?: string;
}

/* ───────── Itens-base (comuns a quase todos) ───────── */
const B = {
  filtros: { texto: "Limpeza dos filtros de ar", pedirFoto: true },
  evaporadora: { texto: "Limpeza da serpentina evaporadora", pedirFoto: true },
  condensadora: { texto: "Limpeza da serpentina condensadora" },
  dreno: { texto: "Dreno e bandeja: limpeza e verificação de vazamento de água" },
  gas: { texto: "Carga de gás refrigerante e verificação de vazamentos" },
  pressao: { texto: "Medição de pressão de sucção e de descarga", pedirObservacao: true },
  corrente: { texto: "Medição de corrente do compressor e dos ventiladores", pedirObservacao: true },
  temperatura: { texto: "Medição de temperatura de insuflamento e retorno (delta T)", pedirObservacao: true },
  eletrica: { texto: "Conexões elétricas, contatora e disjuntor: aperto e estado" },
  motores: { texto: "Estado dos motores, hélices e turbinas" },
  isolamento: { texto: "Estado do isolamento térmico das tubulações" },
  ruido: { texto: "Ruídos e vibrações anormais" },
  teste: { texto: "Teste de funcionamento (liga/desliga, termostato e controle)" },
  fixacao: { texto: "Fixação e estrutura (suportes, base e parafusos)" },
} satisfies Record<string, ItemChecklistPadrao>;

/* ───────── Específicos ───────── */
const E = {
  bombaDreno: { texto: "Bomba de drenagem e mangueira de dreno" },
  aletas: { texto: "Aletas e defletores de ar (movimento e estado)" },
  vrfErros: { texto: "Erros e alarmes no controlador central" },
  vrfComunicacao: { texto: "Comunicação entre as unidades internas e externas" },
  vrfPressoes: { texto: "Pressões por circuito", pedirObservacao: true },
  aguaBomba: { texto: "Fluxo de água e bomba (vazão e fluxostato)" },
  pressostatos: { texto: "Pressostatos de alta e de baixa" },
  temperaturaAgua: { texto: "Temperatura de entrada e saída de água (delta T)", pedirObservacao: true },
  selfAgua: { texto: "Fluxo de água e bomba de condensação (quando a condensação é a água)" },
  serpentinaAgua: { texto: "Limpeza da serpentina de água gelada", pedirFoto: true },
  valvulaAgua: { texto: "Válvula de controle de água gelada (2 ou 3 vias)" },
  correnteVentilador: { texto: "Medição de corrente do motor do ventilador", pedirObservacao: true },
  correias: { texto: "Correias e polias (tensão e desgaste)" },
  camaraTemperatura: { texto: "Controle de temperatura da câmara (setpoint e temperatura medida)", pedirObservacao: true },
  degelo: { texto: "Degelo (resistências, ciclo e termostato de degelo)" },
  gaxetas: { texto: "Gaxetas e vedação da porta" },
} satisfies Record<string, ItemChecklistPadrao>;

/** Itens-base da etapa 1, na ordem. */
export const ITENS_BASE_E1: ItemChecklistPadrao[] = [
  B.filtros, B.evaporadora, B.condensadora, B.dreno, B.gas, B.pressao, B.corrente, B.temperatura,
  B.eletrica, B.motores, B.isolamento, B.ruido, B.teste, B.fixacao,
];

/* ───────── Medições (etapa 2): cada "Medição de …" vira itens de número + unidade ───────── */
const med = (texto: string, unidade: string): ItemChecklistPadrao => ({ texto, tipoResposta: "MEDICAO", unidade });
const MEDICOES = new Map<ItemChecklistPadrao, ItemChecklistPadrao[]>([
  [B.pressao, [med("Pressão de sucção", "psi"), med("Pressão de descarga", "psi")]],
  [B.corrente, [med("Corrente do compressor", "A"), med("Corrente dos ventiladores", "A")]],
  [B.temperatura, [med("Temperatura de insuflamento", "°C"), med("Temperatura de retorno", "°C")]],
  [E.temperaturaAgua, [med("Temperatura de entrada da água", "°C"), med("Temperatura de saída da água", "°C")]],
  [E.correnteVentilador, [med("Corrente do motor do ventilador", "A")]],
  [E.camaraTemperatura, [med("Temperatura medida na câmara", "°C"), med("Setpoint da câmara", "°C")]],
]);
const comMedicoes = (itens: ItemChecklistPadrao[]) => itens.flatMap((i) => MEDICOES.get(i) ?? [i]);

/** Itens-base, na ordem — a sugestão para um tipo sem checklist próprio. */
export const ITENS_BASE: ItemChecklistPadrao[] = comMedicoes(ITENS_BASE_E1);

export interface TipoPadrao {
  /** Chave do enum TipoEquipamento (âncora do tipo padrão: tipos_equipamento_custom.chave_enum) */
  chave: string;
  nome: string;
  /** Nome antigo do tipo padrão: o SQL troca pelo novo só se a empresa não renomeou */
  nomeAntigo?: string;
  itens: ItemChecklistPadrao[];
}

/** Os 8 tipos pré-cadastrados, com o checklist da etapa 1 (o que já foi semeado). */
export const TIPOS_PADRAO_E1: TipoPadrao[] = [
  { chave: "AR_CONDICIONADO_SPLIT", nome: "Split Hi-Wall (parede)", nomeAntigo: "Ar-cond. Split", itens: ITENS_BASE_E1 },
  {
    chave: "PISO_TETO", nome: "Piso-Teto",
    itens: [B.filtros, B.evaporadora, B.condensadora, B.dreno, E.bombaDreno, E.aletas, B.gas, B.pressao, B.corrente, B.temperatura, B.eletrica, B.motores, B.isolamento, B.ruido, B.teste, B.fixacao],
  },
  {
    chave: "CASSETE", nome: "Cassete",
    itens: [B.filtros, B.evaporadora, B.condensadora, B.dreno, E.bombaDreno, E.aletas, B.gas, B.pressao, B.corrente, B.temperatura, B.eletrica, B.motores, B.isolamento, B.ruido, B.teste, B.fixacao],
  },
  {
    chave: "VRF", nome: "VRF/VRV", nomeAntigo: "VRF",
    itens: [B.filtros, B.evaporadora, B.condensadora, B.dreno, B.gas, B.pressao, E.vrfPressoes, B.corrente, B.temperatura, B.eletrica, B.motores, B.isolamento, B.ruido, B.teste, E.vrfErros, E.vrfComunicacao, B.fixacao],
  },
  {
    chave: "CHILLER", nome: "Chiller",
    itens: [B.condensadora, E.aguaBomba, E.pressostatos, B.gas, B.pressao, B.corrente, E.temperaturaAgua, B.eletrica, B.motores, B.isolamento, B.ruido, B.teste, B.fixacao],
  },
  {
    chave: "SELF_CONTAINED", nome: "Self-Contained",
    itens: [B.filtros, B.evaporadora, B.condensadora, B.dreno, B.gas, B.pressao, E.pressostatos, B.corrente, B.temperatura, E.selfAgua, B.eletrica, B.motores, B.isolamento, B.ruido, B.teste, B.fixacao],
  },
  {
    chave: "FANCOIL", nome: "Fancoil", nomeAntigo: "Fan Coil",
    itens: [B.filtros, E.serpentinaAgua, B.dreno, E.valvulaAgua, E.temperaturaAgua, B.temperatura, E.correnteVentilador, E.correias, B.eletrica, B.motores, B.isolamento, B.ruido, B.teste, B.fixacao],
  },
  {
    chave: "CAMARA_FRIA", nome: "Câmara Fria/Refrigeração", nomeAntigo: "Câmara Fria",
    itens: [B.evaporadora, B.condensadora, B.dreno, B.gas, B.pressao, B.corrente, E.pressostatos, E.camaraTemperatura, E.degelo, E.gaxetas, B.eletrica, B.motores, B.isolamento, B.ruido, B.teste, B.fixacao],
  },
];

/** Os 8 tipos pré-cadastrados, com o checklist atual (medições como número + unidade). */
export const TIPOS_PADRAO: TipoPadrao[] = TIPOS_PADRAO_E1.map((t) => ({ ...t, itens: comMedicoes(t.itens) }));

/** Checklist sugerido para um tipo: o do tipo padrão (pela chave do enum) ou os itens-base. */
export function checklistSugerido(chaveEnum: string | null | undefined): ItemChecklistPadrao[] {
  return TIPOS_PADRAO.find((t) => t.chave === chaveEnum)?.itens ?? ITENS_BASE;
}
