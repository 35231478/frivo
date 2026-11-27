import { auth } from "@/lib/auth";
import { carregarImplantacao } from "@/lib/implantacao/servidor";
import { PageHeader } from "@/components/ui/page-header";
import { PainelImplantacao } from "@/components/implantacao/painel-implantacao";
import { ImportacoesLotes } from "@/components/implantacao/importacoes-lotes";
import { listarLotes } from "@/lib/importacao/lotes";

/**
 * Configurações › Conta › Implantação — sempre disponível (para novas importações depois de pronto).
 * As contagens são do cadastro real da empresa da sessão; os atalhos respeitam permissão e módulos.
 * Embaixo, as importações (lotes) da empresa, com a prévia e o desfazer (a tela já pede Configurações › Gerenciar).
 */
export async function TelaImplantacao() {
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  const [{ etapas, progresso }, lotes] = await Promise.all([carregarImplantacao(empresaId), listarLotes(empresaId).catch((e) => {
    // Sem as tabelas dos lotes (SQL ainda não aplicado) a Implantação continua abrindo, só sem a lista
    console.error("[implantacao] lotes", e);
    return [];
  })]);
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Implantação"
        description="O passo a passo para começar a usar o Frivo"
        dica="Cada etapa mostra o que já está cadastrado, contado na hora. As planilhas se ligam umas às outras (cliente pelo CNPJ/CPF, colaborador pelo CPF), por isso a ordem importa. Etapas de módulos desligados não aparecem. Até chegar a 100%, a implantação fica em destaque no painel."
        backHref="/configuracoes?aba=conta"
      />
      <div className="space-y-4">
        <PainelImplantacao etapas={etapas} progresso={progresso} />
        <ImportacoesLotes lotes={lotes} />
      </div>
    </div>
  );
}
