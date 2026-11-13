/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadTs } = require('./support/load-ts.cjs');
const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

// What these tests are, and are not.
//  - The search tests run the real search module over the real bundled content and a
//    few small fixtures, so ranking and the "no result" cases are checked as shipped.
//  - The dataset tests are STRUCTURAL: ids, required fields, references between
//    entries and sources, identifier formats, safe links, scope guard. They cannot
//    tell whether a summary is scientifically right. That was checked by reading each
//    cited PubMed record (see src/research/library/sources.ts and the project log);
//    a passing test here says nothing more than that the data is well-formed.
//  - The screen tests read source text. They pin decisions a refactor could drop and
//    do not render anything.

const { searchLibrary, normalizeText, wordMatches, STOP_WORDS } = loadTs('src/research/library/search.ts');
const { LIBRARY_ENTRIES } = loadTs('src/research/library/entries.ts');
const { LIBRARY_SOURCES } = loadTs('src/research/library/sources.ts');
const { validateLibrary, MAX_ANSWER_LENGTH } = loadTs('src/research/library/validate.ts');
const links = loadTs('src/research/library/links.ts');
const format = loadTs('src/research/library/format.ts');

// Arrays made inside the vm have another realm's prototype; copy them so deepEqual compares by value.
const ids = (result) => Array.from(result.hits.map((hit) => hit.entry.id));
const top = (query) => ids(searchLibrary(LIBRARY_ENTRIES, query))[0];
const clone = (value) => JSON.parse(JSON.stringify(value));

// ── Turkish casing, diacritics, aliases ──────────────────────────────────

test('Turkish upper and lower case fold to the same word', () => {
  assert.equal(normalizeText('TÜKENİŞ'), 'tukenis');
  assert.equal(normalizeText('tükeniş'), 'tukenis');
  assert.equal(normalizeText('Tukenis'), 'tukenis');
  // Dotless and dotted I: ISINMA is "ısınma", İĞNE is "iğne".
  assert.equal(normalizeText('ISINMA'), 'isinma');
  assert.equal(normalizeText('ısınma'), 'isinma');
  assert.equal(normalizeText('İĞNE'), 'igne');
  assert.equal(normalizeText('Çalışma, ÖĞÜT; şart!'), 'calisma ogut sart');
});

test('typing with or without Turkish letters finds the same topic', () => {
  for (const query of ['tükenişe', 'TÜKENİŞE', 'tukenise', 'Tükenişe kadar']) {
    assert.equal(top(query), 'training-to-failure', query);
  }
  for (const query of ['ısınma', 'ISINMA', 'isinma', 'Isinma']) {
    assert.equal(top(query), 'warm-up', query);
  }
  assert.deepEqual(ids(searchLibrary(LIBRARY_ENTRIES, 'UYKU')), ids(searchLibrary(LIBRARY_ENTRIES, 'uyku')));
});

test('a word with an ending still matches its stem, but a short stem is not stretched over a verb', () => {
  assert.ok(wordMatches('setler', 'set'));
  assert.ok(wordMatches('setlerin', 'set'));
  assert.ok(wordMatches('tukenise', 'tukenis'));
  assert.ok(wordMatches('dinlenmeliyim', 'dinlen'));
  assert.ok(wordMatches('dinlen', 'dinlenme'), 'a word typed so far');
  assert.ok(!wordMatches('din', 'dinlenme'), 'three letters typed is not a prefix match');
  // "almalıyım" (I should take) must not reach "alma" (as in "kilo alma").
  assert.ok(!wordMatches('almaliyim', 'alma'));
  assert.ok(!wordMatches('setup', 'set'));
});

test('maintained aliases lead to their topic', () => {
  assert.equal(top('kaç tekrar yapmalıyım'), 'repetition-range');
  assert.equal(top('rir nedir'), 'reps-in-reserve');
  assert.equal(top('kilo aldım kas mı yağ mı'), 'body-weight-changes');
  assert.equal(top('tartıda kilo arttı kas mı'), 'body-weight-changes');
  assert.equal(top('progressive overload nedir'), 'progression');
  assert.equal(top('ısınma yaralanmayı önler mi'), 'warm-up');
});

// ── The three representative questions ────────────────────────────────────

test('"Kas geliştirmek için haftada kaç set?" finds the weekly volume topic and nothing else', () => {
  const result = searchLibrary(LIBRARY_ENTRIES, 'Kas geliştirmek için haftada kaç set?');
  assert.equal(result.kind, 'matches');
  assert.deepEqual(ids(result), ['weekly-volume']);
});

test('"Her set tükenişe gitmek şart mı?" finds the failure topic', () => {
  const result = searchLibrary(LIBRARY_ENTRIES, 'Her set tükenişe gitmek şart mı?');
  assert.equal(result.kind, 'matches');
  assert.deepEqual(ids(result), ['training-to-failure']);
});

test('"Setler arasında ne kadar dinlenmeliyim?" finds the rest topic and not volume', () => {
  const result = searchLibrary(LIBRARY_ENTRIES, 'Setler arasında ne kadar dinlenmeliyim?');
  assert.equal(result.kind, 'matches');
  assert.deepEqual(ids(result), ['rest-between-sets']);
});

test('results list the typed words they matched and carry no confidence figure', () => {
  const hit = searchLibrary(LIBRARY_ENTRIES, 'Setler arasında ne kadar dinlenmeliyim?').hits[0];
  assert.deepEqual([...hit.matchedWords], ['Setler', 'arasında', 'dinlenmeliyim']);
  for (const file of ['app/(app)/research/index.tsx', 'app/(app)/research/[id].tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /\.score\b|güven|confidence|%\s*eşleş/i, file);
  }
});

// ── Ranking, multi-topic ─────────────────────────────────────────────────

test('a topic or keyword match outranks a passing mention in body text', () => {
  const entry = (id, title, keywords, text) => ({
    id, title, answer: 'Kısa yanıt', explanation: [{ text, sourceIds: ['s'] }], context: 'Bağlam',
    limitations: ['Sınır'], keywords, aliases: ['a b', 'c d'], sourceIds: ['s'], sourcesCheckedOn: '2026-01-01',
  });
  const library = [
    entry('only-body', 'Başka bir konu mu?', ['alfa', 'beta', 'gama'], 'Burada dinlenme sözcüğü geçer, konu bu değil.'),
    entry('title', 'Dinlenme süresi ne olmalı?', ['alfa', 'beta', 'gama'], 'Metin.'),
    entry('keyword', 'Üçüncü konu mu?', ['dinlenme', 'beta', 'gama'], 'Metin.'),
  ];
  // Body-only entries are not listed at all while any entry matches by title or keyword.
  assert.deepEqual(ids(searchLibrary(library, 'dinlenme')), ['title', 'keyword']);
  // With no title/keyword match anywhere, text matches are used, but only if two words are covered.
  assert.deepEqual(ids(searchLibrary(library, 'burada sözcüğü')), ['only-body']);
  assert.equal(searchLibrary(library, 'dinlenme').hits[0].score > searchLibrary(library, 'dinlenme').hits[1].score, true);
});

test('a question about two topics returns both, each ranked by how well it fits', () => {
  const result = searchLibrary(LIBRARY_ENTRIES, 'Haftada kaç set yapmalıyım ve setler arası ne kadar dinlenmeliyim?');
  assert.equal(result.kind, 'matches');
  assert.deepEqual([...ids(result)].sort(), ['rest-between-sets', 'weekly-volume']);
  const fail = searchLibrary(LIBRARY_ENTRIES, 'tükeniş ve uyku');
  assert.deepEqual([...ids(fail)].sort(), ['sleep-and-recovery', 'training-to-failure']);
});

test('a generic word that fits several topics lists them rather than picking one', () => {
  const result = searchLibrary(LIBRARY_ENTRIES, 'kas');
  assert.ok(result.hits.length > 3);
  assert.equal(new Set(ids(result)).size, result.hits.length);
});

// ── Empty, filler-only, unsupported ──────────────────────────────────────

test('an empty or blank search lists the whole library in order', () => {
  for (const query of ['', '   ', '\n\t']) {
    const result = searchLibrary(LIBRARY_ENTRIES, query);
    assert.equal(result.kind, 'all');
    assert.deepEqual(ids(result), Array.from(LIBRARY_ENTRIES.map((entry) => entry.id)));
    assert.deepEqual([...result.unmatchedWords], []);
  }
});

test('a search made only of filler words or symbols has nothing to search, and shows no topic', () => {
  for (const query of ['ne kadar nasıl', 'Ne? Mi? Için', '???', '!!! ...', 'bir de bu']) {
    const result = searchLibrary(LIBRARY_ENTRIES, query);
    assert.equal(result.kind, 'no-terms', query);
    assert.equal(result.hits.length, 0, query);
  }
});

test('filler words are left out without changing what a meaningful query finds', () => {
  const withFiller = searchLibrary(LIBRARY_ENTRIES, 'Her set tükenişe gitmek şart mı?');
  const without = searchLibrary(LIBRARY_ENTRIES, 'set tükenişe');
  assert.deepEqual(ids(withFiller), ids(without));
  assert.ok([...withFiller.ignoredWords].includes('şart'));
  // A word that is also meaningful is not treated as filler.
  for (const word of ['set', 'dinlenme', 'uyku', 'kilo', 'tekrar', 'rir', 'ısınma']) {
    assert.ok(!STOP_WORDS.has(normalizeText(word)), word);
  }
});

test('questions the library does not cover get no result, not the nearest topic', () => {
  const unsupported = [
    'kreatin kaç gram',
    'kreatin kaç set',
    "Mars'ta kaç set yapılır",
    'protein ne kadar almalıyım',
    'bel fıtığı için hangi egzersiz',
    'steroid kullanmak',
    'what is the capital of france',
    'diz ağrısı rehabilitasyon',
  ];
  for (const query of unsupported) {
    const result = searchLibrary(LIBRARY_ENTRIES, query);
    assert.equal(result.kind, 'none', query);
    assert.equal(result.hits.length, 0, query);
  }
  assert.ok([...searchLibrary(LIBRARY_ENTRIES, 'kreatin kaç gram').unmatchedWords].includes('kreatin'));
});

test('a mostly supported question shows its results and names the word the library does not know', () => {
  const result = searchLibrary(LIBRARY_ENTRIES, 'Kas geliştirmek için haftada kaç set ve kreatin');
  assert.equal(result.kind, 'matches');
  assert.equal(result.hits[0].entry.id, 'weekly-volume');
  assert.deepEqual([...result.unmatchedWords], ['kreatin']);
});

// ── Changing and clearing a query leaves nothing stale ───────────────────

test('each search depends only on its own query and never alters the library', () => {
  const before = JSON.stringify(LIBRARY_ENTRIES);
  const first = searchLibrary(LIBRARY_ENTRIES, 'uyku');
  searchLibrary(LIBRARY_ENTRIES, 'tükeniş');
  const cleared = searchLibrary(LIBRARY_ENTRIES, '');
  const again = searchLibrary(LIBRARY_ENTRIES, 'uyku');
  assert.deepEqual(ids(first), ['sleep-and-recovery']);
  assert.equal(cleared.kind, 'all');
  assert.equal(cleared.hits.length, LIBRARY_ENTRIES.length);
  assert.deepEqual(ids(again), ids(first));
  assert.equal(JSON.stringify(LIBRARY_ENTRIES), before);
  // A longer or different query does not keep the earlier topic.
  assert.ok(!ids(searchLibrary(LIBRARY_ENTRIES, 'uyku kreatin')).includes('sleep-and-recovery'));
  assert.deepEqual(ids(searchLibrary(LIBRARY_ENTRIES, 'tükeniş')), ['training-to-failure']);
});

test('the screen derives its list from the query on every render, with no stored result to go stale', () => {
  const source = read('app/(app)/research/index.tsx');
  assert.match(source, /useMemo\(\(\) => searchLibrary\(LIBRARY_ENTRIES, query\), \[query\]\)/);
  assert.doesNotMatch(source, /useEffect|useLayoutEffect|setResult|setHits|setTimeout|debounce/);
  // Clearing is one action that empties the query, from the field's button and from the empty state.
  assert.equal((source.match(/setQuery\(""\)/g) ?? []).length, 2);
  assert.match(source, /accessibilityLabel="Aramayı temizle"/);
  assert.match(source, /Aramayı temizle ve tüm konuları göster/);
});

// ── The dataset ──────────────────────────────────────────────────────────

test('the shipped library is well-formed (structure only)', () => {
  assert.deepEqual(Array.from(validateLibrary(LIBRARY_ENTRIES, LIBRARY_SOURCES)), []);
});

test('the first release has 10 to 12 topics with unique stable ids', () => {
  assert.ok(LIBRARY_ENTRIES.length >= 10 && LIBRARY_ENTRIES.length <= 12, String(LIBRARY_ENTRIES.length));
  const entryIds = LIBRARY_ENTRIES.map((entry) => entry.id);
  assert.equal(new Set(entryIds).size, entryIds.length);
  for (const id of entryIds) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(!entryIds.includes('pubmed'), 'the id "pubmed" is the PubMed feed route');
});

test('every entry has what a reader needs: question, short answer, explanation, context, limits, sources, check date', () => {
  for (const entry of LIBRARY_ENTRIES) {
    assert.ok(entry.title.trim().endsWith('?'), entry.id);
    assert.ok(entry.answer.length > 0 && entry.answer.length <= MAX_ANSWER_LENGTH, entry.id);
    assert.ok(entry.explanation.length >= 1, entry.id);
    assert.ok(entry.context.length > 0, entry.id);
    assert.ok(entry.limitations.length >= 1, entry.id);
    assert.ok(entry.keywords.length >= 3 && entry.aliases.length >= 2, entry.id);
    assert.ok(entry.sourceIds.length >= 1, entry.id);
    assert.match(entry.sourcesCheckedOn, /^\d{4}-\d{2}-\d{2}$/, entry.id);
  }
});

test('every explanation paragraph names sources that belong to its entry, and every source is used', () => {
  const known = new Set(LIBRARY_SOURCES.map((source) => source.id));
  const used = new Set();
  for (const entry of LIBRARY_ENTRIES) {
    for (const part of entry.explanation) {
      assert.ok(part.sourceIds.length >= 1, entry.id);
      for (const sourceId of part.sourceIds) {
        assert.ok(entry.sourceIds.includes(sourceId), `${entry.id} cites ${sourceId}`);
        assert.ok(known.has(sourceId), sourceId);
      }
    }
    entry.sourceIds.forEach((sourceId) => used.add(sourceId));
  }
  assert.deepEqual([...known].filter((sourceId) => !used.has(sourceId)), []);
});

test('every source is a PubMed-identified publication whose links are the two safe shapes', () => {
  for (const source of LIBRARY_SOURCES) {
    assert.match(source.pmid, /^[1-9]\d{0,8}$/, source.id);
    assert.match(source.doi, /^10\.\d{4,9}\/\S+$/, source.id);
    const pubmed = links.pubmedUrl(source.pmid);
    const doi = links.doiUrl(source.doi);
    assert.equal(pubmed, `https://pubmed.ncbi.nlm.nih.gov/${source.pmid}/`);
    assert.equal(doi, `https://doi.org/${source.doi}`);
    assert.ok(links.isSafeLibraryUrl(pubmed) && links.isSafeLibraryUrl(doi), source.id);
    assert.ok(source.year >= 1990 && source.year <= 2026, source.id);
    assert.ok(source.title.length > 10 && source.journal.length > 2 && source.authors.length > 2, source.id);
  }
  assert.equal(new Set(LIBRARY_SOURCES.map((source) => source.pmid)).size, LIBRARY_SOURCES.length);
});

test('links are built only from validated identifiers and only to PubMed or doi.org over https', () => {
  assert.equal(links.pubmedUrl('41843416'), 'https://pubmed.ncbi.nlm.nih.gov/41843416/');
  assert.equal(links.doiUrl('10.1249/MSS.0000000000003897'), 'https://doi.org/10.1249/MSS.0000000000003897');
  for (const bad of ['', '0', '12a', '1234567890', '12345/../x', ' 123', 'javascript:alert(1)']) {
    assert.equal(links.pubmedUrl(bad), null, bad);
  }
  for (const bad of ['', 'javascript:alert(1)', '10.1/abc', '10.1000/', '10.1000/a b', '10.1000/a?x=1', '10.1000/<s>', 'https://evil.example/10.1000/a']) {
    assert.equal(links.doiUrl(bad), null, bad);
  }
  for (const bad of [
    'http://pubmed.ncbi.nlm.nih.gov/123/',
    'https://pubmed.ncbi.nlm.nih.gov.evil.example/123/',
    'https://evil.example/https://pubmed.ncbi.nlm.nih.gov/123/',
    'https://pubmed.ncbi.nlm.nih.gov/123/?next=https://evil.example',
    'https://doi.org/10.1000/abc?redirect=1',
    'https://dx.doi.org/10.1000/abc',
    'javascript:alert(1)',
    'https://doi.org@evil.example/10.1000/abc',
  ]) {
    assert.equal(links.isSafeLibraryUrl(bad), false, bad);
  }
});

test('the validator catches broken content (it is not a rubber stamp)', () => {
  const broken = (change) => {
    const entries = clone(LIBRARY_ENTRIES);
    const sources = clone(LIBRARY_SOURCES);
    change(entries, sources);
    return validateLibrary(entries, sources);
  };
  const has = (problems, text) => problems.some((problem) => problem.includes(text));

  assert.ok(has(broken((e) => { e[1].id = e[0].id; }), 'duplicate id'));
  assert.ok(has(broken((e) => { e[0].id = 'pubmed'; }), 'reserved'));
  assert.ok(has(broken((e) => { e[0].id = 'Weekly Volume'; }), 'kebab-case'));
  assert.ok(has(broken((e) => { e[0].title = 'Haftalık set sayısı'; }), 'must be a question'));
  assert.ok(has(broken((e) => { e[0].answer = 'x'.repeat(MAX_ANSWER_LENGTH + 1); }), 'not short'));
  assert.ok(has(broken((e) => { e[0].limitations = []; }), 'limitations'));
  assert.ok(has(broken((e) => { e[0].sourcesCheckedOn = '2026-02-31'; }), 'real YYYY-MM-DD'));
  assert.ok(has(broken((e) => { e[0].sourceIds = ['nope']; }), 'unknown source'));
  assert.ok(has(broken((e) => { e[0].sourceIds = []; }), 'cites no source'));
  assert.ok(has(broken((e) => { e[0].explanation[0].sourceIds = []; }), 'names no source'));
  assert.ok(has(broken((e) => { e[0].explanation[0].sourceIds = ['acsm-2009']; }), "not in the entry's sources"));
  assert.ok(has(broken((e) => { e[0].sourceIds.push('hall-2008-weight-loss'); }), 'no explanation rests on it'));
  assert.ok(has(broken((e, s) => { s[0].pmid = '12; drop'; }), 'not a PubMed id'));
  assert.ok(has(broken((e, s) => { s[0].doi = 'javascript:alert(1)'; }), 'malformed'));
  assert.ok(has(broken((e, s) => { s[1].pmid = s[0].pmid; }), 'appears twice'));
  assert.ok(has(broken((e, s) => { s[0].year = 3026; }), 'not plausible'));
  assert.ok(has(broken((e, s) => { s[0].kind = 'blog-post'; }), 'unknown kind'));
  assert.ok(has(broken((e, s) => { s.push({ ...s[0], id: 'unused', pmid: '999' }); }), 'not cited by any entry'));
  assert.ok(has(broken((e) => { e[0].limitations.push('Bu bir rehabilitasyon programıdır.'); }), 'scope'));
  assert.ok(has(broken((e) => { e[0].answer += ' Günlük 5 g kreatin alın.'; }), 'scope'));
  assert.ok(has(validateLibrary([], LIBRARY_SOURCES), 'no entries'));
});

test('the library stays within scope: general adult resistance training', () => {
  const everything = LIBRARY_ENTRIES.map((entry) =>
    [entry.title, entry.answer, entry.context, ...entry.limitations, ...entry.explanation.map((part) => part.text)].join(' '),
  ).join(' ');
  for (const word of ['rehabilitasyon', 'tedavi', 'steroid', 'anabolik', 'takviye', 'kreatin']) {
    assert.ok(!everything.toLowerCase().includes(word), word);
  }
});

test('source dates and citation lines read correctly in Turkish', () => {
  assert.equal(format.formatCheckedOn('2026-11-02'), '2 Kasım 2026');
  assert.equal(format.formatCheckedOn('2026-01-15'), '15 Ocak 2026');
  assert.equal(format.formatCheckedOn('2026-13-01'), '2026-13-01');
  assert.equal(format.authorsTr('Currier BS et al.'), 'Currier BS ve ark.');
  assert.equal(format.authorsTr('American College of Sports Medicine'), 'American College of Sports Medicine');
  assert.equal(format.citationLine({ authors: 'Hall KD', year: 2008, journal: 'Int J Obes (Lond)' }), 'Hall KD · 2008 · Int J Obes (Lond)');
  assert.equal(format.sourceKindLabel('meta-analysis'), 'Meta-analiz');
});

// ── Screens (source-level) ───────────────────────────────────────────────

test('the library screen is the Research experience: Turkish copy, light theme, local search, separate PubMed entry', () => {
  const source = read('app/(app)/research/index.tsx');
  assert.match(source, /lightTheme/);
  assert.doesNotMatch(source, /romanTheme|romanFont|useRomanFonts/);
  for (const text of [
    'Kütüphanede ara',
    'konu bulundu',
    'Bu soruyla eşleşen içerik yok.',
    'PubMed yayınları (İngilizce)',
    'bir uzman tarafından gözden geçirilmedi',
    'yazdıklarınız gönderilmez',
  ]) {
    assert.ok(source.includes(text), text);
  }
  // Searching is local: no network, no API module, no PubMed feed here.
  assert.doesNotMatch(source, /fetch\(|src\/api|api\/research|createPublicationFeed|WebBrowser|Linking/);
  // The count line and the clear action exist.
  assert.match(source, /\$\{result\.hits\.length\} konu/);
  assert.match(source, /MIN_TOUCH = 44/);
});

test('the topic screen shows sources, original-language labels, limitations and safe links only', () => {
  const source = read('app/(app)/research/[id].tsx');
  for (const text of [
    'Kısa yanıt',
    'Kapsam ve bağlam',
    'Sınırlamalar',
    'Kaynaklara dayalı Türkçe açıklama',
    'kişisel tavsiye değildir',
    'Yayıncı sayfası (DOI)',
    'PubMed kaydı',
    'tarihinde PubMed’de kontrol edildi',
    'tam metinler incelenmemiştir',
  ]) {
    assert.ok(source.includes(text), text);
  }
  assert.match(source, /originalLanguageNote/);
  assert.match(source, /openLibrarySource\(url\)/);
  assert.match(source, /accessibilityRole="link"/);
  assert.match(source, /textDecorationLine: "underline"/);
  assert.doesNotMatch(source, /fetch\(|Linking|WebBrowser|source_url/);
  const opener = read('src/research/openExternal.ts');
  assert.match(opener, /if \(!isSafeLibraryUrl\(url\)\) return false;/);
});

test('the live PubMed feed is untouched in behaviour and is not queried by the library', () => {
  const feedScreen = read('app/(app)/research/pubmed.tsx');
  assert.match(feedScreen, /createPublicationFeed\(researchApi\.fetchPublications\)/);
  assert.match(feedScreen, /pubmedLink\(publication\)/);
  for (const file of [
    'src/research/library/search.ts',
    'src/research/library/entries.ts',
    'src/research/library/sources.ts',
    'src/research/library/validate.ts',
    'src/research/library/links.ts',
    'src/research/library/format.ts',
    'app/(app)/research/index.tsx',
  ]) {
    assert.doesNotMatch(read(file), /api\/research|publicationFeed|fetch\(|XMLHttpRequest|axios/, file);
  }
});

test('the Start Workout home keeps its Research entry', () => {
  const home = read('app/(app)/(tabs)/index.tsx');
  assert.match(home, /router\.push\("\/research"\)/);
  assert.match(home, /Research, explore training research/);
});

test('the library is independent of the personal analysis', () => {
  for (const file of ['src/research/library/search.ts', 'src/research/library/entries.ts', 'app/(app)/research/index.tsx', 'app/(app)/research/[id].tsx']) {
    assert.doesNotMatch(read(file), /diagnosis|analytics|useAuth|AuthContext|weeklyVolume|api\/workouts|api\/body/i, file);
  }
});
