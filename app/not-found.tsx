import type { Metadata } from "next";
import { SearchX } from "lucide-react";
import { auth } from "@/lib/auth";
import { TelaErro, LinkErro } from "@/components/erro/tela-erro";
import { BotaoVoltar } from "@/components/erro/acoes-erro";

export const metadata: Metadata = { title: "Página não encontrada" };

/**
 * 404 de um endereço que não existe (fora do painel: sem menu). Logado, a saída é o painel — "/"
 * leva cada um ao seu (o escritório ao Dashboard, o técnico ao app de campo); sem sessão, o início.
 * (Rota inexistente sem login nem chega aqui: o middleware manda para o login. Aqui chegam os
 * endereços públicos que não existem e quem está logado.)
 */
export default async function NaoEncontrado() {
  // A página de erro não pode quebrar: sem banco, segue como "sem sessão"
  const logado = await auth().then((s) => !!s?.user, () => false);
  return (
    <TelaErro cheia icone={SearchX} titulo="Página não encontrada" texto="O endereço não existe ou foi alterado." data-pagina-erro="404">
      <BotaoVoltar />
      {logado
        ? <LinkErro href="/" data-acao-erro="painel">Ir para o painel</LinkErro>
        : <LinkErro href="/" data-acao-erro="inicio">Ir para o início</LinkErro>}
    </TelaErro>
  );
}
