import {
  Building2, Clock, Cog, FileSpreadsheet, Headset, IdCard, ListChecks, Mail, Package, QrCode, ScrollText, ShieldCheck, Tags,
  Thermometer, UserCog, Wallet, Wrench, type LucideIcon,
} from "lucide-react";
import { moduloDaRota, pode, type Permissoes } from "@/lib/permissoes";

/**
 * Configurações em 3 seções (operacionais, financeiras e da conta), cada uma com subgrupos.
 * Fonte única do menu lateral (vista "Configurações") e das telas de cada seção
 * (/configuracoes/operacionais, /financeiras, /conta). Só reorganiza: as rotas dos itens são
 * as mesmas de sempre, e a permissão de cada item continua vindo da rota (moduloDaRota).
 */

export interface ItemConfig {
  href: string;
  label: string;
  icone: LucideIcon;
  /** Uma linha explicando para que serve (aparece nas telas de seção) */
  dica: string;
  /** Também mostra a dica no menu lateral (Acesso e pessoas) */
  dicaNoMenu?: boolean;
  /** Item que nunca fica "ativo" no menu (âncora dentro de outra tela) */
  matchHref?: string;
}

export interface SubgrupoConfig { titulo: string; itens: ItemConfig[] }

export type SecaoConfigId = "operacionais" | "financeiras" | "conta";

export interface SecaoConfig {
  id: SecaoConfigId;
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
          { href: "/configuracoes/tipos-os", icone: ListChecks, label: "Tipos de OS", dica: "Tipos de serviço executados pela empresa" },
          { href: "/configuracoes/formularios", icone: FileSpreadsheet, label: "Formulários", dica: "Checklists e formulários preenchidos nas atividades" },
          { href: "/configuracoes/termos", icone: ScrollText, label: "Termos de referência", dica: "Modelos de termo usados nas propostas de contrato" },
          { href: "/configuracoes/prazos", icone: Clock, label: "Modelos de prazo", dica: "Etapas, responsáveis e prazos (SLA) das OS" },
        ],
      },
      {
        titulo: "Catálogo",
        itens: [
          { href: "/configuracoes/tipos-equipamento", icone: Thermometer, label: "Tipos de equipamento", dica: "Categorias de equipamento e formulários de cada tipo" },
          { href: "/configuracoes/servicos", icone: Wrench, label: "Serviços", dica: "Serviços prestados, usados em OS e orçamentos" },
          { href: "/configuracoes/produtos", icone: Package, label: "Produtos", dica: "Peças e materiais usados nos serviços" },
          { href: "/configuracoes/tabelas-preco", icone: Tags, label: "Tabelas de preços", dica: "Preços por serviço/produto, vinculados a clientes" },
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
          { href: "/configuracoes/financeiro/categorias", icone: Tags, label: "Categorias financeiras", dica: "Classificam cobranças e despesas (ex.: Contrato Mensal)" },
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
          { href: "/configuracoes", icone: Building2, label: "Dados da empresa", dica: "Razão social, CNPJ, endereço e logo" },
          { href: "/configuracoes#preferencias", icone: Cog, label: "Preferências", dica: "Ajustes avançados e padrões do sistema", matchHref: "__nunca__" },
        ],
      },
      {
        titulo: "Acesso e pessoas",
        itens: [
          { href: "/configuracoes/usuarios", icone: UserCog, label: "Usuários", dica: "Quem faz login no sistema", dicaNoMenu: true },
          { href: "/configuracoes/perfis", icone: ShieldCheck, label: "Perfis de acesso", dica: "O que cada um pode fazer", dicaNoMenu: true },
          { href: "/configuracoes/cargos", icone: IdCard, label: "Cargos", dica: "Cargo do funcionário (usado no Custo de Pessoal)", dicaNoMenu: true },
        ],
      },
      {
        titulo: "Integrações",
        itens: [
          { href: "/configuracoes/email", icone: Mail, label: "E-mail transacional", dica: "Envio de e-mails automáticos (remetente e modelos)" },
          { href: "/configuracoes/portal", icone: Headset, label: "Portal do cliente", dica: "Tipos de problema, aparência e mensagem do portal" },
          { href: "/configuracoes/qr-code", icone: QrCode, label: "Config. QR Code", dica: "Página pública aberta pelo QR dos equipamentos" },
        ],
      },
    ],
  },
];

export const secaoConfig = (id: SecaoConfigId) => SECOES_CONFIGURACOES.find((s) => s.id === id)!;

/** Itens/subgrupos/seções que o perfil vê (mesma regra do menu: permissão do módulo da rota). */
export function secoesVisiveis(permissoes: Permissoes | null | undefined, role?: string): SecaoConfig[] {
  const ve = (i: ItemConfig) => {
    const m = moduloDaRota(i.href.split("#")[0]);
    return !m || pode(permissoes, m, "visualizar", role);
  };
  return SECOES_CONFIGURACOES
    .map((s) => ({ ...s, subgrupos: s.subgrupos.map((g) => ({ ...g, itens: g.itens.filter(ve) })).filter((g) => g.itens.length > 0) }))
    .filter((s) => s.subgrupos.length > 0);
}
