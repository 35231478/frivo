import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import { ROTULO_LINK, type SituacaoLink } from "@/lib/documentacao/pacote";

const TOM: Record<SituacaoLink, TomStatus> = { ATIVO: "ok", EXPIRADO: "atencao", REVOGADO: "atrasado", SEM_LINK: "previsto" };

const AJUDA: Record<SituacaoLink, string> = {
  ATIVO: "O cliente consegue abrir e baixar.",
  EXPIRADO: "O prazo passou. Dá para gerar um link novo.",
  REVOGADO: "Desativado pela empresa. Dá para gerar um link novo.",
  SEM_LINK: "O pacote só foi baixado em zip. Dá para gerar um link.",
};

/** A situação do link do envio — o mesmo selo na lista e no detalhe. */
export function SeloLink({ situacao }: { situacao: string }) {
  const s = (situacao in TOM ? situacao : "SEM_LINK") as SituacaoLink;
  return (
    <StatusPill tom={TOM[s]} data-selo-link={s}>
      <span title={AJUDA[s]}>{ROTULO_LINK[s]}</span>
    </StatusPill>
  );
}
