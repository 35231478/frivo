/**
 * Implantação — o passo a passo para uma empresa começar a usar o Frivo, com o que já foi feito
 * contado de verdade no cadastro (nada é marcado à mão). Puro: o servidor conta (lib/implantacao/servidor)
 * e a tela e o painel só desenham.
 *
 * Regras:
 *  - etapa de um módulo que a EMPRESA desligou não aparece e não conta (quem não usa Frota não fica preso
 *    em "Veículos");
 *  - uma etapa está feita quando o mínimo dela existe (ex.: 1 cliente); as contagens ao lado mostram o resto;
 *  - "Não se aplica / fazer depois": a etapa marcada conta como concluída (e pode ser reaberta); feita de
 *    verdade continua sendo o que o cadastro mostra;
 *  - 100% = todas as etapas que aparecem concluídas (feitas ou marcadas). Até lá, o painel (dashboard) mostra o destaque; depois,
 *    a Implantação fica só em Configurações.
 */
import type { EntidadeImportacao } from "@/lib/importacao/entidades";
import { LABEL_COBRANCA, regraDeCobranca, type CobrancaMateriais } from "@/lib/orcamentos/materiais";

export type EtapaId = "empresa" | "clientes" | "equipamentos" | "estoque" | "colaboradores" | "veiculos" | "contratos";

/** O que o servidor conta na empresa (só da empresa da sessão). */
export interface Contagens {
  /** Razão social, CNPJ e endereço (rua e cidade) preenchidos */
  dadosEmpresa: boolean;
  logo: boolean;
  tiposOs: number;
  usuarios: number;
  clientes: number;
  unidades: number;
  contatos: number;
  equipamentos: number;
  /** Produtos ativos que controlam estoque */
  produtosEstoque: number;
  /** Desses, os que já têm alguma movimentação (saldo lançado) */
  produtosComSaldo: number;
  colaboradores: number;
  veiculos: number;
  contratos: number;
  pmocs: number;
  /** "Orçamento E2": como a empresa cobra os materiais (sem a configuração gravada, o padrão: Incluso) */
  cobrancaMateriais?: CobrancaMateriais | null;
}

export interface ItemEtapa {
  rotulo: string;
  /** Número contado, ou "ok"/"falta" para um requisito sim/não */
  valor: number | boolean;
  /** Em vez do número/ok: a escolha atual (ex.: "Incluso no serviço") — o item é uma decisão, não uma contagem */
  texto?: string;
  /** Seção de Configurações que resolve o item (abre na gaveta) */
  secao?: string;
}

export interface Etapa {
  id: EtapaId;
  numero: number;
  titulo: string;
  /** Uma linha: o que fazer nesta etapa */
  descricao: string;
  /** O mínimo existe no cadastro */
  feita: boolean;
  /** Marcada "Não se aplica / fazer depois" (e ainda não feita) */
  dispensada: boolean;
  itens: ItemEtapa[];
  /** Planilhas desta etapa (atalho para importar e baixar o modelo), na ordem de importação */
  importacoes: EntidadeImportacao[];
  /** A lista onde se cadastra pela tela */
  href?: string;
  /** Um aviso da etapa, acima dos botões (ex.: como os contratos entram pela planilha) */
  nota?: string;
}

/** Módulo da empresa de que cada etapa depende (desligado = a etapa some). Etapas do núcleo não têm. */
export const MODULO_DA_ETAPA: Partial<Record<EtapaId, string[]>> = {
  equipamentos: ["equipamentos"],
  estoque: ["estoque"],
  veiculos: ["veiculos"],
  // Contratos ou PMOC: some só se os DOIS estiverem desligados
  contratos: ["contratos", "pmoc"],
};

export const ETAPAS_IDS: EtapaId[] = ["empresa", "clientes", "equipamentos", "estoque", "colaboradores", "veiculos", "contratos"];
export const ehEtapaId = (v: unknown): v is EtapaId => typeof v === "string" && (ETAPAS_IDS as string[]).includes(v);

/** Concluída = feita de verdade OU marcada "Não se aplica / fazer depois" */
export const concluida = (e: Pick<Etapa, "feita" | "dispensada">) => e.feita || e.dispensada;

export function montarEtapas(c: Contagens, temModulo: (m: string) => boolean, dispensadas: readonly string[] = []): Etapa[] {
  const todas: Omit<Etapa, "numero" | "dispensada">[] = [
    {
      id: "empresa", titulo: "Empresa e configurações", descricao: "Dados da empresa, logo, tipos de OS e quem vai usar o sistema.",
      feita: c.dadosEmpresa && c.logo && c.tiposOs > 0,
      itens: [
        { rotulo: "Dados da empresa (CNPJ e endereço)", valor: c.dadosEmpresa, secao: "empresa" },
        { rotulo: "Logo", valor: c.logo, secao: "empresa" },
        { rotulo: "Tipos de OS", valor: c.tiposOs, secao: "tipos-os" },
        { rotulo: "Usuários com acesso", valor: c.usuarios, secao: "usuarios" },
        // "Orçamento E2": a empresa nova decide no começo como cobra os materiais (sempre há uma escolha: o padrão vale)
        { rotulo: "Como você cobra materiais?", valor: true, texto: LABEL_COBRANCA[regraDeCobranca(c.cobrancaMateriais)], secao: "orcamento" },
      ],
      importacoes: [],
    },
    {
      id: "clientes", titulo: "Clientes, unidades e contatos", descricao: "Uma planilha de cada, ligadas pelo CNPJ/CPF do cliente.",
      feita: c.clientes > 0,
      itens: [{ rotulo: "Clientes", valor: c.clientes }, { rotulo: "Unidades", valor: c.unidades }, { rotulo: "Contatos", valor: c.contatos }],
      importacoes: ["clientes", "unidades", "contatos"], href: "/clientes",
    },
    {
      id: "equipamentos", titulo: "Equipamentos", descricao: "O parque de cada cliente, na unidade certa.",
      feita: c.equipamentos > 0, itens: [{ rotulo: "Equipamentos", valor: c.equipamentos }],
      importacoes: ["equipamentos"], href: "/equipamentos",
    },
    {
      id: "estoque", titulo: "Estoque inicial", descricao: "Os produtos e o saldo contado de cada um (custo opcional).",
      feita: c.produtosComSaldo > 0,
      itens: [{ rotulo: "Produtos que controlam estoque", valor: c.produtosEstoque }, { rotulo: "Com saldo lançado", valor: c.produtosComSaldo }],
      importacoes: ["produtos", "estoque"], href: "/estoque",
    },
    {
      id: "colaboradores", titulo: "Colaboradores", descricao: "A equipe, pelo CPF. Salário e acesso ao app ficam na ficha de cada um.",
      feita: c.colaboradores > 0, itens: [{ rotulo: "Colaboradores ativos", valor: c.colaboradores }],
      importacoes: ["colaboradores"], href: "/colaboradores",
    },
    {
      id: "veiculos", titulo: "Veículos", descricao: "A frota, pela placa, com o responsável de cada veículo.",
      feita: c.veiculos > 0, itens: [{ rotulo: "Veículos", valor: c.veiculos }],
      importacoes: ["veiculos"], href: "/veiculos",
    },
    {
      id: "contratos", titulo: "Contratos e PMOC", descricao: "Os contratos de manutenção e os planos PMOC vigentes.",
      feita: c.contratos > 0 || c.pmocs > 0,
      itens: [
        ...(temModulo("contratos") ? [{ rotulo: "Contratos", valor: c.contratos }] : []),
        ...(temModulo("pmoc") ? [{ rotulo: "Planos PMOC", valor: c.pmocs }] : []),
      ],
      // A tela mostra só as planilhas dos módulos ligados (e que a pessoa pode importar)
      importacoes: ["contratos", "pmocs"], href: temModulo("contratos") ? "/contratos" : "/pmoc",
      nota: "Pela planilha, o contrato ativo entra Suspenso e o PMOC entra em Rascunho: nada é cobrado nem agendado até alguém revisar e ativar (ou publicar) pela tela.",
    },
  ];
  return todas
    .filter((e) => !MODULO_DA_ETAPA[e.id] || MODULO_DA_ETAPA[e.id]!.some(temModulo))
    // Feita de verdade vence a marcação: "dispensada" é só para o que ainda não existe
    .map((e, i) => ({ ...e, numero: i + 1, dispensada: !e.feita && dispensadas.includes(e.id) }));
}

export interface Progresso { feitas: number; total: number; pct: number; completa: boolean; proxima: Etapa | null }

/** Quanto falta: % arredondado para baixo (99,9% não vira 100% antes da hora). */
export function progresso(etapas: Etapa[]): Progresso {
  const feitas = etapas.filter(concluida).length;
  const total = etapas.length;
  return {
    feitas, total,
    pct: total ? Math.floor((feitas / total) * 100) : 100,
    completa: feitas === total,
    proxima: etapas.find((e) => !concluida(e)) ?? null,
  };
}

/**
 * O destaque no painel: só para quem configura a empresa e só enquanto não chegou a 100%. Depois, a
 * Implantação fica só em Configurações (sempre disponível).
 */
export const destaqueNoPainel = (podeConfigurar: boolean, p: Progresso | null | undefined): p is Progresso => podeConfigurar && !!p && !p.completa;

/** Link que abre a Implantação (a gaveta em Configurações › Conta). */
export const HREF_IMPLANTACAO = "/configuracoes?aba=conta&secao=implantacao";
