"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { AlertCircle, Repeat } from "lucide-react";
import { SeletorCadastro } from "@/components/cadastros/seletor-cadastro";
import { toast } from "@/components/ui/avisos";
import { CampoBoleto } from "@/components/financeiro/campo-boleto";
import { lerBoleto } from "@/lib/financeiro/boleto";
import { PLANILHA } from "@/lib/planilha";
import { InputData } from "@/components/ui/input-data";
import { Dica } from "@/components/ui/dica";
import { AJUDA_REPETIR, CamposRecorrencia } from "@/components/financeiro/campos-recorrencia";
import { chaveHojeBR } from "@/lib/fuso";
import {
  AJUDA_ESCOPO, ESCOPOS, ROTULO_ESCOPO, corpoDaRecorrencia, formRecorrenciaInicial, validarRegra,
  type EscopoEdicao,
} from "@/lib/financeiro/conta-pagar-recorrencia";

/** hoje em Brasília, em partes (o início sugerido da regra sai daqui) */
function hojeBR() {
  const [ano, mes, dia] = chaveHojeBR().split("-").map(Number);
  return { ano, mes, dia };
}

export function ContaPagarForm({ initialData }: { initialData?: any }) {
  const router = useRouter();
  const isEditing = !!initialData;
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [colaboradores, setColaboradores] = useState<{ id: string; nome: string }[]>([]);

  // DESPESA RECORRENTE: na conta nova, o toggle abre a regra (frequência, vencimento, término…).
  const [recorrente, setRecorrente] = useState(false);
  const [rec, setRec] = useState(() => formRecorrenciaInicial(hojeBR()));
  // Favorecido da regra: fornecedor (o de sempre) ou colaborador (salário, pró-labore)
  const [favorecido, setFavorecido] = useState<"FORNECEDOR" | "COLABORADOR">("FORNECEDOR");
  const [tecnicoId, setTecnicoId] = useState("");
  // Editando uma conta que veio de uma regra: a pessoa escolhe o ALCANCE do ajuste
  const daRecorrencia = isEditing && !!initialData?.recorrenciaId;
  const jaPagaEmParte = Number(initialData?.valorPago ?? 0) > 0;
  const [escopo, setEscopo] = useState<EscopoEdicao>("ESTA");

  const [form, setForm] = useState({
    fornecedorId: initialData?.fornecedorId ?? "",
    descricao: initialData?.descricao ?? "",
    valorTotal: initialData?.valorTotal != null ? String(initialData.valorTotal) : "",
    dataVencimento: initialData?.dataVencimento ? String(initialData.dataVencimento).slice(0, 10) : "",
    formaPagamento: initialData?.formaPagamento ?? "",
    banco: initialData?.banco ?? "",
    pedidoCompraId: initialData?.pedidoCompraId ?? "",
    observacao: initialData?.observacao ?? "",
    categoriaId: initialData?.categoriaId ?? "",
    centroCustoId: initialData?.centroCustoId ?? "",
    boleto: initialData?.linhaDigitavel ?? "",
  });
  const upd = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  // Conta antiga cujo fornecedor (texto) não casou com nenhum cadastro: mostra o texto e pede a escolha
  const textoAntigo = isEditing && !initialData?.fornecedorId && initialData?.fornecedor ? String(initialData.fornecedor) : null;

  useEffect(() => {
    if (isEditing) return;
    fetch("/api/pedidos-compra").then((r) => r.json()).then((d) => setPedidos(Array.isArray(d) ? d : [])).catch(() => {});
  }, [isEditing]);

  // Colaboradores só quando a pessoa escolhe o favorecido colaborador (salário, pró-labore)
  useEffect(() => {
    if (!recorrente || favorecido !== "COLABORADOR" || colaboradores.length) return;
    fetch("/api/tecnicos").then((r) => r.json()).then((d) => setColaboradores(Array.isArray(d) ? d : [])).catch(() => {});
  }, [recorrente, favorecido, colaboradores.length]);

  /** Cria a REGRA (e com ela as contas do horizonte), em vez de uma conta só. */
  async function salvarRecorrencia() {
    const valor = Number(form.valorTotal);
    const corpo = { ...corpoDaRecorrencia(rec), descricao: form.descricao.trim(), valor };
    const problema = validarRegra(corpo);
    if (problema) { setErro(problema); return; }
    if (favorecido === "COLABORADOR" ? !tecnicoId : !form.fornecedorId) {
      setErro(favorecido === "COLABORADOR" ? "Escolha o colaborador." : "Escolha o fornecedor.");
      return;
    }
    setSalvando(true);
    try {
      const res = await fetch("/api/contas-pagar/recorrencias", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...corpo,
          fornecedorId: favorecido === "FORNECEDOR" ? form.fornecedorId : null,
          tecnicoId: favorecido === "COLABORADOR" ? tecnicoId : null,
          categoriaId: form.categoriaId || null,
          centroCustoId: form.centroCustoId || null,
          formaPagamento: form.formaPagamento || null,
          observacao: form.observacao || null,
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErro(e.erro ?? "Não foi possível criar a despesa recorrente."); return; }
      const criada = await res.json().catch(() => ({}));
      const n = Number(criada?.contasGeradas ?? 0);
      toast(n > 0 ? `Lançamento repetido criado: ${n} ${n === 1 ? "conta aberta" : "contas abertas"}.` : "Lançamento repetido criado.");
      router.push("/financeiro/contas-pagar");
      router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  async function salvar() {
    setErro("");
    if (!isEditing && recorrente) return salvarRecorrencia();
    if (!form.fornecedorId && !textoAntigo) { setErro("Escolha o fornecedor."); return; }
    if (!form.descricao.trim()) { setErro("Descrição é obrigatória."); return; }
    if (!form.valorTotal || Number(form.valorTotal) <= 0) { setErro("Informe um valor válido."); return; }
    if (form.boleto.replace(/\D/g, "")) { const b = lerBoleto(form.boleto); if (!b.ok) { setErro(`Boleto: ${b.erro}`); return; } }
    setSalvando(true);
    try {
      const url = isEditing ? `/api/contas-pagar/${initialData.id}` : "/api/contas-pagar";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          // Só manda o fornecedor quando há um escolhido (conta antiga sem cadastro segue com o texto)
          fornecedorId: form.fornecedorId || undefined,
          dataVencimento: form.dataVencimento || null,
          formaPagamento: form.formaPagamento || null,
          banco: form.banco || null,
          pedidoCompraId: form.pedidoCompraId || null,
          observacao: form.observacao || null,
          categoriaId: form.categoriaId || null,
          centroCustoId: form.centroCustoId || null,
          boleto: form.boleto.trim() || null,
          // Conta de despesa recorrente: o alcance do ajuste (a paga em parte muda só ela)
          ...(daRecorrencia && !jaPagaEmParte && { escopo }),
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErro(e.erro ?? "Não foi possível salvar a conta."); return; }
      // Sucesso é toast (padrão da casa); o erro de validação fica na tela
      const salva = await res.json().catch(() => ({}));
      const fim = isEditing ? "atualizada" : "criada";
      const outras = Math.max(0, Number(salva?.alcancadas ?? 0) - 1);
      const plural = outras === 1 ? "ocorrência" : "ocorrências";
      toast(outras > 0
        ? `Conta ${salva.numero} atualizada. A regra e ${outras} ${plural} em aberto acompanharam.`
        : salva?.numero ? `Conta ${salva.numero} ${fim}.` : `Conta a pagar ${fim}.`);
      router.push("/financeiro/contas-pagar");
      router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-5">
      {erro && <div className="flex items-center gap-2 bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3"><AlertCircle className="w-4 h-4 shrink-0" /> {erro}</div>}

      <div className="bg-white rounded-card shadow-card border border-surface-border p-5 sm:p-6 space-y-8">
        {/* Conta que veio de uma despesa recorrente: o alcance do ajuste é escolha, não suposição */}
        {daRecorrencia && (
          <div className="rounded-lg border border-surface-border bg-surface-alt/50 p-4 space-y-2" data-alcance-edicao>
            <p className="text-sm font-semibold text-ink flex items-center gap-1.5">
              <Repeat className="w-4 h-4 text-primary-600" /> Esta conta é de uma despesa recorrente
            </p>
            {jaPagaEmParte ? (
              <p className="text-sm text-ink-muted" data-alcance-travado>
                Já tem pagamento registrado: o ajuste vale só para este mês. A regra e as outras ocorrências não mudam.
              </p>
            ) : (
              <>
                <p className="text-sm text-ink-muted">Alcance deste ajuste:</p>
                {ESCOPOS.map((e) => (
                  <label key={e} className="flex items-start gap-2 text-sm cursor-pointer" data-escopo={e}>
                    <input type="radio" name="escopo-edicao" className="mt-1" checked={escopo === e} onChange={() => setEscopo(e)} />
                    <span className="min-w-0">
                      <span className="font-medium text-ink">{ROTULO_ESCOPO[e]}</span>
                      <span className="block text-xs text-ink-muted">{AJUDA_ESCOPO[e]}</span>
                    </span>
                  </label>
                ))}
              </>
            )}
          </div>
        )}

        <FormSection title={recorrente ? "Favorecido" : "Fornecedor"}>
          {recorrente && (
            <div className="flex flex-wrap gap-4" data-tipo-favorecido>
              {([["FORNECEDOR", "Fornecedor"], ["COLABORADOR", "Colaborador"]] as const).map(([v, l]) => (
                <label key={v} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                  <input type="radio" name="tipo-favorecido" checked={favorecido === v} onChange={() => setFavorecido(v)} />
                  {l}
                </label>
              ))}
            </div>
          )}
          {recorrente && favorecido === "COLABORADOR" ? (
            <FormField label="Colaborador" required hint="Para salário, pró-labore e reembolso fixo">
              <Select value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)} data-colaborador aria-label="Colaborador">
                <option value="">Selecione o colaborador…</option>
                {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </Select>
            </FormField>
          ) : (
          <FormField label="Fornecedor" required>
            {/* Só ativos para nova escolha; o fornecedor atual segue visível mesmo inativo (“(inativo)”) */}
            <SeletorCadastro entidade="fornecedores" valor={form.fornecedorId} vazio={textoAntigo ? "Escolha o fornecedor…" : "Selecione o fornecedor…"} editavel onChange={(v) => upd("fornecedorId", v)} />
            {textoAntigo && !form.fornecedorId && (
              <p className="text-xs text-atencao-texto mt-1" data-fornecedor-antigo>
                Fornecedor antigo: “{textoAntigo}”{initialData?.fornecedorCnpj ? ` (${initialData.fornecedorCnpj})` : ""} — sem cadastro. Escolha o fornecedor para ligar esta conta.
              </p>
            )}
            {/* Fornecedor novo? "+ Novo fornecedor…" no próprio seletor cria sem sair da tela */}
          </FormField>
          )}
          <FormGrid>
            <FormField label="Descrição" required><Input value={form.descricao} onChange={(e) => upd("descricao", e.target.value)} placeholder="Ex: Compra de peças" /></FormField>
            <FormField label="Categoria">
              {/* Só ativas para nova escolha; a categoria atual segue visível mesmo inativa */}
              <SeletorCadastro entidade="categorias-financeiras" valor={form.categoriaId} vazio="Sem categoria" editavel onChange={(v) => upd("categoriaId", v)} />
            </FormField>
          </FormGrid>
          <FormGrid>
            <FormField label="Centro de custo">
              <SeletorCadastro entidade="centros-custo" valor={form.centroCustoId} vazio="Sem centro de custo" editavel onChange={(v) => upd("centroCustoId", v)} />
            </FormField>
          </FormGrid>
        </FormSection>

        <FormSection title="Pagamento">
          <FormGrid cols={3}>
            <FormField label={recorrente ? "Valor de cada ocorrência" : "Valor total"} required
              hint={recorrente ? "Não multiplica: é o valor de cada mês" : undefined}>
              <Input type="number" step="0.01" className={PLANILHA.numero} value={form.valorTotal} onChange={(e) => upd("valorTotal", e.target.value)} placeholder="0,00" />
            </FormField>
            {/* Na recorrente o vencimento vem do dia da regra, não de uma data só */}
            {!recorrente && <FormField label="Vencimento"><InputData value={form.dataVencimento} onChange={(v) => upd("dataVencimento", v)} /></FormField>}
            <FormField label="Forma de pagamento">
              <Select value={form.formaPagamento} onChange={(e) => upd("formaPagamento", e.target.value)}>
                <option value="">Selecione…</option>
                {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </FormField>
          </FormGrid>
          {!recorrente && (
            <FormGrid>
              <FormField label="Banco do fornecedor"><Input value={form.banco} onChange={(e) => upd("banco", e.target.value)} /></FormField>
              {!isEditing && (
                <FormField label="Vincular a pedido de compra" hint="Opcional">
                  <Select value={form.pedidoCompraId} onChange={(e) => upd("pedidoCompraId", e.target.value)}>
                    <option value="">Nenhum</option>
                    {pedidos.map((p) => <option key={p.id} value={p.id}>{p.numero}</option>)}
                  </Select>
                </FormField>
              )}
            </FormGrid>
          )}
          {/* Boleto é de UMA conta: cada ocorrência cola o seu quando o boleto chega */}
          {!recorrente && (
            <CampoBoleto valor={form.boleto} onChange={(v) => upd("boleto", v)} name="boleto"
              valorParcela={Number(form.valorTotal) > 0 ? Number(form.valorTotal) : null} vencimentoParcela={form.dataVencimento || null} />
          )}
          <FormField label="Observação"><Textarea value={form.observacao} onChange={(e) => upd("observacao", e.target.value)} rows={2} /></FormField>
        </FormSection>

        {/* A REPETIÇÃO mora dentro da conta: ligando aqui, a conta passa a se repetir sozinha.
            Só na conta nova — a que já existe se repete pela ficha dela ("Tornar recorrente"). */}
        {!isEditing && (
          <FormSection title="Repetição">
            <label className="flex items-center gap-2 cursor-pointer" data-toggle-recorrente>
              <input type="checkbox" className="shrink-0" checked={recorrente} onChange={(e) => setRecorrente(e.target.checked)} />
              <span className="text-sm font-medium text-ink inline-flex items-center gap-1.5">
                <Repeat className="w-4 h-4 text-primary-600" /> Repetir lançamento?
                <Dica texto={AJUDA_REPETIR} rotulo="Repetir lançamento" />
              </span>
            </label>
            {recorrente && (
              <div className="mt-4 pt-4 border-t border-surface-border">
                <CamposRecorrencia valor={rec} onChange={setRec} anoBase={hojeBR().ano}
                  descricao={form.descricao} valorOcorrencia={Number(form.valorTotal) || 0} />
              </div>
            )}
          </FormSection>
        )}
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={() => router.back()}>Cancelar</Button>
        <Button loading={salvando} onClick={salvar}>{isEditing ? "Salvar alterações" : "Criar conta a pagar"}</Button>
      </div>
    </div>
  );
}
