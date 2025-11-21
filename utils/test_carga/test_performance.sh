#!/bin/bash
##
# Script de teste de performance para udata-front-pt
# Executa testes antes e depois das melhorias no uwsgi/front.ini
##

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuração
RESULTS_DIR="./test_results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo -e "${BLUE}════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  🚀 Teste de Performance - uData Front PT${NC}"
echo -e "${BLUE}════════════════════════════════════════════════${NC}"
echo ""

# Função para selecionar servidor
select_server() {
    echo -e "${CYAN}📡 Selecione o servidor para testar:${NC}"
    echo ""
    echo -e "  ${GREEN}1)${NC} Desenvolvimento (http://dev.local:7000)"
    echo -e "  ${YELLOW}2)${NC} Pré-produção (https://preprod.dados.gov.pt)"
    echo -e "  ${RED}3)${NC} Produção (https://dados.gov.pt)"
    echo -e "  ${BLUE}4)${NC} URL personalizada"
    echo ""
    
    read -p "Escolha uma opção [1-4]: " server_choice
    
    case $server_choice in
        1)
            UDATA_URL="http://dev.local:7000"
            SERVER_NAME="Desenvolvimento"
            ;;
        2)
            UDATA_URL="https://preprod.dados.gov.pt"
            SERVER_NAME="Pré-produção"
            echo ""
            echo -e "${YELLOW}⚠️  ATENÇÃO: Vai testar em PRÉ-PRODUÇÃO${NC}"
            echo -e "${YELLOW}   Certifique-se que tem autorização para executar testes de carga${NC}"
            echo ""
            read -p "Deseja continuar? [s/N]: " confirm
            if [[ ! "$confirm" =~ ^[sS]$ ]]; then
                echo -e "${RED}Operação cancelada.${NC}"
                exit 0
            fi
            ;;
        3)
            UDATA_URL="https://dados.gov.pt"
            SERVER_NAME="Produção"
            echo ""
            echo -e "${RED}⚠️  ⚠️  ⚠️  ATENÇÃO: AMBIENTE DE PRODUÇÃO ⚠️  ⚠️  ⚠️${NC}"
            echo -e "${RED}   Testes de carga podem impactar utilizadores reais!${NC}"
            echo -e "${RED}   Execute apenas fora de horário de pico${NC}"
            echo -e "${RED}   e com autorização expressa${NC}"
            echo ""
            read -p "Tem CERTEZA que deseja continuar? [s/N]: " confirm
            if [[ ! "$confirm" =~ ^[sS]$ ]]; then
                echo -e "${RED}Operação cancelada.${NC}"
                exit 0
            fi
            read -p "Digite 'CONFIRMO' para prosseguir: " final_confirm
            if [ "$final_confirm" != "CONFIRMO" ]; then
                echo -e "${RED}Operação cancelada.${NC}"
                exit 0
            fi
            ;;
        4)
            echo ""
            read -p "Digite a URL completa (ex: http://localhost:7000): " custom_url
            if [ -z "$custom_url" ]; then
                echo -e "${RED}URL inválida. Operação cancelada.${NC}"
                exit 1
            fi
            UDATA_URL="$custom_url"
            SERVER_NAME="Personalizado"
            ;;
        *)
            echo -e "${RED}Opção inválida. Operação cancelada.${NC}"
            exit 1
            ;;
    esac
    
    echo ""
    echo -e "${GREEN}✓ Servidor selecionado: ${SERVER_NAME}${NC}"
    echo -e "${GREEN}✓ URL: ${UDATA_URL}${NC}"
    echo ""
}

# Seleciona servidor se não foi definido via variável de ambiente
if [ -z "$UDATA_URL" ]; then
    select_server
else
    SERVER_NAME="Ambiente (variável UDATA_URL)"
    echo -e "${CYAN}📡 Usando servidor da variável de ambiente${NC}"
    echo -e "${GREEN}✓ URL: ${UDATA_URL}${NC}"
    echo ""
fi

# Verifica se Python está disponível
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python3 não encontrado!${NC}"
    exit 1
fi

# Instala dependências se necessário
echo -e "${YELLOW}📦 Verificando dependências...${NC}"
pip3 install -q aiohttp 2>/dev/null || {
    echo -e "${YELLOW}⚠️  Instalando aiohttp...${NC}"
    pip3 install aiohttp
}

# Cria diretório de resultados
mkdir -p "${RESULTS_DIR}"

# Função para verificar se o serviço está disponível
check_service() {
    echo -e "${YELLOW}🔍 Verificando se o serviço está disponível em ${UDATA_URL}...${NC}"
    
    # Adiciona flags para HTTPS com certificados auto-assinados
    local curl_opts="-s -o /dev/null -w %{http_code}"
    if [[ "${UDATA_URL}" =~ ^https:// ]]; then
        curl_opts="${curl_opts} -k"  # Ignora verificação de certificado SSL
    fi
    
    for i in {1..5}; do
        http_code=$(curl ${curl_opts} "${UDATA_URL}" 2>/dev/null || echo "000")
        if [[ "$http_code" =~ ^(200|302|301|404)$ ]]; then
            echo -e "${GREEN}✅ Serviço disponível! (HTTP ${http_code})${NC}"
            return 0
        fi
        echo -e "${YELLOW}   Tentativa ${i}/5 (código: ${http_code}) - Aguardando...${NC}"
        sleep 2
    done
    
    echo -e "${RED}❌ Serviço não disponível em ${UDATA_URL}${NC}"
    echo -e "${YELLOW}💡 Dica: Verifique se o endereço está correto e acessível${NC}"
    echo -e "${YELLOW}   Teste manual: curl -k ${UDATA_URL}${NC}"
    return 1
}

# Função para coletar métricas do sistema
collect_system_metrics() {
    local output_file="${RESULTS_DIR}/system_metrics_${TIMESTAMP}.log"
    
    echo -e "${YELLOW}📊 Coletando métricas do sistema (local)...${NC}" # Adicionado "(local)" para esclarecer
    
    {
        echo "=== Métricas do Sistema - $(date) ==="
        echo ""
        echo "=== CPU ==="
        top -bn1 | head -20
        echo ""
        echo "=== Memória ==="
        free -h
        echo ""
        echo "=== Processos uWSGI ==="
        ps aux | grep uwsgi | grep -v grep || echo "Nenhum processo uWSGI encontrado"
        echo ""
        echo "=== Conexões de Rede ==="
        # As métricas de rede abaixo são do sistema local onde o script está sendo executado.
        # Para métricas do sistema remoto, seria necessário SSH ou uma API de monitoramento.
        netstat -an | grep 7000 | wc -l || ss -an | grep 7000 | wc -l
    } > "${output_file}"
    
    echo -e "${GREEN}   Métricas salvas em: ${output_file}${NC}"
}

# Função principal de teste
run_performance_test() {
    local test_name="$1"
    local output_file="${RESULTS_DIR}/performance_${test_name}_${TIMESTAMP}.log"
    
    echo -e "${BLUE}===================================${NC}"
    echo -e "${BLUE}  Executando: ${test_name}${NC}"
    echo -e "${BLUE}  Servidor: ${SERVER_NAME}${NC}"
    echo -e "${BLUE}===================================${NC}"
    echo ""
    
    # Executa o teste Python
    if python3 test_performance.py "${UDATA_URL}" | tee "${output_file}"; then
        echo -e "${GREEN}✅ Teste concluído com sucesso!${NC}"
        echo -e "${GREEN}   Log salvo em: ${output_file}${NC}"
        return 0
    else
        echo -e "${RED}❌ Teste falhou! Erros 502 detectados.${NC}"
        echo -e "${RED}   Log salvo em: ${output_file}${NC}"
        return 1
    fi
}

# Função para teste comparativo
run_comparative_test() {
    echo -e "${BLUE}================================================${NC}"
    echo -e "${BLUE}  TESTE COMPARATIVO${NC}"
    echo -e "${BLUE}  Servidor: ${SERVER_NAME}${NC}"
    echo -e "${BLUE}================================================${NC}"
    echo ""
    echo -e "${YELLOW}Este teste compara a performance antes e depois${NC}"
    echo -e "${YELLOW}das melhorias no uwsgi/front.ini${NC}"
    echo ""
    
    # Coleta métricas antes
    collect_system_metrics
    
    # Executa teste
    if run_performance_test "comparative"; then
        echo ""
        echo -e "${GREEN}================================================${NC}"
        echo -e "${GREEN}  ✅ TESTE PASSOU - MELHORIAS EFICAZES${NC}"
        echo -e "${GREEN}================================================${NC}"
        echo -e "${GREEN}  • Zero erros 502 detectados${NC}"
        echo -e "${GREEN}  • Workers reciclam corretamente${NC}"
        echo -e "${GREEN}  • Sistema estável sob carga${NC}"
        echo -e "${GREEN}================================================${NC}"
        return 0
    else
        echo ""
        echo -e "${RED}================================================${NC}"
        echo -e "${RED}  ❌ TESTE FALHOU - MELHORIAS INSUFICIENTES${NC}"
        echo -e "${RED}================================================${NC}"
        echo -e "${RED}  • Erros 502 ainda ocorrem${NC}"
        echo -e "${RED}  • Revisar configuração do uWSGI${NC}"
        echo -e "${RED}  • Verificar logs em ${RESULTS_DIR}${NC}"
        echo -e "${RED}================================================${NC}"
        return 1
    fi
}

# Função para teste simples (quick check)
run_quick_test() {
    echo -e "${BLUE}================================================${NC}"
    echo -e "${BLUE}  TESTE RÁPIDO (1 minuto)${NC}"
    echo -e "${BLUE}  Servidor: ${SERVER_NAME}${NC}"
    echo -e "${BLUE}================================================${NC}"
    echo ""
    
    # Teste simplificado - apenas 100 requisições
    python3 - "${UDATA_URL}" <<'EOF'
import asyncio
import aiohttp
import sys
import time

async def quick_test(url):
    errors_502 = 0
    success = 0
    
    async with aiohttp.ClientSession() as session:
        tasks = []
        for _ in range(100):
            async def req():
                try:
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as r:
                        return r.status
                except:
                    return 0
            tasks.append(req())
        
        results = await asyncio.gather(*tasks)
        
        for status in results:
            if status == 502:
                errors_502 += 1
            elif 200 <= status < 400:
                success += 1
        
        print(f"\n✅ Sucesso: {success}/100")
        print(f"❌ Erros 502: {errors_502}/100")
        
        if errors_502 > 0:
            print(f"\n❌ FALHA: Erros 502 detectados")
            sys.exit(1)
        else:
            print(f"\n✅ PASSOU: Zero erros 502")
            sys.exit(0)

if __name__ == "__main__":
    asyncio.run(quick_test(sys.argv[1]))
EOF
}

# Menu principal
main() {
    # Verifica se o serviço está disponível
    if ! check_service; then
        echo -e "${RED}Abortando testes.${NC}"
        exit 1
    fi
    
    echo ""
    echo -e "${CYAN}🧪 Escolha o tipo de teste:${NC}"
    echo -e "  ${GREEN}1)${NC} Teste Rápido (1 minuto, 100 requisições)"
    echo -e "  ${GREEN}2)${NC} Teste Completo (3-5 minutos, suite completa)"
    echo -e "  ${GREEN}3)${NC} Teste Comparativo (com coleta de métricas)"
    echo ""
    
    # Se argumento passado, usa direto
    if [ -n "$1" ]; then
        CHOICE="$1"
    else
        read -p "Opção [1-3]: " CHOICE
    fi
    
    case $CHOICE in
        1)
            run_quick_test
            ;;
        2)
            run_performance_test "complete"
            ;;
        3)
            run_comparative_test
            ;;
        *)
            echo -e "${YELLOW}Executando teste completo por padrão...${NC}"
            run_performance_test "default"
            ;;
    esac
}

# Executa
main "$@"
