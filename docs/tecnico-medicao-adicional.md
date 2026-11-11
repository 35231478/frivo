# App do técnico — medição só captura e serviço adicional (Etapa 2c)

**Sem mudança de banco.**

## (A) Medição = só captura

### Levantamento
- O campo de medição no app já é **número + unidade + N/A** (`ItemMedicao`), sem chips de OK/Atenção.
- **Não existe avaliação de medição para o técnico:** o modelo (`checklist_tipo_itens`) nem tem faixa
  de referência (mínimo/máximo); a tela não tem cor, alerta ou texto "fora da faixa".
- O servidor já recusa OK/Atenção numa medição; "Tudo OK" pula as medições.
- A única mensagem do campo é de digitação ("Número inválido"), não do valor.

### O que mudou
- **Nada a remover.** Entrou um teste-guarda: valores absurdos (9999, -40, 0) são guardados como
  vieram, sem cor, alerta nem palavra que julgue — se alguém puser avaliação na tela do técnico, o
  teste quebra. A interpretação fica para o administrativo/IA, numa etapa futura.

## (B) Serviço adicional dentro da OS

### Levantamento — já existia
| Regra | Situação |
|---|---|
| Botão "Adicionar serviço extra" na OS | Já existia |
| Entra na MESMA OS e no MESMO relatório (não cria OS) | Já existia |
| Destacado como Adicional (app, painel do escritório, relatório) | Já existia |
| Descrição, fotos e equipamento opcional | Já existia |
| Técnico não define preço/cobrança ("o escritório decide a cobrança") | Já existia — a rota de cobrança recusa o técnico |
| Sem sinal: fica no aparelho e sobe depois | Já existia |

### O que foi criado / corrigido
1. **Adicional já avaliado fica travado no app.** Antes, com a atividade aberta, o técnico ainda
   conseguia alterar ou apagar um adicional que o escritório já tinha marcado para cobrar (com
   preço). Agora o servidor recusa alterar, tirar o serviço ou tirar a foto dele; o app mostra
   "escritório já avaliou" e abre só para consulta. Reenviar a mesma gravação e juntar mais uma
   foto continuam valendo. Se o escritório voltar para "A avaliar", o técnico corrige de novo.
2. **A decisão de cobrança não vai mais para o app.** O retrato da OS levava a situação
   (cobrar / não cobrar); agora leva só o sinal de que já foi avaliado. O preço nunca foi.
3. **Miniatura em branco corrigida.** A foto de um adicional já sincronizado usava o endereço das
   fotos de equipamento e não carregava no app.
4. Toque ≥44px no cartão do adicional.

## Pontas das permissões (conferidas com teste)
- Foto somente pela câmera recusa a galeria também na foto do adicional.
- Marca d'água: a foto do adicional leva data/hora, OS e endereço.
- Dados do cliente desligados: nada do cliente no adicional, e o carimbo não leva o endereço.
- Trava de conclusão: registrar serviço extra não libera a atividade sem equipamento atendido.
- Sem sinal: medição e adicional (com foto) voltam do aparelho ao reabrir.

## Testes
- `app-tecnico-ui` — 9 casos novos (medição só captura; adicional completo, avaliado, permissões, trava, sem sinal, miniatura).
- `app-tecnico-pg` (Postgres real) — adicional avaliado: o app não recebe decisão nem preço; alterar/tirar recusado; reenvio igual e nova foto aceitos; volta a editar quando o escritório reabre.

## Prints
`docs/prints/tecnico-medicao-adicional/` — celular (01 a 06) e desktop (07 a 09, com o painel do escritório).
