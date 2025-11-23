"""
Script de diagnóstico para medir onde está o tempo sendo gasto.
"""
import time
from datetime import datetime

# Contador global para rastrear progresso
class PerformanceMonitor:
    def __init__(self):
        self.start_time = None
        self.processed_count = 0
        self.total_parse_time = 0
        self.total_process_time = 0
        self.last_checkpoint = None
        self.checkpoint_interval = 100  # Log a cada 100 datasets
        
    def start(self):
        self.start_time = time.time()
        self.last_checkpoint = self.start_time
        print(f"[DIAGNÓSTICO] Início: {datetime.now()}")
        
    def record_parse(self, parse_time):
        self.total_parse_time += parse_time
        
    def record_process(self, dataset_id, process_time):
        self.processed_count += 1
        self.total_process_time += process_time
        
        # Checkpoint periódico
        if self.processed_count % self.checkpoint_interval == 0:
            self.checkpoint()
    
    def checkpoint(self):
        now = time.time()
        elapsed_total = now - self.start_time
        elapsed_checkpoint = now - self.last_checkpoint
        
        rate = self.processed_count / elapsed_total if elapsed_total > 0 else 0
        avg_process_time = self.total_process_time / self.processed_count if self.processed_count > 0 else 0
        
        remaining = (12000 - self.processed_count) / rate if rate > 0 else 0
        
        print(f"\n{'='*70}")
        print(f"[DIAGNÓSTICO] Checkpoint #{self.processed_count}")
        print(f"{'='*70}")
        print(f"Tempo total decorrido: {elapsed_total:.1f}s ({elapsed_total/60:.1f}min)")
        print(f"Tempo desde último checkpoint: {elapsed_checkpoint:.1f}s")
        print(f"Taxa de processamento: {rate:.2f} datasets/s")
        print(f"Tempo médio por dataset: {avg_process_time:.3f}s")
        print(f"Tempo estimado restante: {remaining:.1f}s ({remaining/60:.1f}min)")
        print(f"ETA total: {(elapsed_total + remaining)/60:.1f}min")
        print(f"Tempo em parse: {self.total_parse_time:.1f}s")
        print(f"Tempo em processamento: {self.total_process_time:.1f}s")
        print(f"{'='*70}\n")
        
        self.last_checkpoint = now
        
    def summary(self):
        total_time = time.time() - self.start_time
        print(f"\n{'='*70}")
        print(f"[DIAGNÓSTICO] SUMÁRIO FINAL")
        print(f"{'='*70}")
        print(f"Total processado: {self.processed_count} datasets")
        print(f"Tempo total: {total_time:.1f}s ({total_time/60:.1f}min)")
        print(f"Tempo médio/dataset: {total_time/self.processed_count:.3f}s")
        print(f"{'='*70}\n")

# Instância global
monitor = PerformanceMonitor()

print("""
INSTRUÇÕES PARA USAR ESTE DIAGNÓSTICO:
======================================

1. Adicione no início de inner_harvest() do ine.py:
   
   from diagnose_ine_performance import monitor
   monitor.start()

2. Após o parsing (antes do loop de processamento):
   
   parse_time = time.time() - parse_start
   monitor.record_parse(parse_time)

3. Dentro do loop de processamento (em _process_dataset_with_context):
   
   start = time.time()
   result = self.process_dataset(dataset_id, **metadata)
   monitor.record_process(dataset_id, time.time() - start)
   return result

4. Execute o harvest e veja os checkpoints a cada 100 datasets.

Isto vai mostrar EXATAMENTE onde está o tempo sendo gasto!
""")
