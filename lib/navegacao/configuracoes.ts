import {
  Building2, Clock, Cog, FileSpreadsheet, Headset, IdCard, Landmark, ListChecks, Mail, Package, Printer, QrCode, ScrollText, ShieldCheck, Tags,
  Target, Thermometer, UserCog, Wallet, Wrench, type LucideIcon,
} from "lucide-react";
import { moduloDaRota, pode, type Permissoes } from "@/lib/permissoes";

/**
 * Configurações: UMA página (/configuracoes) com 3 abas (operacionais, financeiras, conta), cada
 * uma com seus cartões. Clicar num cartão abre a tela COMPLETA daquele item numa gaveta lateral,
 * sem sair da página; a URL acompanha (?aba=…&secao=…) para o refresh e os links reabrirem a gaveta.
 * As rotas antigas de cada item (`href`) redirecionam para cá, e a permissão de cada item continua
 * vindo dessa rota (moduloDaRota) — mesma regra de antes.
 */

export interface ItemConfig {
  /** Identificador na URL (?secao=…) e da tela que abre na gaveta (components/config/telas) */
  id: string;
  /** Rota antiga do item: redireciona para a gaveta e define a permissão */
  href: string;
  label: string;
  icone: LucideIcon;
  /** Uma linha explicando para que serve (aparece no cartão) */
  dica: string;
}

export interface SubgrupoConfig { titulo: string; itens: ItemConfig[] }

export type SecaoConfigId = "operacionais" | "financeiras" | "conta";

/** Uma aba da página de Configurações */
export interface SecaoConfig {
  id: SecaoConfigId;
  /** Rota antiga da aba (redireciona para /configuracoes?aba=…) */
  href: string;
  label: string;
  /** Rótulo curto (abas no celular) */
  curto: string;
  descricao: string;
  icone: LucideIcon;
  subgrupos: SubgrupoConfig[];
}

export const SECOES_CONFIGURACOES: SecaoConfig[] = [
  {
    id: "operacionais", href: "/configuracoes/operacionais", label: "Configurações operacionais", curto: "Operacionais", icone: Cog,
    descricao: "Como as ordens de serviço funcionam e o catálogo do que a empresa vende e executa.",
    subgrupos: [
      {
        titulo: "Ordens de serviço",
        itens: [
          { id: "tipos-os", href: "/configuracoes/tipos-os", icone: ListChecks, label: "Tipos de OS", dica: "Tipos de serviço executados pela empresa" },
          { id: "formularios", href: "/configuracoes/formularios", icone: FileSpreadsheet, label: "Formulários", dica: "Checklists e formulários preenchidos nas atividades" },
          { id: "termos", href: "/configuracoes/termos", icone: ScrollText, label: "Termos de referência", dica: "Modelos de termo usados nas propostas de contrato" },
          { id: "prazos", href: "/configuracoes/prazos", icone: Clock, label: "Modelos de prazo", dica: "Etapas, responsáveis e prazos (SLA) das OS" },
          { id: "impressao-os", href: "/configuracoes/impressao-os", icone: Printer, label: "Impressão da OS", dica: "Seções do relatório da OS e o que o cliente vê" },
        ],
      },
      {
        titulo: "Catálogo",
        itens: [
          { id: "tipos-equipamento", href: "/configuracoes/tipos-equipamento", icone: Thermometer, label: "Tipos de equipamento", dica: "Categorias de equipamento e formulários de cada tipo" },
          { id: "servicos", href: "/configuracoes/servicos", icone: Wrench, label: "Serviços", dica: "Serviços prestados, usados em OS e orçamentos" },
          { id: "produtos", href: "/configuracoes/produtos", icone: Package, label: "Produtos", dica: "Peças e materiais usados nos serviços" },
          { id: "tabelas-preco", href: "/configuracoes/tabelas-preco", icone: Tags, label: "Tabelas de preços", dica: "Preços por serviço/produto, vinculados a clientes" },
        ],
      },
    ],
  },
  {
    id: "financeiras", href: "/configuracoes/financeiras", label: "Configurações financeiras", curto: "Financeiras", icone: Wallet,
    descricao: "Classificação das cobranças e despesas. Novos ajustes do financeiro entram aqui.",
    subgrupos: [
      {
        titulo: "Classificação",
        itens: [
          { id: "categorias-financeiras", href: "/configuracoes/financeiro/categorias", icone: Tags, label: "Categorias financeiras", dica: "Classificam cobranças e despesas (ex.: Contrato Mensal)" },
          { id: "centros-custo", href: "/configuracoes/financeiro/centros-custo", icone: Target, label: "Centros de custo", dica: "Onde a despesa pesa (ex.: uma obra, a frota) — em toda conta a pagar" },
        ],
      },
      {
        titulo: "Integrações",
        itens: [
          { id: "banco-inter", href: "/configuracoes/integracoes/inter", icone: Landmark, label: "Banco Inter", dica: "Boletos e baixa automática dos pagamentos" },
        ],
      },
    ],
  },
  {
    id: "conta", href: "/configuracoes/conta", label: "Configurações da conta", curto: "Conta", icone: Building2,
    descricao: "Dados da empresa, quem acessa o sistema e as integrações.",
    subgrupos: [
      {
        titulo: "Empresa",
        itens: [
          { id: "empresa", href: "/configuracoes", icone: Building2, label: "Dados da empresa", dica: "Razão social, CNPJ, endereço e logo" },
          { id: "preferencias", href: "/configuracoes", icone: Cog, label: "Preferências", dica: "Ajustes avançados e padrões do sistema" },
        ],
      },
      {
        titulo: "Acesso e pessoas",
        itens: [
          { id: "usuarios", href: "/configuracoes/usuarios", icone: UserCog, label: "Usuários", dica: "Quem faz login no sistema" },
          { id: "perfis", href: "/configuracoes/perfis", icone: ShieldCheck, label: "Perfis de acesso", dica: "O que cada um pode fazer" },
          { id: "cargos", href: "/configuracoes/cargos", icone: IdCard, label: "Cargos", dica: "Cargo do funcionário (usado no Custo de Pessoal)" },
        ],
      },
      {
        titulo: "Integrações",
        itens: [
          { id: "email", href: "/configuracoes/email", icone: Mail, label: "E-mail transacional", dica: "Envio de e-mails automáticos (remetente e modelos)" },
          { id: "portal", href: "/configuracoes/portal", icone: Headset, label: "Portal do cliente", dica: "Tipos de problema, aparência e mensagem do portal" },
          { id: "qr-code", href: "/configuracoes/qr-code", icone: QrCode, label: "Config. QR Code", dica: "Página pública aberta pelo QR dos equipamentos" },
        ],
      },
    ],
  },
];

/**
 * Telas que abrem na gaveta sem cartão próprio: chegam por um link de dentro de outra tela
 * (ex.: "Editar templates de e-mail", dentro de E-mail transacional).
 */
export const ITENS_SEM_CARTAO: (ItemConfig & { aba: SecaoConfigId })[] = [
  { id: "email-templates", aba: "conta", href: "/configuracoes/email/templates", icone: Mail, label: "Templates de e-mail", dica: "Assunto e corpo dos e-mails automáticos" },
];

export const secaoConfig = (id: SecaoConfigId) => SECOES_CONFIGURACOES.find((s) => s.id === id)!;

/** Todos os itens que abrem na gaveta, com a aba de cada um */
export const ITENS_CONFIGURACOES: (ItemConfig & { aba: SecaoConfigId })[] = [
  ...SECOES_CONFIGURACOES.flatMap((s) => s.subgrupos.flatMap((g) => g.itens.map((i) => ({ ...i, aba: s.id })))),
  ...ITENS_SEM_CARTAO,
];

export const itemConfig = (id: string | null | undefined) => ITENS_CONFIGURACOES.find((i) => i.id === id) ?? null;

export const ehAbaConfig = (v: unknown): v is SecaoConfigId => v === "operacionais" || v === "financeiras" || v === "conta";

/** Link da página de Configurações numa aba */
export const hrefAbaConfig = (aba: SecaoConfigId) => `/configuracoes?aba=${aba}`;

/** Link que abre a tela do item na gaveta (refresh e links reabrem a mesma gaveta) */
export function hrefSecaoConfig(id: string) {
  const i = itemConfig(id);
  return i ? `/configuracoes?aba=${i.aba}&secao=${i.id}` : "/configuracoes";
}

/** O perfil pode abrir este item? (mesma regra do cartão: permissão do módulo da rota antiga) */
export function podeVerItemConfig(i: ItemConfig, permissoes: Permissoes | null | undefined, role?: string) {
  const m = moduloDaRota(i.href.split("#")[0]);
  return !m || pode(permissoes, m, "visualizar", role);
}

/** Abas/subgrupos/itens que o perfil vê (permissão do módulo da rota antiga de cada item). */
export function secoesVisiveis(permissoes: Permissoes | null | undefined, role?: string): SecaoConfig[] {
  const ve = (i: ItemConfig) => podeVerItemConfig(i, permissoes, role);
  return SECOES_CONFIGURACOES
    .map((s) => ({ ...s, subgrupos: s.subgrupos.map((g) => ({ ...g, itens: g.itens.filter(ve) })).filter((g) => g.itens.length > 0) }))
    .filter((s) => s.subgrupos.length > 0);
}
