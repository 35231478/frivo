"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, Ban, Check, Copy, Eye, FileSignature, FileText, FolderDown, Link2Off, Mail, Pencil, Send, UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { ItemMenu, MenuAcoes, SeparadorMenu } from "@/components/ui/menu-acoes";
import { StatusPill, TOM_SITUACAO_ADMISSAO } from "@/components/ui/status-pill";
import { toast, confirmar } from "@/components/ui/avisos";
import { cn, formatarData } from "@/lib/utils";
import {
  AJUDA_SITUACAO, MOTIVO_MIN, ROTULO_ETAPA, ROTULO_SITUACAO, caminhoPublicoAdmissao, motivoValido,
  podeIr, podeReenviar, type Etapa, type SituacaoAdmissao,
} from "@/lib/admissao/admissao";
import type { AdmissaoDoRh, ProgressoAdmissao } from "@/lib/admissao/admissao-server";
import { temEntrega } from "@/lib/admissao/admissao-entrega-regras";

/** A pílula da situação, com o ⓘ do que ela significa no texto do title. */
export function SeloSituacao({ situacao, className }: { situacao: string; className?: string }) {
  const s = situacao as SituacaoAdmissao;
  return (
    <StatusPill tom={TOM_SITUACAO_ADMISSAO[s] ?? "previsto"} data-situacao={s} className={className}>
      <span title={AJUDA_SITUACAO[s]}>{ROTULO_SITUACAO[s] ?? s}</span>
    </StatusPill>
  );
}

/**
 * Baixar é uma navegação, não uma ação: `<a>` de verdade (o Button da casa é um `<button>`). O
 * traje é o do botão secundário, para a faixa de ações ficar uniforme.
 */
const BOTAO_LINK = "inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-surface-border text-ink hover:bg-surface-alt transition-colors";

const linkDa = (token: string) =>
  `${typeof window === "undefined" ? "" : window.location.origin}${caminhoPublicoAdmissao(token)}`;

/** Resposta do envio do link (o que a rota de reenvio devolve) */
interface Envio {
  url: string; mensagem: string; whatsappUrl: string | null;
  emailEnviado: boolean; emailPara: string | null; erroEmail: string | null;
}

/**
 * As ações de uma admissão — as MESMAS na lista (menu ⋮) e na ficha do colaborador (botões):
 * enviar o link, copiar, ver o progresso, invalidar, cancelar com razão, marcar enviado ao contador
 * e admitir. Cada botão só aparece quando a rota aceitaria (as mesmas regras de lib/admissao), e o
 * servidor confere de novo.
 */
export function AcoesAdmissao({ admissao, variante = "menu", abreFicha = true }: {
  admissao: AdmissaoDoRh;
  /** "menu" = ⋮ da linha da lista; "botoes" = os botões da ficha do colaborador */
  variante?: "menu" | "botoes";
  /**
   * Quem está na tela pode abrir a ficha do colaborador (Equipes › Visualizar e Gerenciar)? Na lista,
   * o RH que só tem "Admissão digital" não ganha "Editar os dados": o item levaria a "sem permissão".
   */
  abreFicha?: boolean;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [envio, setEnvio] = useState<Envio | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [progresso, setProgresso] = useState<ProgressoAdmissao | null>(null);

  const s = admissao.situacao;
  const chamar = async (acao: string, caminho: string, corpo?: unknown) => {
    setOcupado(acao);
    try {
      const res = await fetch(`/api/admissoes/${admissao.id}${caminho}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data?.erro ?? "Não foi possível concluir a ação.", "erro"); return null; }
      router.refresh();
      return data;
    } catch {
      toast("Erro de conexão. Tente de novo.", "erro");
      return null;
    } finally { setOcupado(null); }
  };

  async function enviar() {
    const r = (await chamar("enviar", "/reenviar")) as { admissao: AdmissaoDoRh } & Envio | null;
    if (!r) return;
    setEnvio(r);
    toast(r.emailEnviado ? `Link enviado para ${r.emailPara}.` : "Link gerado. Copie e mande pelo WhatsApp.");
  }

  async function copiar() {
    const url = linkDa(admissao.token);
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copiado.");
    } catch { setEnvio({ url, mensagem: url, whatsappUrl: null, emailEnviado: false, emailPara: null, erroEmail: null }); }
  }

  async function invalidar() {
    const ok = await confirmar({
      titulo: "Invalidar o link?",
      mensagem: "O link para de funcionar na hora. “Enviar o link” depois dá um prazo novo, no mesmo endereço.",
      confirmarTexto: "Invalidar o link", perigo: true,
    });
    if (!ok) return;
    if (await chamar("invalidar", "/invalidar")) toast("Link invalidado.");
  }

  async function cancelar() {
    if (!motivoValido(motivo)) return;
    if (await chamar("cancelar", "/cancelar", { motivo })) {
      toast("Admissão cancelada. O histórico fica.");
      setCancelando(false); setMotivo("");
    }
  }

  async function contador() {
    const ok = await confirmar({
      titulo: "Marcar como enviado ao contador?",
      mensagem: "Registra que a ficha e os documentos foram para o contador, com quem marcou e quando.",
      confirmarTexto: "Marcar enviado",
    });
    if (!ok) return;
    if (await chamar("contador", "/contador")) toast("Marcado como enviado ao contador.");
  }

  async function admitir() {
    const ok = await confirmar({
      titulo: "Concluir a admissão?",
      mensagem: `${admissao.colaborador.nome} entra no quadro como ativo, nas listas e nos seletores.`,
      confirmarTexto: "Admitir",
    });
    if (!ok) return;
    if (await chamar("admitir", "/admitir")) toast("Admissão concluída. O colaborador está no quadro.");
  }

  async function verProgresso() {
    setOcupado("progresso");
    try {
      const res = await fetch(`/api/admissoes/${admissao.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data?.erro ?? "Não foi possível abrir o progresso.", "erro"); return; }
      setProgresso(data as ProgressoAdmissao);
    } catch { toast("Erro de conexão. Tente de novo.", "erro"); } finally { setOcupado(null); }
  }

  const temLink = podeReenviar(s);
  const podeCancelarAgora = podeIr(s, "CANCELADA");
  // A ficha e o pacote existem de ASSINADO em diante — a MESMA regra do servidor, para o botão
  // nunca oferecer o que a rota recusaria.
  const temEntregaAgora = temEntrega(s);
  const baseEntrega = `/api/admissoes/${admissao.id}`;
  const podeContador = podeIr(s, "ENVIADO_CONTADOR");
  const podeAdmitir = podeIr(s, "ADMITIDO");
  const fichaHref = `/colaboradores/${admissao.colaborador.id}/editar`;

  const dialogos = (
    <>
      {/* O link gerado: copiar, WhatsApp e o que aconteceu com o e-mail */}
      <Modal aberto={!!envio} onFechar={() => setEnvio(null)} titulo="Link da admissão" tamanho="md">
        {envio && (
          <div className="p-5 space-y-4" data-envio-admissao>
            <p className="text-sm text-ink-muted">
              Link pessoal de <strong className="text-ink">{admissao.colaborador.nome}</strong>. Vale até{" "}
              {formatarData(admissao.expiraEm)}.
            </p>
            <div className="flex items-center gap-2">
              <input readOnly value={envio.url} data-envio-url aria-label="Link da admissão"
                className="flex-1 bg-surface-linha border border-surface-border rounded-lg px-3 py-2 text-sm text-ink-muted" />
              <Button type="button" variant="secondary" onClick={copiar} data-envio-copiar><Copy className="w-4 h-4" /> Copiar</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {envio.whatsappUrl && (
                <a href={envio.whatsappUrl} target="_blank" rel="noreferrer" data-envio-whatsapp
                  className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold bg-ok text-white hover:bg-ok-texto">
                  <Send className="w-4 h-4" /> Abrir no WhatsApp
                </a>
              )}
            </div>
            <p className={cn("flex items-start gap-1.5 text-xs", envio.emailEnviado ? "text-ok-texto" : "text-atencao-texto")} data-envio-email>
              {envio.emailEnviado
                ? <><Mail className="w-3.5 h-3.5 shrink-0 mt-0.5" /> E-mail enviado para {envio.emailPara}.</>
                : <><AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> E-mail não saiu ({envio.erroEmail ?? "sem detalhe"}). Mande o link pelo WhatsApp.</>}
            </p>
          </div>
        )}
      </Modal>

      {/* Cancelar: a razão é obrigatória e fica no registro */}
      <Modal aberto={cancelando} onFechar={() => { setCancelando(false); setMotivo(""); }} titulo="Cancelar a admissão" tamanho="sm">
        <div className="p-5 space-y-4" data-cancelar-admissao>
          <p className="text-sm text-ink-muted">
            Nada é apagado: a admissão fica como <strong className="text-ink">cancelada</strong>, com a razão e
            quem cancelou. O cadastro do colaborador e os documentos continuam.
          </p>
          <FormField label="Motivo do cancelamento" required hint={`Pelo menos ${MOTIVO_MIN} caracteres.`}>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} data-cancelar-motivo
              placeholder="Ex.: candidata aceitou outra proposta" />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => { setCancelando(false); setMotivo(""); }}>Voltar</Button>
            <Button type="button" variant="danger" onClick={cancelar} loading={ocupado === "cancelar"}
              disabled={!motivoValido(motivo)} data-cancelar-confirmar>
              Cancelar a admissão
            </Button>
          </div>
        </div>
      </Modal>

      {/* Progresso: onde parou, o que falta e o que já chegou */}
      <Modal aberto={!!progresso} onFechar={() => setProgresso(null)} titulo="Progresso da admissão" tamanho="lg">
        {progresso && (
          <div className="p-5 space-y-4 text-sm" data-progresso-admissao>
            <div className="flex flex-wrap items-center gap-2">
              <SeloSituacao situacao={progresso.admissao.situacao} />
              <span className="text-ink-muted">
                {progresso.admissao.abertoEm ? `Abriu o link em ${formatarData(progresso.admissao.abertoEm, "dd/MM/yyyy HH:mm")}` : "Ainda não abriu o link"}
              </span>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-ink-muted mb-1">O que falta</p>
              {progresso.etapaPendente ? (
                <p className="text-ink" data-progresso-falta>
                  <strong>{ROTULO_ETAPA[progresso.etapaPendente as Etapa] ?? progresso.etapaPendente}</strong>
                  {progresso.faltando.length > 0 && <>: {progresso.faltando.join(", ")}</>}
                </p>
              ) : (
                <p className="text-ok-texto flex items-center gap-1.5" data-progresso-completo><Check className="w-4 h-4" /> O preenchimento está completo.</p>
              )}
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-ink-muted mb-1">Documentos ({progresso.documentos.length})</p>
              {progresso.documentos.length === 0 ? (
                <p className="text-ink-muted">Nenhum documento enviado ainda.</p>
              ) : (
                <ul className="divide-y divide-surface-linha border border-surface-border rounded-lg">
                  {progresso.documentos.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2" data-progresso-doc={d.docId}>
                      <span className="text-ink truncate">{d.rotulo} <span className="text-ink-muted">· {d.nome}</span></span>
                      <span className="text-xs text-ink-muted shrink-0">{formatarData(d.criadoEm)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {progresso.documentosFaltando.length > 0 && (
                <p className="text-xs text-atencao-texto mt-1.5" data-progresso-doc-falta>
                  Falta(m): {progresso.documentosFaltando.map((d) => d.rotulo).join(", ")}
                </p>
              )}
            </div>
            {progresso.admissao.assinaturaEm && (
              <div className="bg-ok-claro border border-ok/20 rounded-lg px-4 py-3" data-progresso-assinatura>
                <p className="font-semibold text-ok-texto">Contrato assinado</p>
                <p className="text-ink">
                  Por {progresso.admissao.assinaturaNome} em {formatarData(progresso.admissao.assinaturaEm, "dd/MM/yyyy HH:mm")}
                  {progresso.admissao.assinaturaIp && <> · IP {progresso.admissao.assinaturaIp}</>}
                </p>
              </div>
            )}
            {progresso.admissao.cancelamentoMotivo && (
              <div className="bg-atrasado-claro border border-atrasado/20 rounded-lg px-4 py-3" data-progresso-cancelada>
                <p className="font-semibold text-atrasado-texto">Admissão cancelada</p>
                <p className="text-ink">{progresso.admissao.cancelamentoMotivo}</p>
                <p className="text-xs text-ink-muted">
                  {progresso.admissao.canceladaPor && <>Por {progresso.admissao.canceladaPor} · </>}
                  {progresso.admissao.canceladaEm && formatarData(progresso.admissao.canceladaEm, "dd/MM/yyyy HH:mm")}
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );

  if (variante === "botoes") {
    return (
      <div className="flex flex-wrap gap-2" data-acoes-admissao="botoes">
        {temLink && (
          <Button type="button" onClick={enviar} loading={ocupado === "enviar"} data-acao-enviar>
            <Send className="w-4 h-4" /> {admissao.envios > 0 ? "Reenviar o link" : "Enviar o link"}
          </Button>
        )}
        {temLink && (
          <Button type="button" variant="secondary" onClick={copiar} data-acao-copiar><Copy className="w-4 h-4" /> Copiar o link</Button>
        )}
        <Button type="button" variant="secondary" onClick={verProgresso} loading={ocupado === "progresso"} data-acao-progresso>
          <Eye className="w-4 h-4" /> Ver o progresso
        </Button>
        {temEntregaAgora && (
          <>
            <a href={`${baseEntrega}/ficha`} className={BOTAO_LINK} data-acao-ficha>
              <FileText className="w-4 h-4" /> Baixar a ficha (PDF)
            </a>
            <a href={`${baseEntrega}/documentos`} className={BOTAO_LINK} data-acao-pacote>
              <FolderDown className="w-4 h-4" /> Baixar os documentos (zip)
            </a>
          </>
        )}
        {podeContador && (
          <Button type="button" variant="secondary" onClick={contador} loading={ocupado === "contador"} data-acao-contador>
            <FileSignature className="w-4 h-4" /> Enviado ao contador
          </Button>
        )}
        {podeAdmitir && (
          <Button type="button" variant="secondary" onClick={admitir} loading={ocupado === "admitir"} data-acao-admitir>
            <UserCheck className="w-4 h-4" /> Admitir
          </Button>
        )}
        {podeIr(s, "EXPIRADA") && (
          <Button type="button" variant="secondary" onClick={invalidar} loading={ocupado === "invalidar"} data-acao-invalidar>
            <Link2Off className="w-4 h-4" /> Invalidar o link
          </Button>
        )}
        {podeCancelarAgora && (
          <Button type="button" variant="secondary" onClick={() => setCancelando(true)} data-acao-cancelar>
            <Ban className="w-4 h-4" /> Cancelar a admissão
          </Button>
        )}
        {dialogos}
      </div>
    );
  }

  return (
    <>
      <MenuAcoes ocupado={!!ocupado} rotulo={`Ações da admissão de ${admissao.colaborador.nome}`}>
        {(fechar) => (
          <>
            {temLink && (
              <>
                <ItemMenu id="enviar" icone={Send} onClick={() => { fechar(); enviar(); }}>
                  {admissao.envios > 0 ? "Reenviar o link" : "Enviar o link"}
                </ItemMenu>
                <ItemMenu id="copiar" icone={Copy} onClick={() => { fechar(); copiar(); }}>Copiar o link</ItemMenu>
              </>
            )}
            <ItemMenu id="progresso" icone={Eye} onClick={() => { fechar(); verProgresso(); }}>Ver o progresso</ItemMenu>
            {abreFicha && <ItemMenu id="editar" icone={Pencil} href={fichaHref}>Editar os dados</ItemMenu>}
            {temEntregaAgora && (
              <>
                <SeparadorMenu />
                <ItemMenu id="ficha-pdf" icone={FileText} href={`${baseEntrega}/ficha`} novaAba>Baixar a ficha (PDF)</ItemMenu>
                <ItemMenu id="pacote" icone={FolderDown} href={`${baseEntrega}/documentos`} novaAba>Baixar os documentos (zip)</ItemMenu>
                <ItemMenu id="contrato-pdf" icone={FileSignature} href={`${baseEntrega}/contrato`} novaAba>Baixar o contrato (PDF)</ItemMenu>
              </>
            )}
            {(podeContador || podeAdmitir) && <SeparadorMenu />}
            {podeContador && <ItemMenu id="contador" icone={FileSignature} onClick={() => { fechar(); contador(); }}>Enviado ao contador</ItemMenu>}
            {podeAdmitir && <ItemMenu id="admitir" icone={UserCheck} onClick={() => { fechar(); admitir(); }}>Admitir</ItemMenu>}
            {(podeIr(s, "EXPIRADA") || podeCancelarAgora) && <SeparadorMenu />}
            {podeIr(s, "EXPIRADA") && <ItemMenu id="invalidar" icone={Link2Off} onClick={() => { fechar(); invalidar(); }}>Invalidar o link</ItemMenu>}
            {podeCancelarAgora && <ItemMenu id="cancelar" icone={Ban} perigo onClick={() => { fechar(); setCancelando(true); }}>Cancelar a admissão</ItemMenu>}
          </>
        )}
      </MenuAcoes>
      {dialogos}
    </>
  );
}
