import { useEffect, useState } from 'react';
import { isTv } from '@/lib/device';

// W4 do raio-x (02/11/2026, Skill-wbs-navegacao): popup feito à mão (não é Radix) sai animado — continua montado com
// data-state="closed" o tempo da animação de saída e só então some (o Radix faz isso sozinho nos diálogos). Na TV sai na
// hora: lá não tem animação de saída e a caixa não pode ficar no caminho das setas.
export const SAIDA_MS = 150;

export function useSaidaAnimada(aberto: boolean, ms: number = isTv() ? 0 : SAIDA_MS): { montado: boolean; estado: 'open' | 'closed' } {
  const [montado, setMontado] = useState(aberto);
  useEffect(() => {
    if (aberto) { setMontado(true); return; }
    if (ms <= 0) { setMontado(false); return; }
    const t = setTimeout(() => setMontado(false), ms);
    return () => clearTimeout(t);
  }, [aberto, ms]);
  return { montado: aberto || montado, estado: aberto ? 'open' : 'closed' };
}

// O último valor que não era vazio: o diálogo aberto por um valor (servidor, TV…) que vira null ao fechar continua
// mostrando o texto durante a animação de saída — sem isto o título piscava "Remover ?" enquanto a caixa sumia.
export function useUltimoValor<T>(v: T | null | undefined): T | null {
  const [ultimo, setUltimo] = useState<T | null>(v ?? null);
  if (v != null && v !== ultimo) setUltimo(v);
  return v ?? ultimo;
}
