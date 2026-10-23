/**
 * Modo TÉCNICO (app de campo): quem é "técnico puro" cai direto em "Meu dia" e só vê a navegação
 * mínima (Meu dia · Agenda · Perfil). Arquivo puro (sem Node/Prisma): roda no middleware (Edge).
 *
 * Técnico puro = não é administrador E as permissões dele cabem no perfil padrão de Técnico
 * (OS, equipamentos, calendário, checklist de veículo, QR) E vê OS. Quem tem qualquer permissão a
 * mais (supervisor, financeiro, perfil personalizado com algo além) continua no sistema inteiro.
 * O modo só liga se o usuário está LIGADO a um técnico (mesmo e-mail no cadastro de Técnicos —
 * `tecnicoId` gravado na sessão no login): sem o vínculo não haveria "minhas OS" para mostrar, então
 * ele segue no sistema como antes (nada quebra para quem ainda não foi ligado).
 */
import { PRESETS, permissoesExcedentes, pode, type Permissoes } from "@/lib/permissoes";

export const ROTA_TECNICO = "/tecnico";

export function ehTecnicoPuro(role: string | null | undefined, permissoes: Permissoes | null | undefined): boolean {
  if (role === "ADMIN" || role === "SUPER_ADMIN") return false;
  if (!pode(permissoes, "ordens", "visualizar", role ?? undefined)) return false;
  return permissoesExcedentes(PRESETS.TECNICO, permissoes).length === 0;
}

export interface UsuarioModo { role?: string | null; permissoes?: Permissoes | null; tecnicoId?: string | null }

/** Está no modo técnico dedicado? (técnico puro + ligado a um técnico) */
export function emModoTecnico(u: UsuarioModo | null | undefined): boolean {
  return !!u?.tecnicoId && ehTecnicoPuro(u.role, u.permissoes);
}

/** Rotas de tela que o técnico puro usa fora do app (o resto do sistema leva para "Meu dia"). */
const LIBERADAS = ["/tecnico", "/veiculos/checklist", "/sem-permissao", "/offline", "/instalar", "/sessao-encerrada"];

const dentro = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/**
 * Para onde vai o técnico puro que abriu `pathname` (null = pode ficar). API não passa por aqui
 * (cada rota confere a própria permissão e o escopo do técnico).
 * Link antigo de execução (/ordens/<os>/atividades/<atividade>/executar) abre a mesma atividade no app.
 */
export function destinoModoTecnico(pathname: string): string | null {
  if (pathname.startsWith("/api/")) return null;
  if (LIBERADAS.some((b) => dentro(pathname, b))) return null;
  const exec = /^\/ordens\/([^/]+)\/atividades\/([^/]+)\/executar\/?$/.exec(pathname);
  if (exec) return `${ROTA_TECNICO}?ver=os&a=${encodeURIComponent(exec[2])}`;
  // G12: área do escritório → app do técnico COM aviso (a raiz é só a entrada do app, sem aviso)
  return pathname === "/" ? ROTA_TECNICO : `${ROTA_TECNICO}?aviso=restrito`;
}
