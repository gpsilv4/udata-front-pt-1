#!/bin/bash
# Script para diagnosticar performance do MongoDB

echo "======================================================================"
echo "DIAGNÓSTICO MONGODB - UDATA"
echo "======================================================================"
echo ""

# 1. Verificar se MongoDB está rodando
echo "[1] Verificando status do MongoDB..."
if command -v systemctl &> /dev/null; then
    sudo systemctl status mongodb || sudo systemctl status mongod
elif command -v service &> /dev/null; then
    sudo service mongodb status || sudo service mongod status
else
    echo "   MongoDB status: Comando não encontrado, verificando processo..."
    ps aux | grep mongod | grep -v grep
fi
echo ""

# 2. Verificar índices da collection dataset
echo "[2] Verificando índices da collection 'dataset'..."
mongo udata --quiet --eval "
    print('Índices encontrados:');
    db.dataset.getIndexes().forEach(function(idx) {
        print('  - ' + idx.name + ': ' + JSON.stringify(idx.key));
    });
"
echo ""

# 3. Verificar tamanho da collection
echo "[3] Verificando tamanho da collection 'dataset'..."
mongo udata --quiet --eval "
    var stats = db.dataset.stats();
    print('Documentos: ' + stats.count);
    print('Tamanho: ' + (stats.size / 1024 / 1024).toFixed(2) + ' MB');
    print('Tamanho médio doc: ' + (stats.avgObjSize / 1024).toFixed(2) + ' KB');
"
echo ""

# 4. Verificar operações lentas
echo "[4] Verificando operações lentas (slowms > 100ms)..."
mongo udata --quiet --eval "
    db.setProfilingLevel(0);
    db.system.profile.find({millis: {\$gt: 100}}).sort({ts: -1}).limit(5).forEach(function(op) {
        print('  Operação: ' + op.op + ' | Duração: ' + op.millis + 'ms');
        if (op.ns) print('  Namespace: ' + op.ns);
        if (op.command) print('  Command: ' + JSON.stringify(op.command).substring(0, 100));
        print('---');
    });
"
echo ""

# 5. Testar velocidade de insert
echo "[5] Testando velocidade de insert (10 documentos de teste)..."
mongo udata --quiet --eval "
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

# 6. Verificar conexões ativas
echo "[6] Verificando conexões ativas..."
mongo udata --quiet --eval "
    var conns = db.serverStatus().connections;
    print('Conexões abertas: ' + conns.current);
    print('Conexões disponíveis: ' + conns.available);
"
echo ""

# 7. Verificar locks
echo "[7] Verificando locks..."
mongo admin --quiet --eval "
    var locks = db.currentOp({
        \$or: [
            { waitingForLock: true },
            { 'locks.Global': 'w' }
        ]
    });
    if (locks.inprog.length > 0) {
        print('AVISO: ' + locks.inprog.length + ' operação(ões) bloqueada(s)!');
        locks.inprog.forEach(function(op) {
            print('  Op: ' + op.op + ' | Secs: ' + op.secs_running);
        });
    } else {
        print('Sem locks detectados.');
    }
"
echo ""

echo "======================================================================"
echo "DIAGNÓSTICO COMPLETO"
echo "======================================================================"
