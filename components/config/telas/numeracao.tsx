import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { lerNumeracoes } from "@/lib/numeracao-server";
import { PageHeader } from "@/components/ui/page-header";
import { NumeracaoClient } from "@/components/config/numeracao-client";

/** Configurações › Conta › Numeração de documentos (rota protegida por Configurações › visualizar). */
export async function TelaNumeracao() {
  const session = await auth();
  const u = session!.user!;
  const numeracoes = await lerNumeracoes(u.empresaId);
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Numeração de documentos"
        description="O próximo número de cada documento"
        dica="Para continuar a numeração do sistema anterior. A sequência é contínua, não reinicia no ano. Só os próximos documentos mudam; a NFS-e não entra (número da prefeitura)."
        backHref="/configuracoes/conta"
      />
      <NumeracaoClient inicial={numeracoes} podeEditar={pode(u.permissoes, "configuracoes", "gerenciar", u.role)} />
    </div>
  );
}
