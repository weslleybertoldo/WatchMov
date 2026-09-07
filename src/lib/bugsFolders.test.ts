import { describe, it, expect } from 'vitest';
import { parseTitle, isRealError, dayKey, fmtDay, rangeBounds, toEntries, rootFolders, subFolders, folderRows, lastSession } from './bugsFolders';

const row = (id: string, created_at: string, title: string | null, error_code = 0, error_name = 'PLAYER_START') =>
  ({ id, created_at, title, error_code, error_name });

describe('parseTitle', () => {
  it('série "Nome — T1 E49" vira pasta da série + episódio', () => {
    expect(parseTitle('Shangri-La Frontier — T1 E49')).toEqual({ show: 'Shangri-La Frontier', kind: 'tv', ep: 'T1 E49' });
  });
  it('aceita sufixo de arquivo baixado', () => {
    expect(parseTitle('Shangri-La Frontier — T1 E25 - T1E25.mp4')).toEqual({ show: 'Shangri-La Frontier', kind: 'tv', ep: 'T1 E25' });
  });
  it('chave cru antiga e:tmdb:t:e', () => {
    expect(parseTitle('e:205050:1:25')).toEqual({ show: 'Série #205050', kind: 'tv', ep: 'T1 E25' });
  });
  it('filme = só o nome; vazio = Sem título', () => {
    expect(parseTitle('Dia D')).toEqual({ show: 'Dia D', kind: 'movie', ep: null });
    expect(parseTitle(null).show).toBe('Sem título');
  });
});

describe('isRealError', () => {
  it('código ≠ 0 é erro; diagnóstico código 0 não é', () => {
    expect(isRealError({ error_code: 3001, error_name: 'ERROR_CODE_PARSING_CONTAINER_MALFORMED' })).toBe(true);
    expect(isRealError({ error_code: 0, error_name: 'PLAYER_START' })).toBe(false);
    expect(isRealError({ error_code: null, error_name: 'POS_TV_VELHA' })).toBe(false);
  });
  it('falha de cast com código 0 conta como erro pelo nome', () => {
    expect(isRealError({ error_code: 0, error_name: 'DLNA_FALHOU' })).toBe(true);
    expect(isRealError({ error_code: 0, error_name: 'RECAST_TV_PAROU' })).toBe(true);
    expect(isRealError({ error_code: 0, error_name: 'SEEK_TV_CANCELADO' })).toBe(false);
  });
});

describe('dayKey / fmtDay / rangeBounds', () => {
  it('dia local e formato BR', () => {
    const iso = new Date(2026, 8, 5, 16, 37).toISOString(); // 05/09/2026 16:37 local
    expect(dayKey(iso)).toBe('2026-09-05');
    expect(fmtDay('2026-09-05')).toBe('05/09/2026');
    expect(dayKey('lixo')).toBe('');
  });
  it('limites inclusivos: "até" = 00:00 do dia seguinte', () => {
    const b = rangeBounds('2026-09-05', '2026-09-06');
    expect(b.from).toBe(new Date(2026, 8, 5).toISOString());
    expect(b.toExclusive).toBe(new Date(2026, 8, 7).toISOString());
    expect(rangeBounds('', '')).toEqual({ from: null, toExclusive: null });
  });
});

describe('pastas', () => {
  const rows = [
    row('1', '2026-09-06T23:10:00Z', 'Shangri-La Frontier — T1 E49'),
    row('2', '2026-09-06T22:36:00Z', 'Shangri-La Frontier — T1 E50'),
    row('3', '2026-09-06T22:13:00Z', 'Shangri-La Frontier — T1 E49'),
    row('4', '2026-09-05T19:38:00Z', 'Dia D', 3001, 'ERROR_CODE_PARSING_CONTAINER_MALFORMED'),
    row('5', '2026-09-05T19:07:00Z', 'Dia D'),
    row('6', '2026-09-04T18:00:00Z', 'Dia D'),
    row('7', '2026-09-07T02:26:00Z', 'Toy Story 5'),
  ];
  const entries = toEntries(rows);

  it('1º nível: uma pasta por título, mais recente primeiro, com contagens', () => {
    const roots = rootFolders(entries);
    expect(roots.map(f => f.key)).toEqual(['Toy Story 5', 'Shangri-La Frontier', 'Dia D']);
    const serie = roots[1];
    expect(serie.kind).toBe('tv'); expect(serie.count).toBe(3); expect(serie.subs).toBe(2); expect(serie.errors).toBe(0);
    const filme = roots[2];
    expect(filme.kind).toBe('movie'); expect(filme.count).toBe(3); expect(filme.errors).toBe(1); expect(filme.subs).toBe(2);
  });
  it('série → pastas por episódio, mais recente primeiro', () => {
    const eps = subFolders(entries, 'Shangri-La Frontier');
    expect(eps.map(f => f.key)).toEqual(['T1 E49', 'T1 E50']);
    expect(eps[0].count).toBe(2);
    expect(eps[0].kind).toBe('ep');
  });
  it('filme → pastas por dia (local), rótulo DD/MM/YYYY', () => {
    const days = subFolders(entries, 'Dia D');
    expect(days.length).toBe(2);
    expect(days[0].kind).toBe('day');
    expect(days[0].label).toBe(fmtDay(days[0].key));
    expect(days[0].errors).toBe(1);
    expect(days[1].errors).toBe(0);
  });
  it('registros da subpasta, mais recente primeiro', () => {
    expect(folderRows(entries, 'Shangri-La Frontier', 'T1 E49').map(r => r.id)).toEqual(['1', '3']);
    const dia = subFolders(entries, 'Dia D')[0].key;
    expect(folderRows(entries, 'Dia D', dia).map(r => r.id)).toEqual(['4', '5']);
  });
});

describe('última reprodução (tag da pasta)', () => {
  const row = (id: string, created_at: string, title: string, error_code = 0, error_name = 'PLAYER_START') =>
    ({ id, created_at, title, error_code, error_name });
  const ERR = 'ERROR_CODE_PARSING_CONTAINER_MALFORMED';
  // Dia D 05/09 (real): 3 aberturas com erro, depois abriu de novo e tocou limpo.
  const diaD = [
    row('1', '2026-09-05T19:37:16Z', 'Dia D', 3001, ERR),
    row('2', '2026-09-05T19:37:52Z', 'Dia D'),
    row('3', '2026-09-05T19:37:52Z', 'Dia D', 3001, ERR),        // mesmo segundo do PLAYER_START: conta
    row('4', '2026-09-05T19:38:05Z', 'Dia D'),
    row('5', '2026-09-05T19:38:06Z', 'Dia D', 3001, ERR),
    row('6', '2026-09-05T19:39:45Z', 'Dia D'),
    row('7', '2026-09-05T20:02:29Z', 'Dia D', 0, 'CAST_MASTER_INFO'),
    row('8', '2026-09-05T20:02:31Z', 'Dia D', 0, 'SEEK_TV'),
  ];

  it('lastSession = do último PLAYER_START até o fim, em ordem crescente', () => {
    expect(lastSession(diaD).map(r => r.id)).toEqual(['6', '7', '8']);
    expect(lastSession([...diaD].reverse()).map(r => r.id)).toEqual(['6', '7', '8']);
    expect(lastSession(diaD.slice(0, 3)).map(r => r.id)).toEqual(['2', '3']);   // erro no mesmo segundo entra
    expect(lastSession([])).toEqual([]);
  });

  it('sem PLAYER_START (registro antigo / filtro cortou): fica o dia local do mais recente', () => {
    const rows = [
      row('a', new Date(2026, 8, 4, 22, 0).toISOString(), 'Filme', 3001, ERR),
      row('b', new Date(2026, 8, 5, 21, 0).toISOString(), 'Filme', 0, 'SEEK_TV'),
      row('c', new Date(2026, 8, 5, 21, 5).toISOString(), 'Filme', 3001, ERR),
    ];
    expect(lastSession(rows).map(r => r.id)).toEqual(['b', 'c']);
  });

  it('pasta: erros no total continuam contando, mas a tag (lastErrors) é da última reprodução', () => {
    const roots = rootFolders(toEntries(diaD));
    expect(roots[0].errors).toBe(3);
    expect(roots[0].lastErrors).toBe(0);           // "sem erro"
    const days = subFolders(toEntries(diaD), 'Dia D');
    expect(days[0].errors).toBe(3);
    expect(days[0].lastErrors).toBe(0);
  });

  it('última reprodução COM erro → tag mostra os erros dela (e só dela)', () => {
    const rows = [
      row('1', '2026-09-05T19:00:00Z', 'Filme', 3001, ERR),
      row('2', '2026-09-05T19:00:01Z', 'Filme', 3001, ERR),
      row('3', '2026-09-05T20:00:00Z', 'Filme'),
      row('4', '2026-09-05T20:00:09Z', 'Filme', 3001, ERR),
    ];
    const [f] = rootFolders(toEntries(rows));
    expect(f.errors).toBe(3);
    expect(f.lastErrors).toBe(1);
  });

  it('série: a pasta da série segue o último episódio tocado; cada episódio tem a sua', () => {
    const rows = [
      row('1', '2026-09-06T22:00:00Z', 'Friends — T1 E3'),
      row('2', '2026-09-06T22:01:00Z', 'Friends — T1 E3', 3001, ERR),
      row('3', '2026-09-06T23:00:00Z', 'Friends — T1 E4'),
      row('4', '2026-09-06T23:05:00Z', 'Friends — T1 E4', 0, 'SEEK_TV'),
    ];
    const [serie] = rootFolders(toEntries(rows));
    expect(serie.errors).toBe(1);
    expect(serie.lastErrors).toBe(0);
    const eps = subFolders(toEntries(rows), 'Friends');
    expect(eps.map(e => [e.key, e.lastErrors])).toEqual([['T1 E4', 0], ['T1 E3', 1]]);
  });
});
