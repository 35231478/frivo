import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ehDonoDoFrivo } from "@/lib/anotacoes/dono";
import { listarAnotacoes } from "@/lib/anotacoes/servidor";
import { AnotacoesLista } from "@/components/anotacoes/anotacoes-lista";

export const metadata: Metadata = { title: "Minhas anotações" };

/**
 * MINHAS ANOTAÇÕES — a lista da ferramenta de construção do dono do Frivo.
 *
 * A página NÃO está no menu de propósito (nem no lateral, nem nos cartões de Configurações): não
 * é recurso do produto e não deve poluir a navegação de ninguém — chega-se por ela pelo balão do
 * modo de anotação ou pelo endereço direto.
 *
 * A trava é de servidor: quem não é o dono vai para /sem-permissao, mesmo digitando a URL. E a
 * leitura é presa a (empresa, usuário) da sessão — SUPER_ADMIN não é chave-mestra entre empresas.
 */
export default async function AnotacoesPage() {
  const session = await auth();
  if (!session) redirect("/sessao-encerrada");
  if (!ehDonoDoFrivo(session.user)) redirect("/sem-permissao");

  const anotacoes = await listarAnotacoes({
    empresaId: session.user.empresaId,
    usuarioId: session.user.id,
  });

  return (
    <AnotacoesLista
      anotacoes={anotacoes.map((a) => ({
        id: a.id,
        tela: a.tela,
        rota: a.rota,
        tituloTela: a.tituloTela,
        rotulo: a.rotulo,
        texto: a.texto,
        status: a.status,
        criadoEm: a.criadoEm.toISOString(),
        temPrint: !!a.print,
      }))}
    />
  );
}
