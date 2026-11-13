import { rotasColecao } from "@/lib/cadastros/rotas";

/**
 * Compatibilidade: mesma implementação de /api/cadastros/tipos-os (lib/cadastros) — uma regra só.
 * Leitura de catálogo: qualquer usuário logado (telas de OS, orçamento, contrato e cliente); gravar
 * exige Configurações › gerenciar. Sem ?ativo devolve todos (ativos e inativos), como sempre devolveu,
 * com os formulários ativos de cada tipo.
 */
const r = rotasColecao("tipos-os", { ativoPadrao: "todos" });
export const GET = r.GET;
export const POST = r.POST;
