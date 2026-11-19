/**
 * A TRAVA DA FERRAMENTA DE ANOTAÇÕES — um arquivo só, para não existir uma segunda resposta.
 *
 * As Anotações Internas são ferramenta de CONSTRUÇÃO do dono do Frivo, não recurso do cliente.
 * Por isso a chave NÃO pode ser `role === "ADMIN"`: no Frivo, cada empresa-cliente tem o seu
 * próprio ADMIN (o administrador DELA). Gatear por ADMIN entregaria a ferramenta a todo cliente.
 *
 * A chave é `SUPER_ADMIN`, um papel que já existia no enum do banco e que ninguém tinha: nenhum
 * seed cria, nenhuma rota de criação oferece. Promover alguém é um UPDATE à mão
 * (prisma/sql/2027-01-25_promover_super_admin.sql).
 *
 * O QUE ESTE PAPEL **NÃO** É — a parte que importa:
 *
 *   SUPER_ADMIN NÃO É CHAVE-MESTRA ENTRE EMPRESAS.
 *
 * Ele abre esta ferramenta e nada mais. O isolamento multiempresa do Frivo não passa por papel
 * nenhum: ele vem de toda consulta ficar presa ao `empresaId` da SESSÃO (`where: { id, empresaId }`,
 * repetido em cada rota). Um SUPER_ADMIN da empresa A continua recebendo "não encontrado" ao pedir
 * um cliente, uma OS ou um equipamento da empresa B — igualzinho a qualquer outro usuário. E as
 * anotações também são por empresa + usuário. Há teste travando os dois lados disso
 * (tests/unit/anotacoes-pg.test.ts › "SUPER_ADMIN não é chave-mestra entre empresas").
 *
 * Dentro da própria empresa o papel também não amplia nada: `pode()` (lib/permissoes.ts) já
 * tratava ADMIN e SUPER_ADMIN do mesmo jeito antes desta leva.
 */

/** O papel que abre a ferramenta. Fica aqui, em um lugar só, para a trava não se espalhar. */
export const PAPEL_DONO = "SUPER_ADMIN";

/**
 * É o dono do Frivo? Só ele vê o botão, o modo, os pins e a tela das anotações.
 *
 * Tolerante à entrada de propósito (sessão ausente, usuário sem papel): a resposta segura é
 * "não é o dono", nunca um erro — a casca que monta a ferramenta roda em toda navegação.
 */
export function ehDonoDoFrivo(usuario: { role?: string | null } | null | undefined): boolean {
  return usuario?.role === PAPEL_DONO;
}

/** Mensagem única da recusa, para a API e a página dizerem a mesma coisa. */
export const MSG_SO_O_DONO = "Esta ferramenta é do administrador do Frivo.";
