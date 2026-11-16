"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Copy, Mail, Send, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { InputData } from "@/components/ui/input-data";
import { BuscaSelect } from "@/components/ui/busca-select";
import { toast } from "@/components/ui/avisos";
import { cn, formatarData } from "@/lib/utils";
import { cpfValido, digitos, formatarDocumento } from "@/lib/documento";
import { MSG_VALIDADE, VALIDADE_MAX, VALIDADE_MIN, caminhoPublicoAdmissao, validadeValida } from "@/lib/admissao/admissao";
import type { AdmissaoDoRh } from "@/lib/admissao/admissao-server";

export interface OpcaoCargo { value: string; label: string }

interface Criada {
  admissao: AdmissaoDoRh;
  url: string;
  whatsappUrl: string | null;
  emailEnviado: boolean; emailPara: string | null; erroEmail: string | null;
}

/**
 * "Nova admissão": o PRÉ-CADASTRO do RH (nome + CPF + cargo + salário) que faz nascer o convite.
 * O colaborador entra fora do quadro e só vira ativo quando a admissão termina. Depois de criar, a
 * tela oferece mandar o link na hora — e mostra o link para copiar, se o e-mail não sair.
 *
 * Com `colaboradorId`, o convite sai da ficha de quem já existe: não pede nome nem CPF de novo.
 */
export function NovaAdmissao({ cargos, colaborador, validadePadrao, rotulo = "Nova admissão", variante = "primary" }: {
  cargos: OpcaoCargo[];
  /** Convite a partir de um colaborador que já existe (a ficha dele) */
  colaborador?: { id: string; nome: string; cargoId: string | null };
  validadePadrao: number;
  rotulo?: string;
  variante?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [criada, setCriada] = useState<Criada | null>(null);
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [cargoId, setCargoId] = useState(colaborador?.cargoId ?? "");
  const [salario, setSalario] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [dataAdmissao, setDataAdmissao] = useState("");
  const [validadeDias, setValidadeDias] = useState(String(validadePadrao));

  const daFicha = !!colaborador;
  const dias = Number(validadeDias);
  const cpfOk = daFicha || cpfValido(cpf);
  const nomeOk = daFicha || nome.trim().length >= 3;
  const podeSalvar = nomeOk && cpfOk && validadeValida(dias);

  function limpar() {
    setNome(""); setCpf(""); setSalario(""); setEmail(""); setTelefone(""); setDataAdmissao("");
    setCargoId(colaborador?.cargoId ?? ""); setValidadeDias(String(validadePadrao)); setErro("");
  }

  async function criar(enviarLink: boolean) {
    setErro(""); setSalvando(true);
    try {
      const res = await fetch("/api/admissoes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(daFicha ? { colaboradorId: colaborador!.id } : { nome: nome.trim(), cpf: digitos(cpf) }),
          ...(email.trim() && { email: email.trim() }),
          ...(telefone.trim() && { telefone: telefone.trim() }),
          cargoId: cargoId || null,
          salario: salario.trim() ? Number(salario.replace(/\./g, "").replace(",", ".")) : null,
          dataAdmissao: dataAdmissao || null,
          validadeDias: dias,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data?.erro ?? "Não foi possível criar a admissão."); return; }
      const admissao = data as AdmissaoDoRh;
      router.refresh();
      if (!enviarLink) {
        setCriada({ admissao, url: `${window.location.origin}${caminhoPublicoAdmissao(admissao.token)}`, whatsappUrl: null, emailEnviado: false, emailPara: null, erroEmail: "o link ainda não foi enviado" });
        toast("Admissão criada. O link ainda não foi enviado.");
      } else {
        const envio = await fetch(`/api/admissoes/${admissao.id}/reenviar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const d = await envio.json().catch(() => ({}));
        if (!envio.ok) {
          setCriada({ admissao, url: `${window.location.origin}${caminhoPublicoAdmissao(admissao.token)}`, whatsappUrl: null, emailEnviado: false, emailPara: null, erroEmail: d?.erro ?? "falha no envio" });
          toast("Admissão criada, mas o link não foi enviado.", "erro");
        } else {
          setCriada({ admissao: d.admissao, url: d.url, whatsappUrl: d.whatsappUrl, emailEnviado: d.emailEnviado, emailPara: d.emailPara, erroEmail: d.erroEmail });
          toast(d.emailEnviado ? `Admissão criada e link enviado para ${d.emailPara}.` : "Admissão criada. Copie o link e mande pelo WhatsApp.");
        }
      }
      setAberto(false);
      limpar();
      router.refresh();
    } catch {
      setErro("Erro de conexão. Tente de novo.");
    } finally { setSalvando(false); }
  }

  async function copiar(url: string) {
    try { await navigator.clipboard.writeText(url); toast("Link copiado."); } catch { toast("Copie o link do campo acima.", "info"); }
  }

  return (
    <>
      <Button type="button" variant={variante} onClick={() => { limpar(); setAberto(true); }} data-nova-admissao>
        <UserPlus className="w-4 h-4" /> {rotulo}
      </Button>

      <Modal aberto={aberto} onFechar={() => setAberto(false)} titulo={daFicha ? "Gerar convite de admissão" : "Nova admissão"} tamanho="lg">
        <div className="p-5 space-y-4" data-form-admissao>
          <p className="text-sm text-ink-muted">
            {daFicha
              ? <>O convite é de <strong className="text-ink">{colaborador!.nome}</strong>. O resto da ficha é ele quem preenche pelo link.</>
              : "O RH define o essencial; o colaborador preenche o resto pelo link, manda os documentos e assina o contrato."}
          </p>

          {!daFicha && (
            <FormGrid>
              <FormField label="Nome completo" required error={nome && !nomeOk ? "Informe o nome completo." : undefined}>
                <Input value={nome} onChange={(e) => setNome(e.target.value)} caixa="nome" data-campo-nome placeholder="Como no documento" />
              </FormField>
              <FormField label="CPF" required error={cpf && !cpfOk ? "CPF inválido." : undefined}
                dica="É o CPF que identifica quem abre o link: o colaborador digita o dele e o sistema confere com este.">
                <Input value={cpf} onChange={(e) => setCpf(formatarDocumento(e.target.value))} inputMode="numeric" data-campo-cpf placeholder="000.000.000-00" />
              </FormField>
            </FormGrid>
          )}

          <FormGrid>
            <FormField label="Cargo">
              <BuscaSelect value={cargoId} onChange={setCargoId} options={cargos} rotulo="Cargo" placeholder="Sem cargo definido"
                atributos={{ "data-campo": "cargo" }} />
            </FormField>
            <FormField label="Salário" hint="Entra no contrato. Em branco, o contrato fica sem o valor.">
              <Input value={salario} onChange={(e) => setSalario(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" data-campo-salario placeholder="0,00" />
            </FormField>
          </FormGrid>

          <FormGrid>
            <FormField label="Data de admissão" hint="Pode definir depois, ao admitir.">
              <InputData value={dataAdmissao} onChange={setDataAdmissao} aria-label="Data de admissão" />
            </FormField>
            <FormField label="Validade do link (dias)" required error={!validadeValida(dias) ? MSG_VALIDADE : undefined}>
              <Input type="number" min={VALIDADE_MIN} max={VALIDADE_MAX} value={validadeDias}
                onChange={(e) => setValidadeDias(e.target.value)} data-campo-validade />
            </FormField>
          </FormGrid>

          {!daFicha && (
            <FormGrid>
              <FormField label="E-mail" hint="Para onde o link vai. Sem e-mail, mande pelo WhatsApp.">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} caixa="email" data-campo-email placeholder="nome@exemplo.com" />
              </FormField>
              <FormField label="Celular / WhatsApp" hint="O colaborador confirma o telefone dele no link.">
                <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode="tel" data-campo-telefone placeholder="(00) 00000-0000" />
              </FormField>
            </FormGrid>
          )}

          {erro && (
            <div className="flex items-start gap-2 bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3" data-erro-admissao>
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {erro}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setAberto(false)}>Voltar</Button>
            <Button type="button" variant="secondary" onClick={() => criar(false)} loading={salvando} disabled={!podeSalvar} data-criar-sem-enviar>
              Criar sem enviar
            </Button>
            <Button type="button" onClick={() => criar(true)} loading={salvando} disabled={!podeSalvar} data-criar-e-enviar>
              <Send className="w-4 h-4" /> Criar e enviar o link
            </Button>
          </div>
        </div>
      </Modal>

      {/* O que fazer com o link recém-criado */}
      <Modal aberto={!!criada} onFechar={() => setCriada(null)} titulo="Link da admissão" tamanho="md">
        {criada && (
          <div className="p-5 space-y-4" data-admissao-criada>
            <p className="text-sm text-ink-muted">
              Link pessoal de <strong className="text-ink">{criada.admissao.colaborador.nome}</strong>. Vale até{" "}
              {formatarData(criada.admissao.expiraEm)}.
            </p>
            <div className="flex items-center gap-2">
              <input readOnly value={criada.url} data-criada-url aria-label="Link da admissão"
                className="flex-1 bg-surface-linha border border-surface-border rounded-lg px-3 py-2 text-sm text-ink-muted" />
              <Button type="button" variant="secondary" onClick={() => copiar(criada.url)} data-criada-copiar><Copy className="w-4 h-4" /> Copiar</Button>
            </div>
            {criada.whatsappUrl && (
              <a href={criada.whatsappUrl} target="_blank" rel="noreferrer" data-criada-whatsapp
                className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold bg-ok text-white hover:bg-ok-texto">
                <Send className="w-4 h-4" /> Abrir no WhatsApp
              </a>
            )}
            <p className={cn("flex items-start gap-1.5 text-xs", criada.emailEnviado ? "text-ok-texto" : "text-atencao-texto")} data-criada-email>
              {criada.emailEnviado
                ? <><Mail className="w-3.5 h-3.5 shrink-0 mt-0.5" /> E-mail enviado para {criada.emailPara}.</>
                : <><AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> E-mail não saiu ({criada.erroEmail ?? "sem detalhe"}). Mande o link pelo WhatsApp.</>}
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
