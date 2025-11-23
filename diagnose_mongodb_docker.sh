#!/bin/bash
# Script para diagnosticar MongoDB rodando em Docker

echo "======================================================================"
echo "DIAGNÓSTICO MONGODB (Docker) - UDATA"
echo "======================================================================"
echo ""

# Detectar o container MongoDB
MONGO_CONTAINER=$(docker ps --format '{{.Names}}' | grep -i mongo | head -1)

if [ -z "$MONGO_CONTAINER" ]; then
    echo "❌ Nenhum container MongoDB encontrado rodando!"
    echo "Containers ativos:"
    docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
    exit 1
fi

echo "✅ Container MongoDB encontrado: $MONGO_CONTAINER"
echo ""

# 1. Verificar índices
echo "[1] Verificando índices da collection 'dataset'..."
docker exec $MONGO_CONTAINER mongo udata --quiet --eval "
    print('Índices encontrados:');
    db.dataset.getIndexes().forEach(function(idx) {
        print('  - ' + idx.name + ': ' + JSON.stringify(idx.key));
    });
"
echo ""

# 2. Verificar tamanho da collection
echo "[2] Verificando tamanho da collection 'dataset'..."
docker exec $MONGO_CONTAINER mongo udata --quiet --eval "
    var stats = db.dataset.stats();
    print('Documentos: ' + stats.count);
    print('Tamanho: ' + (stats.size / 1024 / 1024).toFixed(2) + ' MB');
    print('Tamanho médio doc: ' + (stats.avgObjSize / 1024).toFixed(2) + ' KB');
"
echo ""

# 3. Testar velocidade de insert
echo "[3] Testando velocidade de insert (10 documentos)..."
docker exec $MONGO_CONTAINER mongo udata --quiet --eval "
    var startTime = new Date();
    for (var i = 0; i < 10; i++) {
        db.test_performance.insert({
            test_id: 'perf_test_' + i,
            timestamp: new Date(),
            data: 'test data for performance testing'
        });
    }
    var endTime = new Date();
    var duration = (endTime - startTime) / 1000;
    print('10 inserts em ' + duration + ' segundos');
    print('Taxa: ' + (10 / duration).toFixed(2) + ' inserts/segundo');
    db.test_performance.drop();
"
echo ""

# 4. Verificar conexões
echo "[4] Verificando conexões ativas..."
docker exec $MONGO_CONTAINER mongo udata --quiet --eval "
    var conns = db.serverStatus().connections;
    print('Conexões abertas: ' + conns.current);
    print('Conexões disponíveis: ' + conns.available);
"
echo ""

# 5. Verificar operações lentas recentes
echo "[5] Verificando operações lentas (últimas 24h)..."
docker exec $MONGO_CONTAINER mongo udata --quiet --eval "
    var yesterday = new Date(Date.now() - 24*60*60*1000);
    var slowOps = db.system.profile.find({
        ts: {\$gte: yesterday},
        millis: {\$gt: 100}
    }).sort({millis: -1}).limit(5);
    
    var count = slowOps.count();
    if (count > 0) {
        print('Encontradas ' + count + ' operações lentas:');
        slowOps.forEach(function(op) {
            print('  Operação: ' + op.op + ' | Duração: ' + op.millis + 'ms');
            if (op.ns) print('  Collection: ' + op.ns);
        });
    } else {
        print('Sem operações lentas detectadas (ou profiling desabilitado)');
    }
"
echo ""

# 6. Verificar stats do container
echo "[6] Stats do container Docker..."
docker stats $MONGO_CONTAINER --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
echo ""

echo "======================================================================"
echo "DIAGNÓSTICO COMPLETO"
echo "======================================================================"
