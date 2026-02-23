#!/bin/bash
# ==============================================================================
# Teste de Vulnerabilidade: XSS Persistente via Upload de Ficheiro
# Relatório: Devoteam Cyber Trust
# Dataset de teste: https://dados.gov.pt/pt/datasets/teste-1-0/
#
# Endpoints testados:
#   A) POST /api/1/datasets/{dataset}/upload/community/
#   B) POST /api/1/datasets/{dataset}/resources/{rid}/upload/
# ==============================================================================

API_KEY="********"
DATASET_ID="*****"
BASE_URL="https://dados.gov.pt"

# Caminho do SVG — sempre relativo ao diretório do script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SVG_FILE="$SCRIPT_DIR/poisoned.svg"
RESULTS_FILE="$SCRIPT_DIR/resultados_teste.txt"
SVG_SIZE=$(wc -c < "$SVG_FILE" | tr -d ' ')

# Inicializar ficheiro de resultados
> "$RESULTS_FILE"
log() { echo "$1" | tee -a "$RESULTS_FILE"; }

# Função para fazer upload e mostrar resultado
do_upload() {
  local label="$1"; local expected="$2"; local http_resp
  shift 2
  http_resp=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$@")
  local code body
  code=$(echo "$http_resp" | grep "HTTP_STATUS" | cut -d: -f2)
  body=$(echo "$http_resp" | grep -v "HTTP_STATUS")

  local icon="✅"
  [ "$code" != "$expected" ] && icon="⚠️ "

  log "  [$label] HTTP $code (esperado: $expected) $icon"
  log "  → Resposta: $(echo "$body" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('message') or d.get('url') or str(d)[:120])" 2>/dev/null || echo "$body" | head -c 200)"

  # Se upload OK, mostrar URL do recurso criado
  if [ "$code" == "201" ]; then
    local url rid
    url=$(echo "$body" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('url',''))" 2>/dev/null)
    rid=$(echo "$body"  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))"  2>/dev/null)
    log "  → URL do ficheiro : $url"
    log "  → Link de acesso  : $BASE_URL/pt/datasets/r/$rid"
    log "  → ⚠️  VERIFICA NO BROWSER: $BASE_URL/pt/datasets/r/$rid"
  fi
  log ""
}

log "============================================================"
log " TESTE XSS - SVG Malicioso com alert('XSS')"
log " Dataset: $BASE_URL/pt/datasets/teste-1-0/"
log " Ficheiro: $SVG_FILE ($SVG_SIZE bytes)"
log " Resultados guardados em: $RESULTS_FILE"
log "============================================================"
log ""

# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINT A: /api/1/datasets/{dataset}/upload/community/
# ─────────────────────────────────────────────────────────────────────────────
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log " ENDPOINT A: /api/1/datasets/{dataset}/upload/community/"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log ""

log "[A1] SVG com Content-Type correto → deve ser BLOQUEADO (415)"
do_upload "A1" "415" \
  -X POST "$BASE_URL/api/1/datasets/$DATASET_ID/upload/community/" \
  -H "X-API-KEY: $API_KEY" -H "X-Requested-With: XMLHttpRequest" \
  -F "uuid=12345678-abcd-1234" -F "filename=poisoned.svg" -F "size=$SVG_SIZE" \
  -F "file=@$SVG_FILE;type=image/svg+xml"

log "[A2] SVG renomeado para .png (bypass por extensão) → VULNERÁVEL se 201"
do_upload "A2" "415" \
  -X POST "$BASE_URL/api/1/datasets/$DATASET_ID/upload/community/" \
  -H "X-API-KEY: $API_KEY" -H "X-Requested-With: XMLHttpRequest" \
  -F "uuid=12345678-abcd-1234" -F "filename=poisoned.png" -F "size=$SVG_SIZE" \
  -F "file=@$SVG_FILE;type=image/png;filename=poisoned.png"

log "[A3] SVG renomeado para .xml (bypass por extensão) → VULNERÁVEL se 201"
do_upload "A3" "415" \
  -X POST "$BASE_URL/api/1/datasets/$DATASET_ID/upload/community/" \
  -H "X-API-KEY: $API_KEY" -H "X-Requested-With: XMLHttpRequest" \
  -F "uuid=12345678-abcd-1234" -F "filename=poisoned.xml" -F "size=$SVG_SIZE" \
  -F "file=@$SVG_FILE;type=text/xml;filename=poisoned.xml"

# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINT B: /api/1/datasets/{dataset}/resources/{rid}/upload/
# ─────────────────────────────────────────────────────────────────────────────
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log " ENDPOINT B: /api/1/datasets/{dataset}/resources/{rid}/upload/"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log ""
log "[B0] A criar recurso remoto para obter um Resource ID..."

CREATE_RESP=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "$BASE_URL/api/1/datasets/$DATASET_ID/resources/" \
  -H "X-API-KEY: $API_KEY" -H "Content-Type: application/json" \
  -d '{"title":"Recurso Teste XSS","url":"https://example.com/test","type":"main","filetype":"remote"}')
CREATE_CODE=$(echo "$CREATE_RESP" | grep "HTTP_STATUS" | cut -d: -f2)
CREATE_BODY=$(echo "$CREATE_RESP" | grep -v "HTTP_STATUS")
RESOURCE_ID=$(echo "$CREATE_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)

if [ -z "$RESOURCE_ID" ]; then
  log "  → ⚠️  Não foi possível criar recurso de teste (HTTP $CREATE_CODE)."
  log "  → Resposta: $(echo "$CREATE_BODY" | head -c 200)"
  log ""
else
  log "  → Recurso criado com ID: $RESOURCE_ID"
  log ""

  log "[B1] SVG com Content-Type correto → deve ser BLOQUEADO"
  do_upload "B1" "415" \
    -X POST "$BASE_URL/api/1/datasets/$DATASET_ID/resources/$RESOURCE_ID/upload/" \
    -H "X-API-KEY: $API_KEY" -H "X-Requested-With: XMLHttpRequest" \
    -F "file=@$SVG_FILE;type=image/svg+xml"

  log "[B2] SVG renomeado para .png → VULNERÁVEL se 200/201"
  do_upload "B2" "415" \
    -X POST "$BASE_URL/api/1/datasets/$DATASET_ID/resources/$RESOURCE_ID/upload/" \
    -H "X-API-KEY: $API_KEY" -H "X-Requested-With: XMLHttpRequest" \
    -F "file=@$SVG_FILE;type=image/png;filename=poisoned.png"

  # Limpar o recurso de teste criado
  curl -s -X DELETE "$BASE_URL/api/1/datasets/$DATASET_ID/resources/$RESOURCE_ID/" \
    -H "X-API-KEY: $API_KEY" -o /dev/null
  log "  → Recurso de teste $RESOURCE_ID eliminado."
  log ""
fi

log "============================================================"
log " Fim dos testes. Resultados completos em: $RESULTS_FILE"
log "============================================================"
