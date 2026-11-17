"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Eye, FolderDown, Link2, Link2Off, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ItemMenu, MenuAcoes, SeparadorMenu } from "@/components/ui/menu-acoes";
import { toast, confirmar } from "@/components/ui/avisos";
import { VALIDADE_PADRAO_DIAS, fraseEmailNaoSaiu } from "@/lib/documentacao/pacote";
import { baixarZipDoEnvio } from "@/lib/documentacao/baixar-cliente";
import type { EnvioDaLista } from "@/lib/documentacao/pacote-server";
import { CamposEmail, SeletorValidade, type DestinoEmail } from "@/components/documentacao/campos-email";
import { DetalheEnvio } from "@/components/documentacao/detalhe-envio";

const linkDo = (caminho: string) => `${typeof window === "undefined" ? "" : window.location.origin}${caminho}`;

/**
 * As ações de um envio no histórico: ver o que foi e a linha do tempo, copiar o link, baixar o
 * zip, mandar o e-mail de novo, gerar um link novo e revogar.
 *
 * Cada item só aparece quando a rota aceitaria (copiar e revogar pedem link ativo; gerar pede que
 * não haja um), e o servidor confere de novo. Quando ele recusa, a razão dele é a que aparece — e a
 * tela não finge que deu certo.
 */
export function AcoesEnvio({ envio }: { envio: EnvioDaLista }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [vendo, setVendo] = useState(false);
  const [email, setEmail] = useState<DestinoEmail | null>(null);
  const [gerando, setGerando] = useState(false);
  const [dias, setDias] = useState<number>(VALIDADE_PADRAO_DIAS);
  const [erro, setErro] = useState("");

  const ativo = envio.link === "ATIVO";

  const chamar = async (acao: string, caminho: string, corpo?: unknown) => {
    setOcupado(acao); setErro("");
    try {
      const res = await fetch(`/api/documentacao/envios/${envio.id}${caminho}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo ?? {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { const msg = data?.erro ?? "Não foi possível concluir a ação."; setErro(msg); toast(msg, "erro"); return null; }
      router.refresh();
      return data;
    } catch {
      toast("Erro de conexão. Tente de novo.", "erro");
      return null;
    } finally { setOcupado(null); }
  };

  async function copiar() {
    if (!envio.caminho) return;
    try { await navigator.clipboard.writeText(linkDo(envio.caminho)); toast("Link copiado."); }
    catch { toast("Não foi possível copiar. Abra os detalhes do envio.", "erro"); }
  }

  async function baixar() {
    setOcupado("zip");
    const r = await baixarZipDoEnvio(envio.id);
    setOcupado(null);
    if (!r.ok) toast(r.erro, "erro");
    else router.refresh();
  }

  async function revogar() {
    const ok = await confirmar({
      titulo: "Revogar o link?",
      mensagem: `O link de ${envio.clienteNome} para de abrir na hora. O envio continua no histórico.`,
      confirmarTexto: "Revogar o link", perigo: true,
    });
    if (!ok) return;
    if (await chamar("revogar", "/revogar")) toast("Link revogado.");
  }

  /** Abre o diálogo do e-mail já com os contatos do cadastro do cliente. */
  async function abrirEmail() {
    setErro("");
    let sugerido = { para: [] as string[], cc: [] as string[] };
    if (envio.clienteId) {
      const r = await fetch(`/api/documentacao/sugestoes?clienteId=${encodeURIComponent(envio.clienteId)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (r?.email) sugerido = r.email;
    }
    setEmail({ ...sugerido, copiaParaMim: false });
  }

  async function mandarEmail() {
    if (!email) return;
    const r = await chamar("email", "/email", { para: email.para, cc: email.cc, copiaParaMim: email.copiaParaMim, validadeDias: dias });
    if (!r) return;
    if (r.email?.ok) { toast(`E-mail enviado para ${r.email.para.join(", ")}.`); setEmail(null); }
    else { const msg = fraseEmailNaoSaiu(r.email?.erro); setErro(msg); toast(msg, "erro"); }
  }

  async function gerarLink() {
    const r = await chamar("link", "/link", { validadeDias: dias });
    if (!r) return;
    setGerando(false);
    if (r.caminho) {
      try { await navigator.clipboard.writeText(linkDo(r.caminho)); toast("Link gerado e copiado."); }
      catch { toast("Link gerado."); }
    }
  }

  return (
    <>
      <MenuAcoes ocupado={!!ocupado} rotulo={`Ações do envio para ${envio.clienteNome}`}>
        {(fechar) => (
          <>
            <ItemMenu id="ver" icone={Eye} onClick={() => { fechar(); setVendo(true); }}>Ver o envio e a linha do tempo</ItemMenu>
            {ativo && <ItemMenu id="copiar-link" icone={Copy} onClick={() => { fechar(); void copiar(); }}>Copiar o link</ItemMenu>}
            <ItemMenu id="baixar-zip" icone={FolderDown} onClick={() => { fechar(); void baixar(); }}>Baixar o zip</ItemMenu>
            <ItemMenu
              id="enviar-email" icone={Mail} onClick={() => { fechar(); void abrirEmail(); }}
              desabilitado={!envio.clienteId} motivo={!envio.clienteId ? "O cliente deste envio não existe mais." : null}
            >
              {envio.vias.includes("EMAIL") ? "Enviar o e-mail de novo" : "Enviar por e-mail"}
            </ItemMenu>
            {!ativo && <ItemMenu id="gerar-link" icone={Link2} onClick={() => { fechar(); setErro(""); setGerando(true); }}>Gerar um link novo</ItemMenu>}
            {ativo && (
              <>
                <SeparadorMenu />
                <ItemMenu id="revogar" icone={Link2Off} perigo onClick={() => { fechar(); void revogar(); }}>Revogar o link</ItemMenu>
              </>
            )}
          </>
        )}
      </MenuAcoes>

      <DetalheEnvio envioId={vendo ? envio.id : null} aberto={vendo} onFechar={() => setVendo(false)} />

      <Modal aberto={!!email} onFechar={() => setEmail(null)} titulo={`Enviar para ${envio.clienteNome}`}>
        {email && (
          <div className="space-y-4" data-dialogo-email>
            <p className="text-sm text-ink-muted">
              O e-mail leva o link para os arquivos, não os anexos.
              {!ativo && " O link deste envio não está ativo: um link novo é gerado junto."}
            </p>
            {erro && <p role="alert" className="text-sm bg-atrasado-claro border border-atrasado/20 text-atrasado-texto rounded-lg px-3 py-2" data-erro-acao>{erro}</p>}
            <CamposEmail valor={email} onValor={setEmail} desabilitado={ocupado === "email"} />
            {!ativo && <SeletorValidade valor={dias} onValor={setDias} desabilitado={ocupado === "email"} />}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setEmail(null)}>Cancelar</Button>
              <Button type="button" loading={ocupado === "email"} disabled={!email.para.length} onClick={mandarEmail} data-confirmar-email>
                <Mail className="w-4 h-4" /> Enviar
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal aberto={gerando} onFechar={() => setGerando(false)} titulo="Gerar um link novo" tamanho="sm">
        <div className="space-y-4" data-dialogo-link>
          <p className="text-sm text-ink-muted">O link anterior não volta a valer: nasce um endereço novo para mandar ao cliente.</p>
          {erro && <p role="alert" className="text-sm bg-atrasado-claro border border-atrasado/20 text-atrasado-texto rounded-lg px-3 py-2" data-erro-acao>{erro}</p>}
          <SeletorValidade valor={dias} onValor={setDias} desabilitado={ocupado === "link"} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setGerando(false)}>Cancelar</Button>
            <Button type="button" loading={ocupado === "link"} onClick={gerarLink} data-confirmar-link>
              <Link2 className="w-4 h-4" /> Gerar o link
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
