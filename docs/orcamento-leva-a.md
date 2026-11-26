# Orçamento — leva A: o "Copiar link" que não copiava e a limpeza do Editar

Itens anotados pelo dono na ferramenta de Anotações Internas (telas Orçamento e Editar orçamento).
Sem banco: nenhuma coluna, tabela ou SQL novo.

## 1. "Copiar link" — a causa real e a correção

**Causa (reproduzida no navegador):** o botão ia ao servidor (`POST /api/orcamentos/[id]/enviar`, que
registra o envio) e **só depois** tentava escrever na área de transferência, engolindo o erro
(`navigator.clipboard?.writeText(...).catch(() => {})`) e mostrando "Link copiado." de qualquer jeito.
O navegador recusa a escrita (`NotAllowedError`) quando:

- a escrita não acontece dentro do toque/clique — no Safari e no iOS, depois de uma espera de rede o
  gesto já não vale;
- a página não é contexto seguro (http fora do localhost): `navigator.clipboard` nem existe e o `?.`
  pulava a cópia calado;
- a permissão de escrita foi negada ou a aba perdeu o foco.

Nos três casos a tela dizia "Link copiado." com a área de transferência vazia. O link nunca esteve
"ainda não gerado": o token público existe desde a criação do orçamento.

**Correção:**

- `lib/ui/copiar.ts` (`copiarTexto`): API moderna em contexto seguro → se recusar ou não existir, o
  comando clássico de copiar (área de texto selecionada) → se nada funcionar, devolve `null`. Nunca
  finge que copiou.
- `components/orcamento/acoes-envio.tsx`: a cópia começa **no próprio clique**, antes de ir ao
  servidor, com o link montado na tela (`buildPublicUrl(token, origem)`, a mesma regra do servidor).
  Depois o servidor registra o envio, como antes.
- Copiou → toast **"Link copiado."**. Não copiou → toast informativo e o link aparece num campo
  **já selecionado**, para copiar com Ctrl+C ou tocar e segurar. Se o servidor devolver outro
  endereço (proxy, domínio próprio), vale o do servidor, no campo.
- Erro do servidor (ex.: validade vencida) ou de conexão: toast de erro, sem "copiado".

E-mail e WhatsApp seguem iguais (mensagem na própria caixa, como hoje).

## 2. "Obs.:" saiu do documento

A observação do item continua no documento (tela, link público e PDF), em itálico e cinza, sem o
rótulo "Obs.:" — o estilo já a distingue da descrição.

## 3 e 4. Editar orçamento mais limpo

| Antes | Agora |
|---|---|
| "Interno: o cliente vê só a linha do serviço (já ajustada) e as peças como produtos." em linha inteira, repetida em cada serviço | ⓘ ao lado de **Materiais e peças**; a frase abre o balão, junto da explicação que já existia |
| "Nenhum material. Adicione um produto avulso abaixo." | "Nenhum material." (o seletor logo abaixo já diz como adicionar) |
| "Custo interno (último custo de compra): R$ X · N sem custo — não entra no preço." | "Custo interno: R$ X · N sem custo" + ⓘ com o porquê |
| "IA não configurada" em texto ao lado do botão desligado | ⓘ ao lado do botão, com o porquê |
| Normas atendidas: nome + descrição longa em cada caixa | Só o nome; a descrição no ⓘ ao lado (fora do `label`: o ⓘ não marca a caixa) |

Nenhuma informação se perdeu: tudo o que saiu da tela está no ⓘ correspondente.

Fica para as próximas levas (mesma tela): o texto de "Anexos da proposta" na tela do orçamento e a
linha "Sem ISS (alíquota 0% em Configurações)." nos totais.

## 5. Número da OS no PDF

**Levantamento:** não existia. O documento (`OrcamentoDocumento`) não lia as OS vinculadas; elas só
apareciam na tela interna ("Ordens de serviço vinculadas").

**Agora:** o cabeçalho do documento, no quadro de Emissão e Válido até, ganha a linha **OS** com os
números das OS vinculadas (`orcamento_ordens_servico`), só o número, sem link. Vale para a tela
interna, o link público e o PDF (a mesma `INCLUDE_DOCUMENTO_ORCAMENTO`).

Regra pura em `lib/orcamentos/proposta.ts` (`numerosOsDoDocumento`): só OS da mesma empresa do
orçamento, sem repetir, sem vazio, na ordem de abertura. Sem OS vinculada, a linha não aparece.

O link clicável para o cliente fica para uma leva futura: exige link público da OS com token.

A proposta de contrato (`PropostaDocumento`, capa própria) não mudou.
