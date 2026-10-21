/**
 * Checklists sugeridos por tipo de equipamento (manutenção preventiva AVAC). São RASCUNHO: o SQL
 * da etapa 1 semeia estes itens nos 8 tipos pré-cadastrados de cada empresa e o cadastro do tipo
 * oferece "Usar checklist sugerido" quando o tipo ainda não tem itens. A empresa ajusta depois.
 *
 * Fonte única: o teste do SQL confere que o arquivo prisma/sql/…_execucao_os_checklist.sql semeia
 * exatamente estes itens, nesta ordem.
 */

export interface ItemChecklistPadrao {
  texto: string;
  /** Pede foto do item (o técnico anexa; "Não se aplica" dispensa) */
  pedirFoto?: boolean;
  /** Pede observação (ex.: o valor medido); "Não se aplica" dispensa */
  pedirObservacao?: boolean;
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

/** Itens-base, na ordem — a sugestão para um tipo sem checklist próprio. */
export const ITENS_BASE: ItemChecklistPadrao[] = [
  B.filtros, B.evaporadora, B.condensadora, B.dreno, B.gas, B.pressao, B.corrente, B.temperatura,
  B.eletrica, B.motores, B.isolamento, B.ruido, B.teste, B.fixacao,
];

export interface TipoPadrao {
  /** Chave do enum TipoEquipamento (âncora do tipo padrão: tipos_equipamento_custom.chave_enum) */
  chave: string;
  nome: string;
  /** Nome antigo do tipo padrão: o SQL troca pelo novo só se a empresa não renomeou */
  nomeAntigo?: string;
  itens: ItemChecklistPadrao[];
}

/** Os 8 tipos pré-cadastrados, com o checklist inicial de cada um. */
export const TIPOS_PADRAO: TipoPadrao[] = [
  { chave: "AR_CONDICIONADO_SPLIT", nome: "Split Hi-Wall (parede)", nomeAntigo: "Ar-cond. Split", itens: ITENS_BASE },
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

/** Checklist sugerido para um tipo: o do tipo padrão (pela chave do enum) ou os itens-base. */
export function checklistSugerido(chaveEnum: string | null | undefined): ItemChecklistPadrao[] {
  return TIPOS_PADRAO.find((t) => t.chave === chaveEnum)?.itens ?? ITENS_BASE;
}
