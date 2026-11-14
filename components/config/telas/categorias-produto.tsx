import { TelaCadastroApoio } from "@/components/config/tela-cadastro-apoio";
import { CategoriasProdutoTela } from "@/components/cadastros/telas/categorias-produto";

/** Cadastro padronizado (lib/cadastros): permissões em registro.ts (ler: qualquer usuário; gravar: Configurações › gerenciar). */
export function TelaCategoriasProduto() {
  return (
    <TelaCadastroApoio titulo="Categorias de produto" descricao="Como cada tipo de produto entra na cobrança">
      <CategoriasProdutoTela />
    </TelaCadastroApoio>
  );
}
