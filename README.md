# CDE · Inventário Diário de Vidros

Piloto independente do PDI, com o mesmo Supabase Auth e os perfis reais de `profiles`. Site: https://montero01.github.io/cdeinvetv1/.

## Acesso e início

Use o e-mail e senha já cadastrados no PDI. A sessão deste aplicativo é separada, sem copiar senhas ou tokens na URL. O piloto libera Vitor Amaral e perfis de gerência, diretoria ou master. Não altera os acessos dos módulos existentes do PDI. A configuração inicial de Vitor é vinculada ao ID do perfil, não ao nome digitado no login. Não há estoque de demonstração na base.

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

Todos os registros deste módulo ficam em `public.inventarydaily_table`, separados por `kind`: acesso, catálogo, caixa, inventário, leitura, avulso, decisão e log. Fotos e XLSX binários não ficam na tabela. Não são alteradas tabelas de PCP, Caixa, Logística, E.G. ou contas do PDI.

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
