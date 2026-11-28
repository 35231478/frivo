"use client";

import { marcarFormularioSalvo } from "@/lib/ui/sair-sem-salvar";
import { useAvisoSairSemSalvar } from "@/components/ui/proteger-saida";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/avisos";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Tabs } from "@/components/ui/tabs";
import { ErrosDoFormulario, ResumoDeErros, useErrosDoFormulario } from "@/components/ui/formulario-erros";
import { validarFormato } from "@/lib/forms/erros";
import { formatarDataHora } from "@/lib/utils";
import { problemaSenha } from "@/lib/acesso/senha";
import { RequisitosSenha } from "@/components/auth/requisitos-senha";
import { Camera, MonitorSmartphone } from "lucide-react";
import { NotificacoesAparelho } from "@/components/push/notificacoes-aparelho";
import { MinhasComissoes } from "@/components/perfil/minhas-comissoes";
import { abaInicialDoPerfil, abasDoPerfil, alteracoesDoPerfil, linhaDaConta, type AbaPerfil } from "@/lib/perfil/abas";

interface Initial {
  nome: string;
  email: string;
  telefone?: string | null;
  avatar: string | null;
  empresaNome: string;
  perfilNome: string | null;
  cargo: string;
  /** Último acesso registrado no login (Segurança › Sessões) */
  ultimoAcesso?: string | null;
}

// Redimensiona a imagem p/ no máx 256px e exporta JPEG leve (data URL)
function redimensionar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("img"));
      img.onload = () => {
        const max = 256;
        let { width, height } = img;
        if (width > height && width > max) { height = (height * max) / width; width = max; }
        else if (height >= width && height > max) { width = (width * max) / height; height = max; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("ctx"));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** Um bloco da tela: título, uma linha do que é, e o conteúdo (o mesmo cartão das telas de Configurações). */
function Bloco({ titulo, descricao, children, rodape, ...dados }: {
  titulo: string; descricao?: string; children: React.ReactNode; rodape?: React.ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <section className="card overflow-hidden" {...dados}>
      <div className="px-5 pt-5">
        <h2 className="text-sm font-semibold text-ink">{titulo}</h2>
        {descricao && <p className="text-xs text-ink-muted mt-0.5">{descricao}</p>}
      </div>
      <div className="px-5 py-4 space-y-4">{children}</div>
      {rodape && <div className="flex justify-end gap-2 px-5 py-3 border-t border-surface-border bg-surface-alt/40">{rodape}</div>}
    </section>
  );
}

/**
 * "Meu perfil" — no painel (/perfil) e no app do técnico (Meus dados). Um cabeçalho (foto, nome, e-mail e o
 * perfil de acesso UMA vez) e três abas: Dados (foto, nome, e-mail, telefone), Segurança (senha e sessões) e
 * Preferências (as notificações deste aparelho; só existe quando o push está ligado). As regras moram em
 * lib/perfil/abas.
 */
export function PerfilClient({ initial, onAvatar, emailSomenteLeitura = false, notificacoes = false, abaNaUrl = false, abaPedida, semComissoes = false }: {
  initial: Initial;
  /** Foto nova salva (o app do técnico atualiza o topo na hora) */
  onAvatar?: (avatar: string) => void;
  /**
   * App do técnico: o e-mail de login só aparece — não dá para editar (o vínculo do técnico com as OS
   * é por esse e-mail; quem troca é o escritório, na ficha do colaborador). No painel, editável.
   */
  emailSomenteLeitura?: boolean;
  /** Aba "Preferências" (push com o app fechado): só no painel, e só com o push ligado no servidor */
  notificacoes?: boolean;
  /** Painel: a aba acompanha a URL (?aba=), para o refresh e os links voltarem na mesma aba */
  abaNaUrl?: boolean;
  abaPedida?: string | null;
  /** App do técnico: as comissões têm a seção própria no Perfil do app (aqui, dentro de "Meus dados", não repete) */
  semComissoes?: boolean;
}) {
  const router = useRouter();
  const { update } = useSession();
  // COM-1: a aba "Comissões" só aparece quando a empresa usa comissão (o servidor diz; nada de comissão sem regra)
  const [comissoes, setComissoes] = useState(false);
  const abas = abasDoPerfil({ notificacoes, comissoes });
  const [aba, setAba] = useState<AbaPerfil>(() => abaInicialDoPerfil(abaPedida, abas));
  // ERRO NO CAMPO: cada recusa no campo dela; a da foto (não é campo) na faixa. Cada aba valida só o que é dela.
  const erros = useErrosDoFormulario();
  useEffect(() => {
    if (semComissoes) return;
    let vivo = true;
    fetch("/api/perfil/comissoes?so=ativo").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!vivo || !d?.ativo) return;
      setComissoes(true);
      if (abaPedida === "comissoes") setAba("comissoes");
    }).catch(() => {});
    return () => { vivo = false; };
  }, [abaPedida, semComissoes]);

  function trocarAba(id: string) {
    const nova = abaInicialDoPerfil(id, abas);
    setAba(nova); erros.limparTudo();
    if (abaNaUrl) window.history.replaceState(null, "", nova === "dados" ? window.location.pathname : `?aba=${nova}`);
  }

  // ── Foto ──
  const [avatar, setAvatar] = useState<string | null>(initial.avatar);
  const [preview, setPreview] = useState<string | null>(null); // imagem redimensionada pendente
  const fotoRef = useRef<HTMLInputElement>(null);

  async function onFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fotoRef.current) fotoRef.current.value = "";
    if (!file) return;
    erros.limparTudo();
    const falhaFoto = (m: string) => { erros.definirGeral(m); erros.focar(); };
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { falhaFoto("Use uma imagem JPG ou PNG."); return; }
    if (file.size > 2 * 1024 * 1024) { falhaFoto("Imagem muito grande. Máximo 2 MB."); return; }
    // A foto se salva na aba Dados (o "Salvar" é dela): escolhida de outra aba, a tela vai para Dados
    if (aba !== "dados") trocarAba("dados");
    try { setPreview(await redimensionar(file)); }
    catch { falhaFoto("Não foi possível processar a imagem."); }
  }

  async function enviarFoto(): Promise<boolean> {
    const res = await fetch("/api/perfil/avatar", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imagem: preview }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) { erros.definirGeral(data?.erro ?? "Erro ao enviar foto."); erros.focar(); return false; }
    setAvatar(data.avatar);
    onAvatar?.(data.avatar);
    setPreview(null);
    return true;
  }

  // ── Dados ──
  const [base, setBase] = useState({ nome: initial.nome, email: initial.email, telefone: initial.telefone ?? "" });
  const [nome, setNome] = useState(initial.nome);
  const [email, setEmail] = useState(initial.email);
  const [telefone, setTelefone] = useState(initial.telefone ?? "");
  const [confirmacaoEmail, setConfirmacaoEmail] = useState("");
  const [senhaAtualEmail, setSenhaAtualEmail] = useState("");
  const [salvandoDados, setSalvandoDados] = useState(false);
  const emailMudou = !emailSomenteLeitura && email.trim().toLowerCase() !== base.email.toLowerCase();
  const corpo = alteracoesDoPerfil(base, { nome, email, telefone, confirmacaoEmail, senhaAtual: senhaAtualEmail }, { emailEditavel: !emailSomenteLeitura });
  const temAlteracao = !!corpo || !!preview;

  async function salvarDados() {
    // Todos os campos de uma vez (cada um com a sua mensagem); o formato que já acusou ao sair continua valendo
    const campos: Record<string, string | null> = {
      nome: nome.trim() ? null : "Informe o nome completo.",
      telefone: validarFormato("telefone", telefone),
      email: emailMudou ? validarFormato("email", email) : null,
      confirmacaoEmail: emailMudou && confirmacaoEmail.trim().toLowerCase() !== email.trim().toLowerCase() ? "A confirmação de e-mail não coincide." : null,
      senhaAtualEmail: emailMudou && !senhaAtualEmail ? "Informe a senha atual para trocar o e-mail de login." : null,
    };
    if (!erros.validar(Object.fromEntries(Object.entries(campos).filter(([, v]) => v)) as Record<string, string>)) return;
    setSalvandoDados(true);
    try {
      // A foto e os dados no mesmo "Salvar": primeiro a foto (se houver), depois o que mudou nos campos
      if (preview && !(await enviarFoto())) return;
      if (corpo) {
        const res = await fetch("/api/perfil", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
        const data = await res.json().catch(() => null);
        // Na aba Dados, a "senha atual" da API é o campo da troca de e-mail
        if (!res.ok) {
          const { senhaAtual: s, ...outros } = (data?.campos ?? {}) as Record<string, string>;
          erros.erroDaApi({ ...data, campos: s ? { ...outros, senhaAtualEmail: s } : outros }, "Erro ao salvar.");
          return;
        }
        setBase({ nome: data.nome, email: data.email, telefone: data.telefone ?? "" });
        setEmail(data.email);
        setConfirmacaoEmail(""); setSenhaAtualEmail("");
        await update({ name: data.nome, email: data.email }); // atualiza o JWT (menu e topo)
      }
      toast("Dados salvos.");
      marcarFormularioSalvo();
      router.refresh(); // reflete no menu e no topo (a foto vem do banco no layout)
    } catch { erros.definirGeral("Erro de conexão."); erros.focar(); }
    finally { setSalvandoDados(false); }
  }

  function descartarDados() {
    setNome(base.nome); setEmail(base.email); setTelefone(base.telefone);
    setConfirmacaoEmail(""); setSenhaAtualEmail(""); setPreview(null); erros.limparTudo();
    // Descartou: nada a salvar, sair não pergunta mais
    marcarFormularioSalvo();
  }

  // ── Senha ──
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [salvandoSenha, setSalvandoSenha] = useState(false);

  async function salvarSenha() {
    const problema = problemaSenha(novaSenha);
    // A mesma regra do servidor, dita antes de enviar — cada recusa no campo dela
    if (!erros.validar(!senhaAtual ? { senhaAtual: "Informe a senha atual." }
      : problema ? { novaSenha: problema }
      : novaSenha !== confirmar ? { confirmar: "A confirmação da nova senha não coincide." }
      : novaSenha === senhaAtual ? { novaSenha: "A nova senha precisa ser diferente da atual." } : {})) return;
    setSalvandoSenha(true);
    try {
      const res = await fetch("/api/perfil/senha", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senhaAtual, novaSenha, confirmar }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { erros.erroDaApi(data, "Erro ao alterar senha."); return; }
      setSenhaAtual(""); setNovaSenha(""); setConfirmar("");
      toast("Senha alterada. As outras sessões com a senha antiga foram encerradas.");
      marcarFormularioSalvo();
    } catch { erros.definirGeral("Erro de conexão."); erros.focar(); }
    finally { setSalvandoSenha(false); }
  }

  // Sair sem salvar (lib/ui/sair-sem-salvar): o aviso de toda tela de edição
  const raizRef = useRef<HTMLDivElement>(null);
  useAvisoSairSemSalvar(raizRef);
  // O erro é de uma aba: trocar de aba limpa (já feito em trocarAba)

  const iniciais = nome?.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase() || "??";
  const foto = preview ?? avatar;

  return (
    <div ref={raizRef} className="max-w-4xl mx-auto space-y-6" data-perfil>
      {/* Cabeçalho: quem é (o perfil de acesso aparece uma vez só) */}
      <header className="flex items-center gap-4" data-topo-perfil>
        <button
          type="button" onClick={() => fotoRef.current?.click()} data-trocar-foto
          className="relative shrink-0 w-16 h-16 rounded-full group focus:outline-none focus-visible:ring-2 focus-visible:ring-acento"
          aria-label="Trocar foto de perfil" title="Trocar foto"
        >
          {foto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={foto} alt="Foto de perfil" className="w-16 h-16 rounded-full object-cover border border-surface-border" />
          ) : (
            <span className="w-16 h-16 rounded-full bg-acento-claro flex items-center justify-center text-acento-hover text-xl font-bold">{iniciais}</span>
          )}
          <span className="absolute -bottom-0.5 -right-0.5 w-7 h-7 rounded-full bg-white border border-surface-border shadow-sm flex items-center justify-center text-ink-muted group-hover:text-acento">
            <Camera className="w-3.5 h-3.5" aria-hidden />
          </span>
        </button>
        <input ref={fotoRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onFoto} className="hidden" data-arquivo-foto />
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight truncate">{base.nome || "Meu perfil"}</h1>
          <p className="text-sm text-ink-muted truncate">{base.email}</p>
          <p className="text-xs text-ink-subtle mt-0.5 truncate" data-linha-conta>{linhaDaConta(initial.perfilNome, initial.cargo, initial.empresaNome)}</p>
        </div>
      </header>

      <ErrosDoFormulario valor={erros}>
      <div ref={erros.ref}>
      <Tabs tabs={abas} active={aba} onChange={trocarAba}>
        {(ativa) => (
          <div className="space-y-5">
            {/* A faixa do topo é o resumo; o erro mora no campo (ERRO NO CAMPO) */}
            {erros.temErros && <div data-erro-perfil><ResumoDeErros /></div>}

            {ativa === "dados" && (
              <Bloco
                titulo="Dados pessoais" descricao="Nome, contato e foto que aparecem para a equipe." data-bloco="dados"
                rodape={(
                  <>
                    {temAlteracao && <Button type="button" variant="ghost" onClick={descartarDados}>Descartar</Button>}
                    <Button type="button" variant="primary" loading={salvandoDados} disabled={!temAlteracao} onClick={salvarDados} data-salvar-dados>
                      Salvar alterações
                    </Button>
                  </>
                )}
              >
                <div className="flex items-center gap-3" data-foto>
                  {foto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={foto} alt="" className="w-12 h-12 rounded-full object-cover border border-surface-border" />
                  ) : (
                    <span className="w-12 h-12 rounded-full bg-acento-claro flex items-center justify-center text-acento-hover text-sm font-bold">{iniciais}</span>
                  )}
                  <Button type="button" variant="secondary" size="sm" onClick={() => fotoRef.current?.click()} data-alterar-foto>
                    <Camera className="w-4 h-4" /> {foto ? "Trocar foto" : "Enviar foto"}
                  </Button>
                  <span className="text-xs text-ink-muted">{preview ? "Foto nova: salve para confirmar." : "JPG ou PNG, até 2 MB."}</span>
                </div>
                <FormGrid>
                  <FormField label="Nome completo" required name="nome">
                    <Input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
                  </FormField>
                  <FormField label="Telefone" name="telefone" formato="telefone">
                    <PhoneInput value={telefone} onChange={(e) => setTelefone(e.target.value)} data-telefone />
                  </FormField>
                </FormGrid>
                <FormGrid>
                  {emailSomenteLeitura ? (
                    <FormField label="E-mail de login" hint="A troca do e-mail de login é feita pelo escritório.">
                      <Input type="email" value={initial.email} readOnly aria-readonly="true" data-email-somente-leitura className="bg-surface-linha text-ink-muted" />
                    </FormField>
                  ) : (
                    <FormField label="E-mail de login" required name="email" formato="email">
                      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                    </FormField>
                  )}
                </FormGrid>
                {emailMudou && (
                  <FormGrid>
                    <FormField label="Confirmar e-mail" required hint="Repita o novo e-mail" name="confirmacaoEmail" formato="email">
                      <Input type="email" value={confirmacaoEmail} onChange={(e) => setConfirmacaoEmail(e.target.value)} />
                    </FormField>
                    <FormField label="Senha atual" required hint="Trocar o e-mail de login pede a senha" name="senhaAtualEmail">
                      <Input type="password" value={senhaAtualEmail} onChange={(e) => setSenhaAtualEmail(e.target.value)} autoComplete="current-password" />
                    </FormField>
                  </FormGrid>
                )}
              </Bloco>
            )}

            {ativa === "seguranca" && (
              <>
                <Bloco
                  titulo="Senha" descricao="Trocar a senha encerra as sessões abertas em outros aparelhos." data-bloco="senha"
                  rodape={<Button type="button" variant="primary" loading={salvandoSenha} onClick={salvarSenha} data-trocar-senha>Trocar senha</Button>}
                >
                  <FormGrid>
                    <FormField label="Senha atual" required name="senhaAtual">
                      <Input type="password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} autoComplete="current-password" />
                    </FormField>
                  </FormGrid>
                  <FormGrid>
                    <FormField label="Nova senha" required name="novaSenha">
                      <Input type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} autoComplete="new-password" />
                      <RequisitosSenha senha={novaSenha} className="pt-1.5" />
                    </FormField>
                    <FormField label="Confirmar nova senha" required name="confirmar">
                      <Input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" />
                    </FormField>
                  </FormGrid>
                </Bloco>
                <Bloco titulo="Sessões e aparelhos" descricao="Onde esta conta está conectada." data-bloco="sessoes">
                  <div className="flex items-start gap-3">
                    <MonitorSmartphone className="w-5 h-5 text-ink-muted shrink-0 mt-0.5" aria-hidden />
                    <div className="text-sm">
                      <p className="text-ink">Este aparelho está conectado.</p>
                      {initial.ultimoAcesso && <p className="text-xs text-ink-muted mt-0.5" data-ultimo-acesso>Último acesso: {formatarDataHora(initial.ultimoAcesso)}</p>}
                      <p className="text-xs text-ink-muted mt-1">Para desconectar os outros aparelhos, troque a senha acima.</p>
                    </div>
                  </div>
                </Bloco>
              </>
            )}

            {ativa === "comissoes" && comissoes && <MinhasComissoes />}

            {ativa === "preferencias" && notificacoes && (
              <Bloco titulo="Notificações" descricao="Avisos deste aparelho, mesmo com o Frivo fechado." data-bloco="notificacoes">
                <NotificacoesAparelho modo="escritorio" />
              </Bloco>
            )}
          </div>
        )}
      </Tabs>
      </div>
      </ErrosDoFormulario>
    </div>
  );
}
