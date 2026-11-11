# App do técnico — execução guiada lapidada (Etapa 2b)

**Sem mudança de banco.** Os cinco pontos pedidos já existiam; esta etapa fecha as pontas das
permissões do app e acelera o caminho entre equipamentos.

## Levantamento — o que a execução já tinha (mantido)

| Ponto | Situação antes |
|---|---|
| 1. "Tudo OK" num toque, reversível | Já existia: marca OK só os itens ainda sem resposta (não sobrescreve Atenção/N-A nem medição); depois cada item troca pelos chips |
| 2. Resposta por chips OK / Atenção / N/A | Já existia (medição: número + unidade + N/A) |
| 3. Atenção exige foto + observação | Já existia: só marca com 1 foto e a observação, e a trava cobra se a foto for tirada depois. **A observação por voz (ditar/gravar) também já existia** — não foi mexida neste PR |
| 4. Próximo equipamento + "Equipamento N de M" | Já existia: concluir leva ao próximo ainda por fazer |
| 5. Fotos antes/depois por equipamento | Já existia: a foto tem o `momento` (ANTES/DEPOIS) desde a Etapa 2 — nada de banco |
| Trava de conclusão | Já existia (cliente e servidor, mesma regra) |
| Salvamento incremental e sem sinal | Já existia: cada toque vira uma operação na fila do aparelho e sobe depois |

## O que foi criado / melhorado

**Pontas das permissões (Equipes › App do colaborador)**
- **Foto somente pela câmera bloqueia de verdade.** Além do `capture` (que no celular abre a câmera
  direto), arquivo antigo — galeria ou pasta — é recusado com aviso e nada é gravado. Vale em toda
  foto do app, inclusive a prova da Atenção. É uma segunda barreira: há aparelho que regrava a data
  ao escolher da galeria; nesses, vale o `capture`.
- **Marca d'água na prova da Atenção.** A foto do problema saía só com data/hora; agora leva a OS e
  o endereço como as demais. A foto do serviço também passou a levar o endereço.
- **Dados do cliente desligados.** O nome da unidade do cliente ia junto de cada equipamento no
  retrato da OS; agora também não sai do servidor.

**Velocidade**
- **Setas no cabeçalho** (anterior/próximo) para pular de equipamento sem voltar à lista.
- **Rodapé que diz para onde vai:** "Concluir e ir ao próximo · Split UTI 1 · equipamento 2 de 3";
  no último, "Volta para a OS para concluir a atividade". Incompleto, conta: "Faltam 3 — ver o que falta".
- **Atenção diz o que falta** (a foto, ou a observação) em vez de uma frase genérica.
- **Fotos ANTES / DEPOIS com a contagem** no título da seção.

## Testes

- `app-tecnico-ui` — 9 casos novos: TUDO OK reversível; Atenção (mensagens, marca d'água, trava sem
  a foto); próximo equipamento (posição, setas, rodapé); antes/depois; galeria bloqueada e liberada;
  nada do cliente na tela; reabrir sem sinal não apaga; trava de conclusão.
- `app-tecnico-pg` (Postgres real) — o retrato da OS sem a unidade do cliente.

## Prints

`docs/prints/tecnico-execucao/` — celular (01 a 10) e desktop (11, 12).
