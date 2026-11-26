# CDE · Inventário Diário de Vidros

Piloto independente do PDI, com o mesmo Supabase Auth e os perfis reais de `profiles`. Site: https://montero01.github.io/cdeinvetv1/.

## Acesso e início

Use o e-mail e senha já cadastrados no PDI. A sessão deste aplicativo é separada, sem copiar senhas ou tokens na URL. O piloto libera Vitor Amaral como operador; perfis de gerência, diretoria, master e o cargo Coordenador de Estoque têm funções gerenciais no Inventário. Rozana Seixas, Danielle S. Araújo e Kilze K. Krauss possuem liberação gerencial explícita para o período de testes. Não altera os acessos dos módulos existentes do PDI. A configuração inicial de Vitor é vinculada ao ID do perfil, não ao nome digitado no login. Não há estoque de demonstração na base.

1. Em **Cadastros**, registre os galpões e, se necessário, novos tipos, cores e espessuras.
2. Em **Entradas**, receba cada caixa ou baixe o modelo XLSX e importe um lote. Uma linha corresponde a uma caixa, não a uma nota fiscal. Cada caixa recebe identificação própria, página individual e etiquetas QR/Code128 imprimíveis.
3. Informe largura e altura em mm para calcular m²: `largura × altura ÷ 1.000.000 × chapas`. Avarias são parte do total físico informado; o sistema mostra também o saldo sem avarias.
4. Inicie o **Inventário diário**. Percorra os galpões na ordem mais prática. Não é necessário agrupar a leitura por tipo, cor ou espessura. A mesma caixa só conta uma vez.
5. Registre os avulsos por vidro, dimensões e galpão. A contagem diária é nova, não uma soma com os dias anteriores.
6. Na reconciliação, valide cada caixa não escaneada: aberta, ainda fechada por conferência manual ou não localizada com ocorrência. Só a confirmação explícita de abertura muda a caixa para aberta. Uma caixa não localizada não entra no estoque físico confirmado e volta à lista da próxima conferência.
7. Confirme a conferência de todos os galpões e encerre. O histórico conserva a contagem e as decisões; pode ser exportado em CSV.

## Regras importantes

- O início congela a lista das caixas previstas. Para evitar uma contagem inconsistente, novas entradas ficam bloqueadas até encerrar a conferência ativa. Só há um inventário ativo e um registro por data.
- Caixas abertas em dias anteriores não voltam a ser exigidas como caixas lacradas. Os avulsos restantes são contados novamente.
- O cruzamento dos avulsos usa tipo, cor, espessura, largura e altura. O sistema apresenta as caixas candidatas e a capacidade das novas aberturas, mas não inventa a nota fiscal de origem. Sobras antigas, consumo e múltiplas caixas impedem uma atribuição física segura. A diferença entre avulsas e capacidade aberta hoje **não é automaticamente quebra ou consumo**.
- Importação acrescenta caixas novas. Há prévia; qualquer linha inválida rejeita o lote inteiro. Fórmulas não são aceitas. Repetir a mesma requisição após falha de rede é seguro; reenviar o arquivo como uma nova importação cria novas caixas. Não importar novamente um lote já concluído.
- A remoção de contagem avulsa ocorre enquanto a conferência estiver ativa e fica auditada. Gerência, diretoria e master também podem excluir registros de teste conforme as regras abaixo.
- As fotos são apenas links HTTPS opcionais. Não há upload de fotos no Supabase nem envio de dados para serviços de QR externos. Armazenamento de imagens/Drive será definido em outra etapa. Um link do Drive exige permissão de visualização concedida pelo proprietário.
- A câmera precisa de HTTPS e permissão do aparelho. O leitor oferece QR e Code128, com campo para digitação/leitor físico como alternativa. A etiqueta abre a página autenticada daquele item.

## Dados e segurança

Todos os registros deste módulo ficam em `public.inventarydaily_table`, separados por `kind`: acesso, catálogo, caixa, inventário, leitura, avulso, decisão, regra de reposição e log. Fotos e XLSX binários não ficam na tabela. Não são alteradas tabelas de PCP, Caixa, Logística, E.G. ou contas do PDI.

RLS restringe leitura; escrita direta por clientes é revogada. RPCs públicas são SECURITY INVOKER e delegam a funções privadas com autenticação, autorização, validação, bloqueio transacional e identificador de requisição. Os totais do encerramento são calculados no servidor. Auditoria registra autor, horário, ação, dados e resultado; somente gerência/diretoria/master consulta o log. A chave em `config.js` é **publishable**, não service-role.

`sql/schema.sql` é a instalação consolidada para uma base sem este módulo. Já foi aplicada no projeto do PDI. Os demais SQL documentam ajustes aplicados durante os testes; não executar novamente a instalação em produção.

## Verificação

`npm ci && npm test` executa cálculo/importação e fluxos DOM com API simulada. `npm run check` verifica a sintaxe. `tests/backend.sql` testa RPCs reais numa transação com rollback, exclusivamente num piloto vazio e com os perfis Vitor/employee existentes. Os testes não trocam senhas, cargos ou permissões dos colaboradores.

Foram testados: autorização/RLS, entrada atômica, repetição de requisição, snapshot diário, leitura duplicada, caixas abertas apenas após confirmação, avarias/m², caixas não localizadas e avulsos sem acumular entre dias. QA de interface usa DOM simulado e análise estática de contraste/responsividade; câmera física, legibilidade impressa e pixels em aparelhos precisam ser conferidos no teste operacional do Vitor.

A verificação do Supabase não encontrou alertas novos para este módulo. Alertas preexistentes do PDI (fora do escopo): [search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [funções públicas antigas](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [proteção de senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Bibliotecas locais

Sem build obrigatório; GitHub Pages serve os arquivos da raiz. Bibliotecas locais versionadas em `vendor/`: Supabase JS 2.86.0 (MIT), SheetJS CE 0.20.3 (Apache-2.0), QRCode.js 1.0.0 (MIT), JsBarcode 3.12.1 (MIT), ZXing Browser 0.1.5 (MIT). Veja `vendor/manifest.json` para hashes. Dependência de testes: linkedom 0.18.12 (ISC).

## Exclusão de registros de teste

Gerência, diretoria e master veem **× Excluir inventário** na conferência em andamento, no histórico e na conferência concluída. **× Excluir item** fica na página individual da caixa. É necessário informar um motivo e confirmar a exclusão. A ação remove o registro operacional; os logs, autoria, motivo e dados excluídos permanecem na auditoria.

Somente o último inventário pode ser excluído. Se houver dias posteriores, remover do mais recente para o mais antigo. Excluir uma contagem concluída restaura o estado anterior das caixas (inclusive não localizadas), remove suas leituras, avulsas e decisões e permite iniciar novamente naquela data. Uma caixa usada em inventários só pode ser excluída após remover as contagens que a referenciam. Isso evita alterar o histórico físico de outras conferências. A exclusão direta no editor do Supabase pode falhar por esses vínculos; usar a ação do aplicativo mantém a auditoria e resolve as dependências.

`tests/delete-records.sql` validou exclusões gerenciais, bloqueio de operadores, ordem temporal, vínculos, restauração, auditoria e reenvio seguro com fixtures isoladas em rollback. Nenhum dado de teste do usuário foi apagado automaticamente.

## Impressão da etiqueta

Etiqueta horizontal de **100 mm de largura × 60 mm de altura**, com QR à esquerda, identificação à direita e barras na parte inferior. Na impressora selecionar papel 100 × 60 mm, escala 100% / tamanho real, margens zero e desativar cabeçalhos/rodapés. O driver pode exigir cadastrar esse tamanho personalizado. Prévia e impressão usam o mesmo formato; impressão força fundo branco e texto preto. Há área branca ao redor do QR e das barras para leitura. Validar uma etiqueta no equipamento antes de imprimir o lote.

## Dashboards e reposição

A Visão geral reúne cinco indicadores: chapas úteis, área útil em caixas, área útil avulsa, percentual de chapas avariadas e reposição sugerida. Cinco gráficos expansíveis apresentam estoque por tipo de vidro, estoque por galpão (caixas/avulsas), composição de chapas úteis/avariadas, evolução do estoque nas conferências concluídas e necessidade de compra por tipo de vidro. Os gráficos de estoque e evolução permitem alternar entre quantidade de chapas úteis e m² úteis; os indicadores de caixas e avulsas também mostram suas quantidades. Os gráficos usam datas reais; variação de estoque não é tratada automaticamente como venda, consumo ou quebra.

Os filtros de galpão, tipo, cor e espessura afetam o recorte atual dos gráficos de estoque. O período de datas filtra somente a evolução histórica, sem transformar o saldo atual em um saldo retroativo. A fonte dos avulsos é sempre a última conferência concluída: contagens de dias distintos e rascunhos ativos não são somados.

Em **Cadastros → Parâmetros de reposição**, gerência/diretoria/master definem mínimo e alvo em chapas para cada combinação exata de tipo, cor, espessura, largura e altura. Não é necessário ter uma caixa desse vidro para criar a regra. É possível editar ou desativar a regra sem alterar o estoque. Cada SKU tem uma única regra global; regras ficam em `inventarydaily_table`, com `kind = reorder_rule`, e as alterações são auditadas.

**Fórmula:** saldo útil = chapas em caixas fechadas + avulsas da última conferência concluída − avarias dessas mesmas chapas. Caixas abertas e não localizadas não entram como caixas em estoque. Se o saldo útil for menor ou igual ao mínimo e estiver abaixo do alvo, a sugestão será `alvo − saldo útil`; caso contrário, zero. A área sugerida é `chapas sugeridas × largura_mm × altura_mm ÷ 1.000.000`. Isso é uma indicação de reposição, não uma ordem de compra ou previsão de consumo.

A regra considera **todos os galpões juntos**. O filtro visual de galpão não reduz a base usada para comparar o mínimo global; filtros de tipo/cor/espessura recortam as regras exibidas. A tela explicita essa diferença. Havendo conferência ativa ou nenhuma conferência concluída, a sugestão é provisória; a data da última conferência fica visível para avaliar a atualidade das avulsas.

Validação: `tests/analytics.mjs` verifica fórmulas, limiares, avarias, estoque sem duplicidade e filtros. `tests/charts.mjs` verifica os quatro SVGs, dados vazios/zero, texto seguro e lacunas históricas. `tests/reorder-rules.sql` verifica autorização, limites, catálogo, unicidade, edição/inativação, auditoria e idempotência em uma transação com rollback.

## Data de entrada e foto do item

A etiqueta de 100 × 60 mm inclui **Entrada: DD/MM/AAAA**. A fonte é `created_at`, o horário original de registro da caixa no estoque, apresentado no fuso de Manaus. Não utiliza a data do inventário nem a data da impressão. O mesmo campo é exibido na página do item. As informações da etiqueta passaram para fonte de 9 pt (descrição superior de 8,5 pt), preservando as margens de leitura do QR e das barras. A prévia ajusta a escala à largura disponível sem mudar o tamanho físico da impressão.

Na página da caixa, **Visualizar foto** abre um modal no próprio aplicativo. Links HTTPS diretos são exibidos como imagem; links de arquivos do Google Drive são normalizados para o visualizador `/preview`, preservando `resourcekey` quando presente. O módulo não torna arquivos públicos nem altera permissões: o arquivo precisa permitir a visualização pelo usuário. Links de pastas ou inseguros são recusados. Se o provedor não permitir embutir a imagem ou exigir acesso adicional, a tela informa a limitação e oferece **Abrir original** como alternativa manual. Ao fechar, o carregamento da imagem/frame é interrompido e o foco volta ao botão de origem.

`tests/photos.mjs` cobre datas, limites de dia e fontes HTTPS/Drive; `tests/qa.mjs` cobre data compartilhada na prévia/impressão, viewer, erros e fechamento. Os testes de interface usam DOM simulado; impressora física e imagens privadas de provedores externos ainda dependem do equipamento e das permissões reais.

## Autorizações do piloto

O nível gerencial do **Inventário** também se aplica ao cargo de `profiles.position` igual a Coordenador de Estoque (inclui formas Coordenadora e Coordenador(a), com espaços e capitalização normalizados). Jackson aparece na base como Jackson F. Maia, supervisor e Coordenador de Estoque. A permissão considera o cargo administrado no perfil; não promove seu `profiles.role`.

Rozana Seixas, Danielle S. Araújo e Kilze K. Krauss receberam autorizações explícitas na própria `inventarydaily_table`, vinculadas aos IDs reais de seus perfis: `kind=access`, `enabled=true`, `permission=manager`, `scope=pilot`. Danielle e Kilze já herdavam permissões gerenciais dos cargos e do acesso master. As concessões foram auditadas com autor e horário. Não há data de encerramento de testes definida; as liberações ficam identificadas para revogação quando o diretor encerrar essa etapa, sem uma expiração arbitrária.

As permissões incluem cadastros/contagens, parâmetros de reposição, exclusões auditadas e leitura do log. Vitor continua operacional; outros colaboradores não são liberados por setor ou cargo semelhante. Alterações não modificam usuários, senhas, cargos, acessos comerciais ou permissões de outros módulos do PDI. É necessário sair e entrar novamente numa sessão já aberta para carregar os controles gerenciais na interface.

`sql/pilot-access.sql` registra a implantação; `tests/pilot-access.sql` validou as quatro contas, preservação dos cargos, acesso operacional do Vitor, bloqueio de outro colaborador, leitura privada da ACL e autorização no servidor. Não houve exclusão ou alteração de dados operacionais durante a verificação.

## Comparação de cadastros na importação

A comparação de tipo, cor, galpão e regras de reposição normaliza a representação Unicode (NFC), espaços repetidos, espaços não separáveis de planilhas, tabulações e marcas invisíveis. Diferenças de maiúsculas/minúsculas não criam outro item. Exemplo: o cadastro legado `Habitat  Neutro` (dois espaços) é reconhecido ao importar `Habitat Neutro` (um espaço). Acentos e palavras diferentes continuam distintos; não se faz aproximação entre nomes de mercadorias. Espessuras numericamente equivalentes, como `2` e `02.0`, usam a mesma chave.

Os cadastros históricos e IDs foram preservados. A interface apresenta os nomes com espaçamento consistente; novos registros usam a grafia canônica do cadastro. Tentar adicionar uma opção equivalente retorna o cadastro existente. Para tipos realmente ausentes, a mensagem agora usa o nome do campo em português e indica o número do registro com problema. Importações continuam atômicas.

`sql/catalog-normalization.sql` e `sql/catalog-unicode-space.sql` registram a correção; `tests/catalog-normalization.sql` reproduz a entrada com o cadastro real de dois espaços, testa formatos de planilha, ausência de duplicação, rótulos canônicos, idempotência, erro de lote e galpões de snapshots antigos. O teste roda com rollback e não grava entradas fictícias.

## Resumo geral de reposição e câmera contínua

Antes dos filtros, a Visão geral apresenta a **reposição geral**, agrupada apenas por tipo de vidro e quantidade de chapas necessárias. O cálculo parte das regras ativas por SKU (incluindo cor, espessura e dimensões); só depois soma as necessidades por tipo. Portanto, excedente de uma dimensão não compensa falta de outra. Esse resumo é global e não muda com os filtros do recorte abaixo. Quando não há regras, informa que a configuração está pendente; quando as regras existem sem necessidade, mostra que não há reposição sugerida. A base incompleta permanece sinalizada como provisória.

O quinto gráfico, **Chapas a comprar**, representa a necessidade calculada pelos mínimos e alvos, não pedidos de compra confirmados ou mercadoria em trânsito. Ele segue o recorte de vidro; a regra de reposição continua utilizando todos os galpões. Nenhuma compra é criada automaticamente.

No inventário diário, a câmera permanece aberta após cada leitura. O aplicativo confirma o item e fica pronto para a próxima etiqueta no mesmo vídeo, sem reiniciar o leitor. Leituras repetidas da mesma caixa são reconhecidas sem duplicar registros; QR e código de barras que identificam a mesma caixa compartilham a identificação. Uma falha permite nova tentativa mantendo o identificador da operação. A câmera só é encerrada quando o usuário fecha a janela ou sai da sessão. Respostas pendentes não devem reabrir a janela nem restaurar dados de uma sessão encerrada.

As quantidades históricas vêm dos registros detalhados das conferências, sem converter m² em chapas por uma dimensão presumida. Dados históricos sem base quantitativa ficam com lacunas. Os testes de BI, SVG e DOM cobrem as quantidades, resumo sem filtros, quinto gráfico, câmera contínua, duplicidade e limpeza do leitor. O teste da câmera física ainda depende do navegador e do aparelho utilizado no galpão.
