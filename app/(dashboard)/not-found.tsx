import { SearchX } from "lucide-react";
import { TelaErro, LinkErro } from "@/components/erro/tela-erro";
import { BotaoVoltar } from "@/components/erro/acoes-erro";

/**
 * 404 DENTRO do painel (o menu continua): uma OS, cliente ou equipamento que não existe mais, ou um
 * link incompleto. Antes caía no "This page could not be found" do Next, em inglês.
 */
export default function NaoEncontradoNoPainel() {
  return (
    <TelaErro icone={SearchX} titulo="Página não encontrada" texto="O registro não existe mais ou o link está incompleto." data-pagina-erro="404-painel">
      <BotaoVoltar />
      <LinkErro href="/" data-acao-erro="painel">Ir para o painel</LinkErro>
    </TelaErro>
  );
}
