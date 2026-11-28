"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { ErrosDoFormulario, ResumoDeErros, useErrosDoFormulario } from "@/components/ui/formulario-erros";
import { Drawer } from "@/components/ui/drawer";
import { Modal } from "@/components/ui/modal";
import { salvarCadastro, type EditorCadastroProps } from "@/components/cadastros/cadastro-padrao";
import { SeletorCadastro, useCadastro } from "@/components/cadastros/seletor-cadastro";

export interface ResultadoConvite { enviadoPorEmail: boolean; link?: string; erroEmail?: string }

/** Mostra o resultado do convite: enviado por e-mail, ou o LINK para repassar (nunca uma senha). */
export function AvisoConvite({ convite, nome, onFechar }: { convite: ResultadoConvite | null; nome: string; onFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Modal aberto={!!convite} onFechar={onFechar} titulo="Convite de acesso" tamanho="sm">
      {convite?.enviadoPorEmail ? (
        <p className="text-sm text-ink flex items-start gap-2"><Mail className="w-4 h-4 mt-0.5 text-ok-texto shrink-0" /> Enviamos para {nome} um e-mail com o link para definir a senha. O link vale por 72 horas e só pode ser usado uma vez.</p>
      ) : convite ? (
        <div className="space-y-3" data-convite-link>
          <p className="text-sm text-ink">Não deu para enviar o e-mail{convite.erroEmail ? ` (${convite.erroEmail.replace(/\.$/, "")})` : ""}. Repasse este link para {nome} definir a própria senha — ele vale por 72 horas e só pode ser usado uma vez:</p>
          <div className="flex gap-2">
            <Input readOnly value={convite.link ?? ""} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Link do convite" />
            <Button type="button" variant="secondary" onClick={async () => { await navigator.clipboard?.writeText(convite.link ?? ""); setCopiado(true); }}>
              <Copy className="w-4 h-4" /> {copiado ? "Copiado" : "Copiar"}
            </Button>
          </div>
          <p className="text-xs text-ink-muted">Nenhuma senha é mostrada nem enviada: quem recebe o link é que escolhe a senha.</p>
        </div>
      ) : null}
    </Modal>
  );
}

/**
 * Editor de usuário (CadastroPadrao › usuarios): nome, e-mail (só ao criar — é o login) e perfil de
 * acesso. A senha NÃO é definida aqui: ao criar, o sistema envia o convite. As travas (o próprio
 * perfil, perfil com mais acesso, último admin…) ficam no servidor.
 */
export function criarEditorUsuario(usuarioAtualId: string) {
  return function EditorUsuario({ item, aberto, onFechar, onSalvo }: EditorCadastroProps) {
    const { itens: perfis } = useCadastro("perfis-acesso");
    const [nome, setNome] = useState("");
    const [email, setEmail] = useState("");
    const [perfilAcessoId, setPerfilAcessoId] = useState("");
    // ERRO NO CAMPO: o e-mail de login já usado (ou inválido) fica no campo do e-mail, com foco nele
    const erros = useErrosDoFormulario();
    const [salvando, setSalvando] = useState(false);
    const [convite, setConvite] = useState<ResultadoConvite | null>(null);
    const [salvo, setSalvo] = useState<any>(null);

    useEffect(() => {
      if (!aberto) return;
      erros.limparTudo(); setNome(item?.nome ?? ""); setEmail(item?.email ?? ""); setPerfilAcessoId(item?.perfilAcessoId ?? "");
    }, [aberto, item]);

    const proprio = item?.id === usuarioAtualId;
    const admin = item?.role === "ADMIN";

    async function salvar() {
      const faltando: Record<string, string> = {};
      if (!nome.trim()) faltando.nome = "Informe o nome.";
      if (!item && !email.trim()) faltando.email = "Informe o e-mail (é o login).";
      if (!erros.validar(faltando)) return;
      const corpo: Record<string, unknown> = item
        ? { nome, ...(!proprio && !admin && { perfilAcessoId: perfilAcessoId || null }) }
        : { nome, email, perfilAcessoId: perfilAcessoId || null };
      setSalvando(true);
      const r = await salvarCadastro("usuarios", item?.id ?? null, corpo);
      setSalvando(false);
      if (!r.ok) { erros.erroDaApi(r); return; }
      if (!item && r.item.convite) { setSalvo(r.item); setConvite(r.item.convite); return; }
      onSalvo(r.item);
    }

    return (
      <>
        <Drawer
          aberto={aberto && !convite} onFechar={onFechar}
          titulo={item ? `Editar ${item.nome}` : "Novo usuário"}
          rodape={<>
            <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
            <Button type="button" loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> {item ? "Salvar" : "Criar e enviar convite"}</Button>
          </>}
        >
          <ErrosDoFormulario valor={erros}>
          <div className="space-y-4" ref={erros.ref}>
            <ResumoDeErros />
            <FormField label="Nome" required name="nome"><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" /></FormField>
            <FormField label="E-mail (login)" required name="email" formato="email" hint={item ? "O e-mail é o login: não muda depois de criado." : "Vai receber o convite para definir a própria senha."}>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!item} placeholder="nome@empresa.com.br" />
            </FormField>
            <FormField label="Perfil de acesso" name="perfilAcessoId" valor={perfilAcessoId} hint="Define o que a pessoa vê e faz. Sem perfil = sem acesso (só o início).">
              {admin ? (
                <p className="inline-flex items-center gap-1 text-xs font-semibold bg-atrasado-claro text-atrasado px-2 py-1 rounded-full"><ShieldCheck className="w-3.5 h-3.5" /> Administrador: acesso total</p>
              ) : proprio ? (
                <p className="text-sm text-ink-muted">{item?.perfilAcesso?.nome ?? "Sem perfil"} · ninguém altera o próprio perfil de acesso</p>
              ) : (
                <SeletorCadastro entidade="perfis-acesso" itens={perfis} valor={perfilAcessoId} vazio="Sem perfil (sem acesso)" onChange={setPerfilAcessoId} />
              )}
            </FormField>
            {!item && <p className="text-xs text-ink-muted bg-surface-alt rounded-lg px-3 py-2">A senha não é definida aqui: a pessoa recebe um link (72 h, uso único) para criar a dela.</p>}
          </div>
          </ErrosDoFormulario>
        </Drawer>
        <AvisoConvite convite={convite} nome={nome} onFechar={() => { setConvite(null); onSalvo(salvo); }} />
      </>
    );
  };
}
