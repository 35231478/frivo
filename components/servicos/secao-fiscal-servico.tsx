"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CampoCadastroForm, type GrupoFormProps } from "@/components/cadastros/cadastro-padrao";
import { FormField } from "@/components/ui/form-field";
import { Dica } from "@/components/ui/dica";
import { Input } from "@/components/ui/input";
import { RETENCOES_FEDERAIS_SERVICO, type CampoCadastro } from "@/lib/cadastros/registro";
import { LISTA_LC116 } from "@/lib/nfse/lc116";
import { opcoesCodigoMunicipal } from "@/lib/nfse/busca-codigo";
import { formatarCnae } from "@/lib/nfse/servico";

/** O que o serviço herda da empresa + os códigos municipais já usados (GET /api/fiscal/apoio-servico) */
export interface ApoioFiscal {
  cnaeEmpresa: string | null;
  issEmpresa: number | null;
  servicos: { codigoMunicipal: string | null; nome: string }[];
}

export function useApoioFiscal() {
  const [apoio, setApoio] = useState<ApoioFiscal | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch("/api/fiscal/apoio-servico").then((r) => (r.ok ? r.json() : null)).then((d) => { if (vivo && d) setApoio(d); }).catch(() => {});
    return () => { vivo = false; };
  }, []);
  return apoio;
}

const percentual = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-label={titulo}>
      <h5 className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{titulo}</h5>
      {children}
    </section>
  );
}

/**
 * Seção "Dados fiscais (NFS-e)" do cadastro de serviço, compacta: quatro blocos (Classificação do
 * serviço · Tributação · Retenções na fonte · Discriminação), duas colunas onde cabe (uma no celular). Os campos e a
 * validação continuam os do registro (lib/cadastros/registro.ts); aqui só muda o desenho, mais:
 * - CNAE: "Usar o CNAE principal da empresa" (padrão) ou um CNAE próprio (vazio = herda);
 * - código municipal: busca nos códigos já usados nos serviços + LC 116 de apoio;
 * - Retenções na fonte: "ISS retido" + "Reter" IR/PIS/COFINS/CSLL/INSS com a alíquota ao lado
 *   (o faturamento herda; Simples Nacional = federais desmarcados).
 */
export function SecaoFiscalServico({ campos, valores, mudar, bloqueado }: GrupoFormProps) {
  const apoio = useApoioFiscal();
  const campo = (key: string) => campos.find((c) => c.key === key) as CampoCadastro;
  const travado = (key: string) => bloqueado(campo(key));
  const props = (key: string) => ({ campo: campo(key), valores, mudar, bloqueado: travado(key) });

  const opcoesMunicipais = useMemo(() => opcoesCodigoMunicipal(apoio?.servicos ?? [], LISTA_LC116), [apoio]);
  const municipal = { ...campo("codigoMunicipal"), opcoesCodigo: opcoesMunicipais };
  const iss = campo("aliquotaISS");
  const aliquota = apoio?.issEmpresa != null ? { ...iss, placeholder: `Em branco: ${percentual(apoio.issEmpresa)} (empresa)` } : iss;

  // CNAE: vazio = herda o da empresa. A caixa começa marcada quando o serviço não tem CNAE próprio.
  const [cnaeProprio, setCnaeProprio] = useState(!!valores.cnae);
  const cnaeEmpresa = apoio?.cnaeEmpresa ? formatarCnae(apoio.cnaeEmpresa) : null;
  function usarDaEmpresa(sim: boolean) {
    setCnaeProprio(!sim);
    if (sim) mudar("cnae", "");
  }

  return (
    <div className="space-y-5" data-secao-fiscal>
      <Bloco titulo="Classificação do serviço">
        <CampoCadastroForm {...props("codigoLc116")} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <CampoCadastroForm {...props("codigoMunicipal")} campo={municipal} />
          <div className="flex flex-col gap-1.5" data-campo="cnae">
            <span className="text-sm font-medium text-ink flex items-center gap-1">
              CNAE<Dica texto={campo("cnae").ajuda} rotulo="CNAE" lado="direita" />
            </span>
            <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox" className="mt-0.5 w-4 h-4 accent-acento" checked={!cnaeProprio} disabled={travado("cnae")}
                onChange={(e) => usarDaEmpresa(e.target.checked)}
              />
              <span>Usar o CNAE principal da empresa</span>
            </label>
            {cnaeProprio ? (
              <FormField label="CNAE próprio" className="[&>label]:sr-only">
                <Input
                  value={valores.cnae ?? ""} onChange={(e) => mudar("cnae", e.target.value)} disabled={travado("cnae")}
                  placeholder={campo("cnae").placeholder} inputMode="numeric" maxLength={12} autoFocus={!valores.cnae}
                />
              </FormField>
            ) : (
              <p className="text-xs text-ink-muted" data-cnae-herdado>
                {cnaeEmpresa
                  ? <>CNAE na nota: <span className="font-mono font-semibold text-ink">{cnaeEmpresa}</span></>
                  : "Empresa sem CNAE principal. Informe em Configurações › Dados da empresa."}
              </p>
            )}
          </div>
        </div>
      </Bloco>

      <Bloco titulo="Tributação">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <CampoCadastroForm {...props("nfseTributacao")} />
          <CampoCadastroForm {...props("aliquotaISS")} campo={aliquota} />
        </div>
      </Bloco>

      <Bloco titulo="Retenções na fonte">
        <p className="text-xs text-ink-muted -mt-1">O faturamento já sai com o que estiver marcado. Simples Nacional: deixe os federais desmarcados.</p>
        <div className="flex items-center gap-1">
          <label className="flex items-start gap-2 text-sm text-ink cursor-pointer" data-campo="issRetido">
            <input
              type="checkbox" className="mt-0.5 w-4 h-4 accent-acento" checked={valores.issRetido === "true"} disabled={travado("issRetido")}
              onChange={(e) => mudar("issRetido", e.target.checked ? "true" : "false")}
            />
            <span>ISS retido pelo tomador</span>
          </label>
          <Dica texto="Marque quando o tomador (cliente) retém e recolhe o ISS desta nota. Usa a alíquota de ISS acima." rotulo="ISS retido pelo tomador" lado="direita" />
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
          {RETENCOES_FEDERAIS_SERVICO.map((r) => {
            const marcado = valores[r.reter] === "true";
            return (
              <li key={r.reter} className="flex items-center gap-2 min-w-0" data-campo={r.reter}>
                <label className="flex items-center gap-2 text-sm text-ink cursor-pointer flex-1 min-w-0">
                  <input
                    type="checkbox" className="w-4 h-4 accent-acento" checked={marcado} disabled={travado(r.reter)}
                    onChange={(e) => mudar(r.reter, e.target.checked ? "true" : "false")}
                  />
                  <span className="truncate">Reter {r.rotulo}</span>
                </label>
                <input
                  inputMode="decimal" aria-label={`Alíquota ${r.rotulo} (%)`} placeholder={r.exemplo}
                  className="input-base w-20 text-right py-1" value={valores[r.aliquota] ?? ""} disabled={travado(r.aliquota)}
                  onChange={(e) => mudar(r.aliquota, e.target.value.replace(/[^\d,.]/g, ""))} data-aliquota={r.aliquota}
                />
                <span className="text-xs text-ink-muted shrink-0">%</span>
              </li>
            );
          })}
        </ul>
      </Bloco>

      <Bloco titulo="Discriminação">
        <CampoCadastroForm {...props("discriminacaoPadrao")} />
      </Bloco>
    </div>
  );
}
