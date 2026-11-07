import type { SVGProps } from 'react';

// Ícone do controle remoto no traço do lucide (o lucide não tem um): corpo, o direcional e dois botões.
export default function IconeControle(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="7" y="2" width="10" height="20" rx="3" />
      <circle cx="12" cy="8" r="2.5" />
      <path d="M10 14.5h.01M14 14.5h.01M10 18h.01M14 18h.01" />
    </svg>
  );
}
