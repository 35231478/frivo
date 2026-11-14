import { TelaCadastroApoio } from "@/components/config/tela-cadastro-apoio";
import { KitsMaterialTela } from "@/components/cadastros/telas/kits-material";

/** Cadastro padronizado (lib/cadastros): permissões em registro.ts (ler: qualquer usuário; gravar: Configurações › gerenciar). */
export function TelaKitsMaterial() {
  return (
    <TelaCadastroApoio titulo="Kits de material" descricao="Conjuntos de produtos com quantidade, usados nos materiais padrão dos serviços">
      <KitsMaterialTela />
    </TelaCadastroApoio>
  );
}
