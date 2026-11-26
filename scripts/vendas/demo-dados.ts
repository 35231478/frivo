/**
 * Os dados da EMPRESA DE DEMONSTRAÇÃO dos prints da home de vendas. Tudo inventado: empresa, clientes,
 * pessoas, endereços, documentos e valores. Os documentos (CNPJ/CPF) têm o formato certo e o dígito
 * verificador ERRADO de propósito — nunca coincidem com um documento real. E-mails no domínio
 * ".exemplo" (que não existe) e telefones com prefixo 90000 (não atribuído).
 */

/** Formata 12 dígitos de raiz + DV propositalmente inválido (o certo + 1). */
export function cnpjFicticio(raiz: string): string {
  const d = raiz.replace(/\D/g, "").padEnd(12, "0").slice(0, 12).split("").map(Number);
  const dv = (nums: number[], pesos: number[]) => { const r = nums.reduce((s, n, i) => s + n * pesos[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv([...d, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const s = [...d, d1, (d2 + 1) % 10].join("");
  return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
}

/** CPF com DV propositalmente inválido. */
export function cpfFicticio(base9: string): string {
  const d = base9.replace(/\D/g, "").padEnd(9, "0").slice(0, 9).split("").map(Number);
  const dv = (nums: number[]) => { const r = (nums.reduce((s, n, i) => s + n * (nums.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(d);
  const d2 = dv([...d, d1]);
  const s = [...d, d1, (d2 + 1) % 10].join("");
  return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
}

export const telefone = (n: number) => `(62) 90000-${String(1000 + n).slice(-4)}`;

export const EMPRESA = {
  nome: "Polar Climatização e Engenharia Ltda",
  nomeFantasia: "Polar Climatização",
  cnpj: cnpjFicticio("903417220001"),
  email: "contato@polarclima.exemplo",
  cidade: "Goiânia", estado: "GO", bairro: "Setor Bueno",
  endereco: "Av. das Acácias", numero: "1200",
  latitude: -16.7068, longitude: -49.2685,
} as const;

/** Quem entra para tirar os prints (a gestora) e o técnico do app. Senha só do banco local. */
export const LOGIN_GESTORA = { nome: "Marina Duarte", email: "marina@polarclima.exemplo" };
export const SENHA_DEMO = "demo-prints-polar";

export interface PessoaDemo { nome: string; cargo: string; tipo?: "TECNICO_CAMPO" | "RESPONSAVEL_TECNICO" | "ADMINISTRATIVO"; especialidades: string[]; crea?: string }

export const PESSOAS: PessoaDemo[] = [
  { nome: "Rafael Moura", cargo: "Técnico em refrigeração", especialidades: ["Split", "VRF", "PMOC"] },
  { nome: "Thiago Barros", cargo: "Técnico em refrigeração", especialidades: ["Split", "Cassete", "Câmara fria"] },
  { nome: "Lucas Pereira", cargo: "Técnico em refrigeração", especialidades: ["Chiller", "VRF"] },
  { nome: "Diego Santana", cargo: "Auxiliar técnico", especialidades: ["Instalação", "Limpeza química"] },
  { nome: "Felipe Araújo", cargo: "Técnico em refrigeração", especialidades: ["Split", "Piso-teto"] },
  { nome: "Igor Nogueira", cargo: "Auxiliar técnico", especialidades: ["Instalação"] },
  { nome: "Eng. Paula Rezende", cargo: "Engenheira mecânica", tipo: "RESPONSAVEL_TECNICO", especialidades: ["PMOC", "Projetos"], crea: "GO-0000123/D" },
];

/** Equipes de campo: nome, cor e quem está nela (índices em PESSOAS; o primeiro é o líder). */
export const EQUIPES = [
  { nome: "Equipe Preventiva", cor: "#0E7490", membros: [0, 3] },
  { nome: "Equipe Corretiva", cor: "#15803D", membros: [1, 5] },
  { nome: "Equipe Grandes Sistemas", cor: "#6D28D9", membros: [2, 4] },
];

export type ChaveTipo = "AR_CONDICIONADO_SPLIT" | "CASSETE" | "PISO_TETO" | "VRF" | "CHILLER" | "CAMARA_FRIA";

export interface EquipDemo { tipo: ChaveTipo; nome: string; setor: string; capacidade: string; marca: string; modelo: string }

export interface ClienteDemo {
  nome: string; fantasia: string; raizCnpj: string; segmento: "RESIDENCIAL" | "SAUDE" | "EDUCACAO" | "ALIMENTACAO" | "CORPORATIVO" | "HOTELARIA" | "COMERCIO";
  bairro: string; logradouro: string; numero: string; lat: number; lng: number; contato: string;
  equipamentos: EquipDemo[];
}

const split = (nome: string, setor: string, btus = "12.000 BTU/h"): EquipDemo => ({ tipo: "AR_CONDICIONADO_SPLIT", nome, setor, capacidade: btus, marca: "Frigotec", modelo: "FT-Inverter" });
const cassete = (nome: string, setor: string, btus = "36.000 BTU/h"): EquipDemo => ({ tipo: "CASSETE", nome, setor, capacidade: btus, marca: "AeroClima", modelo: "K4 Cassete" });
const pisoTeto = (nome: string, setor: string, btus = "58.000 BTU/h"): EquipDemo => ({ tipo: "PISO_TETO", nome, setor, capacidade: btus, marca: "AeroClima", modelo: "PT Max" });

export const CLIENTES: ClienteDemo[] = [
  {
    nome: "Clínica Vitta Diagnósticos Ltda", fantasia: "Clínica Vitta", raizCnpj: "887120440001", segmento: "SAUDE",
    bairro: "Setor Oeste", logradouro: "Rua das Orquídeas", numero: "455", lat: -16.6852, lng: -49.2712, contato: "Dra. Helena Prado",
    equipamentos: [
      cassete("Cassete recepção", "Recepção"), cassete("Cassete sala de espera", "Recepção"),
      split("Split consultório 1", "Consultórios"), split("Split consultório 2", "Consultórios"), split("Split consultório 3", "Consultórios"),
      pisoTeto("Piso-teto sala de exames", "Diagnóstico por imagem", "60.000 BTU/h"), split("Split laboratório", "Laboratório", "18.000 BTU/h"),
      split("Split sala de laudos", "Diagnóstico por imagem", "18.000 BTU/h"),
    ],
  },
  {
    nome: "Condomínio Residencial Bosque dos Ipês", fantasia: "Cond. Bosque dos Ipês", raizCnpj: "776540120001", segmento: "RESIDENCIAL",
    bairro: "Setor Bueno", logradouro: "Rua dos Jasmins", numero: "88", lat: -16.7101, lng: -49.2633, contato: "Sr. Otávio Lemos (síndico)",
    equipamentos: [
      pisoTeto("Piso-teto salão de festas", "Área comum"), split("Split academia", "Área comum", "24.000 BTU/h"),
      split("Split portaria", "Portaria", "9.000 BTU/h"), split("Split brinquedoteca", "Área comum"),
    ],
  },
  {
    nome: "Colégio Novo Horizonte", fantasia: "Colégio Novo Horizonte", raizCnpj: "665230880001", segmento: "EDUCACAO",
    bairro: "Jardim América", logradouro: "Av. dos Ipês Amarelos", numero: "2100", lat: -16.7185, lng: -49.2861, contato: "Prof. Sérgio Valadão",
    equipamentos: [
      ...[1, 2, 3, 4, 5, 6].map((n) => split(`Split sala ${n}`, "Salas de aula", "24.000 BTU/h")),
      pisoTeto("Piso-teto auditório 1", "Auditório", "60.000 BTU/h"), pisoTeto("Piso-teto auditório 2", "Auditório", "60.000 BTU/h"),
      split("Split biblioteca", "Biblioteca", "30.000 BTU/h"),
    ],
  },
  {
    nome: "Empório Serra Dourada Alimentos Ltda", fantasia: "Empório Serra Dourada", raizCnpj: "554190330001", segmento: "ALIMENTACAO",
    bairro: "Setor Marista", logradouro: "Rua das Paineiras", numero: "312", lat: -16.7003, lng: -49.2548, contato: "Sra. Renata Gouveia",
    equipamentos: [
      { tipo: "CAMARA_FRIA", nome: "Câmara fria resfriados", setor: "Estoque", capacidade: "4 HP", marca: "Nordair", modelo: "CF-400" },
      { tipo: "CAMARA_FRIA", nome: "Câmara fria congelados", setor: "Estoque", capacidade: "5 HP", marca: "Nordair", modelo: "CF-500" },
      cassete("Cassete salão de vendas 1", "Loja", "48.000 BTU/h"), cassete("Cassete salão de vendas 2", "Loja", "48.000 BTU/h"),
    ],
  },
  {
    nome: "Atrium Office Empreendimentos S.A.", fantasia: "Edifício Atrium Office", raizCnpj: "443870550001", segmento: "CORPORATIVO",
    bairro: "Jardim Goiás", logradouro: "Av. do Cerrado", numero: "5000", lat: -16.7062, lng: -49.2377, contato: "Eng. Carlos Tavares (facilities)",
    equipamentos: [
      { tipo: "CHILLER", nome: "Chiller 01", setor: "Casa de máquinas", capacidade: "120 TR", marca: "Termaxx", modelo: "CH-120 Scroll" },
      { tipo: "CHILLER", nome: "Chiller 02", setor: "Casa de máquinas", capacidade: "120 TR", marca: "Termaxx", modelo: "CH-120 Scroll" },
      { tipo: "VRF", nome: "VRF condensadora 3º andar", setor: "Cobertura", capacidade: "32 HP", marca: "Frigotec", modelo: "VRF-X 32" },
      { tipo: "VRF", nome: "VRF condensadora 4º andar", setor: "Cobertura", capacidade: "32 HP", marca: "Frigotec", modelo: "VRF-X 32" },
      cassete("Cassete hall de entrada", "Térreo", "48.000 BTU/h"),
    ],
  },
  {
    nome: "Hotel Ipê Real Ltda", fantasia: "Hotel Ipê Real", raizCnpj: "332650770001", segmento: "HOTELARIA",
    bairro: "Setor Central", logradouro: "Av. Anhanguera", numero: "1450", lat: -16.6799, lng: -49.2559, contato: "Sr. Márcio Andrade (manutenção)",
    equipamentos: [
      { tipo: "VRF", nome: "VRF condensadora bloco A", setor: "Cobertura", capacidade: "28 HP", marca: "Frigotec", modelo: "VRF-X 28" },
      ...[101, 102, 103, 104].map((n) => split(`Split apto ${n}`, "1º andar", "9.000 BTU/h")),
      pisoTeto("Piso-teto restaurante", "Restaurante"),
    ],
  },
  {
    nome: "Casa & Estilo Móveis Ltda", fantasia: "Casa & Estilo Móveis", raizCnpj: "221430990001", segmento: "COMERCIO",
    bairro: "Setor Sul", logradouro: "Rua das Magnólias", numero: "77", lat: -16.6889, lng: -49.2521, contato: "Sr. Paulo Ferraz",
    equipamentos: [cassete("Cassete showroom 1", "Showroom"), cassete("Cassete showroom 2", "Showroom"), split("Split escritório", "Escritório", "18.000 BTU/h")],
  },
  {
    nome: "Academia Movimento Fitness Ltda", fantasia: "Academia Movimento", raizCnpj: "119870110001", segmento: "COMERCIO",
    bairro: "Setor Pedro Ludovico", logradouro: "Av. das Palmeiras", numero: "930", lat: -16.7208, lng: -49.2532, contato: "Sra. Júlia Campos",
    equipamentos: [pisoTeto("Piso-teto musculação 1", "Musculação"), pisoTeto("Piso-teto musculação 2", "Musculação"), split("Split sala de spinning", "Aulas coletivas", "30.000 BTU/h")],
  },
];

/** Tipos de OS: nome, cor (cor de dado do cadastro) e se exige equipamento. */
export const TIPOS_OS = [
  { chave: "preventiva", nome: "Manutenção preventiva", cor: "#0E7490", exigeEquipamento: true },
  { chave: "corretiva", nome: "Manutenção corretiva", cor: "#B45309", exigeEquipamento: true },
  { chave: "instalacao", nome: "Instalação", cor: "#6D28D9", exigeEquipamento: true },
  { chave: "limpeza", nome: "Limpeza química", cor: "#0F766E", exigeEquipamento: true },
  { chave: "visita", nome: "Visita técnica", cor: "#475569", exigeEquipamento: false },
] as const;
export type ChaveTipoOs = (typeof TIPOS_OS)[number]["chave"];

/** Títulos das atividades por tipo (o texto que o técnico vê na agenda). */
export const TITULOS: Record<ChaveTipoOs, string[]> = {
  preventiva: ["Preventiva mensal PMOC", "Manutenção preventiva mensal", "Preventiva trimestral"],
  corretiva: ["Equipamento não gela", "Vazamento de água na evaporadora", "Ruído na condensadora", "Disjuntor desarmando", "Troca de capacitor"],
  instalacao: ["Instalação de split 24.000 BTU/h", "Instalação de cassete", "Remanejamento de evaporadora"],
  limpeza: ["Limpeza química das serpentinas", "Higienização completa"],
  visita: ["Visita técnica para orçamento", "Vistoria do sistema"],
};

/** Produtos do estoque: nome, unidade, saldo, mínimo e custo (R$). */
export const PRODUTOS = [
  { nome: "Gás refrigerante R-410A (cilindro 11,3 kg)", unidade: "cil", saldo: 6, minimo: 3, custo: 690 },
  { nome: "Gás refrigerante R-32 (cilindro 9 kg)", unidade: "cil", saldo: 4, minimo: 2, custo: 520 },
  { nome: "Gás refrigerante R-22 (cilindro 13,6 kg)", unidade: "cil", saldo: 1, minimo: 2, custo: 980 },
  { nome: "Capacitor 35+5 µF 440 V", unidade: "un", saldo: 18, minimo: 10, custo: 38 },
  { nome: "Capacitor 45 µF 440 V", unidade: "un", saldo: 12, minimo: 6, custo: 42 },
  { nome: "Contatora 25 A bobina 220 V", unidade: "un", saldo: 7, minimo: 4, custo: 96 },
  { nome: "Tubo de cobre 1/4\" (rolo 15 m)", unidade: "rl", saldo: 9, minimo: 4, custo: 310 },
  { nome: "Tubo de cobre 3/8\" (rolo 15 m)", unidade: "rl", saldo: 8, minimo: 4, custo: 455 },
  { nome: "Isolamento térmico 3/8\" (barra 2 m)", unidade: "br", saldo: 45, minimo: 20, custo: 9.5 },
  { nome: "Filtro secador 3/8\"", unidade: "un", saldo: 14, minimo: 6, custo: 27 },
  { nome: "Produto para limpeza química de serpentina (5 L)", unidade: "gl", saldo: 3, minimo: 4, custo: 145 },
  { nome: "Bomba de dreno compacta", unidade: "un", saldo: 5, minimo: 2, custo: 230 },
  { nome: "Suporte para condensadora 500 mm", unidade: "par", saldo: 11, minimo: 4, custo: 64 },
  { nome: "Mangueira de dreno cristal 3/4\" (m)", unidade: "m", saldo: 60, minimo: 30, custo: 4.2 },
  { nome: "Cabo PP 4 x 2,5 mm² (m)", unidade: "m", saldo: 120, minimo: 50, custo: 11.8 },
];
