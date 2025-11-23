"""
Script Python para testar a performance de save() do udata diretamente.
Isola o problema para ver se é o MongoDB ou o framework udata.
"""

import sys
import time
from datetime import datetime

# Configurar path para importar udata
sys.path.insert(0, '/home/babel/workspace/udata-front-pt')

def test_dataset_save_performance():
    """Testa a velocidade de criação/atualização de datasets."""
    
    print("="*70)
    print("TESTE DE PERFORMANCE: Dataset Save")
    print("="*70)
    print()
    
    try:
        from udata.app import create_app
        from udata.models import Dataset, License
        
        # Criar app context
        app = create_app()
        
        with app.app_context():
            print("[1] Testando criação de novo dataset...")
            
            # Teste 1: Criar novo dataset (com validação)
            start = time.time()
            ds1 = Dataset()
            ds1.title = "Test Dataset Performance 1"
            ds1.slug = f"test-performance-{int(time.time())}"
            ds1.description = "Test description"
            ds1.license = License.guess('cc-by')
            ds1.tags = ['test', 'performance']
            ds1.frequency = 'unknown'
            ds1.resources = []
            ds1.save()  # Com validação
            time1_with_validation = time.time() - start
            
            print(f"   Com validação: {time1_with_validation:.3f}s")
            
            # Teste 2: Atualizar dataset existente (sem validação)
            start = time.time()
            ds1.title = "Test Dataset Performance 1 - Updated"
            ds1.save(validate=False)  # Sem validação
            time2_without_validation = time.time() - start
            
            print(f"   Sem validação: {time2_without_validation:.3f}s")
            
            # Teste 3: get_or_create pattern (como o harvester faz)
            start = time.time()
            ds2 = Dataset.objects(slug=ds1.slug).first()
            if not ds2:
                ds2 = Dataset()
                ds2.slug = ds1.slug
            ds2.title = "Test Dataset Performance 2"
            ds2.description = "Test description 2"
            ds2.license = License.guess('cc-by')
            ds2.tags = ['test', 'performance']
            ds2.frequency = 'unknown'
            ds2.resources = []
            ds2.save(validate=False)
            time3_get_and_save = time.time() - start
            
            print(f"   Get + Save (sem validação): {time3_get_and_save:.3f}s")
            
            # Teste 4: Query para ver se está lento
            start = time.time()
            ds_found = Dataset.objects(slug=ds1.slug).first()
            time4_query = time.time() - start
            
            print(f"   Query por slug: {time4_query:.3f}s")
            
            # Limpeza
            ds1.delete()
            
            print()
            print("="*70)
            print("RESULTADOS")
            print("="*70)
            print(f"Criar + Save (com validação):    {time1_with_validation:.3f}s")
            print(f"Update + Save (sem validação):   {time2_without_validation:.3f}s")
            print(f"Get + Save (sem validação):      {time3_get_and_save:.3f}s")
            print(f"Query simples:                   {time4_query:.3f}s")
            print()
            
            if time3_get_and_save > 2.0:
                print("⚠️  PROBLEMA DETECTADO: Get + Save está muito lento!")
                print("   Possíveis causas:")
                print("   - Índices MongoDB ausentes/ruins")
                print("   - MongoDB em servidor remoto com alta latência")
                print("   - MongoDB sobrecarregado")
            else:
                print("✅ Performance parece OK. Problema pode estar em outro lugar.")
            print()
            
    except Exception as e:
        print(f"❌ Erro ao executar teste: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    test_dataset_save_performance()
