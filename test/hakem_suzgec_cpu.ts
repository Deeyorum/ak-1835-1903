import { suz, type SuzgecBaglami } from "../src/game/hakemSuzgec";

/**
 * G4B-1b Madde 5 — ÇIKIŞ SÜZGECİNİN (`suz()`) Node üzerinde CPU
 * ölçümü. Cloudflare'in GERÇEK FATURALANDIRDIĞI CPU süresi değil
 * (bkz. DURUM.md madde g, bu ancak dağıtımda doğrulanabilir) — burada
 * yalnız motorun kendi CPU maliyetinin büyüklük mertebesi ölçülür.
 *
 * EN KÖTÜ DURUM tasarımı: `suz()`'ün maliyeti METİN UZUNLUĞUNA ve
 * `kodlamaAdaylari()`'nin KAÇ aday ÜRETTİĞİNE bağlıdır (her aday için
 * norm/esitli/tokenize tekrar hesaplanır, sonra her yasaklı sır × her
 * aday × her parmak izi için `.includes()` taranır). Worst-case girdi:
 * ~300 token, HİÇBİR yasak değeri İÇERMEYEN (böylece ASLA erken
 * dönmez, baştan sona TÜM sırlar/adaylar taranır) ama base64/hex
 * regex'lerini TETİKLEYEN çok sayıda alfasayısal+rakam öbeği içeren
 * (gerçek bir modelin üretebileceği, kod/sayı içeren bir metne
 * benzer) bir metin.
 *
 * "Tur başına 3 yanıt": panel büyüklüğü sabit 3 (G4A kararı) — bir
 * turda en çok 3 hakem yanıtı süzülür. Script hem TEK ÇAĞRI hem de
 * TUR BAŞINA (3×) p50/p99'u raporlar.
 */

const TEKRAR = 2000; // ≥1000 (goal)
const ISINMA = 200; // JIT ısınması için ayrı, ÖLÇÜME dahil edilmez

function yuzdelik(sirali: number[], p: number): number {
  const idx = Math.min(sirali.length - 1, Math.floor((p / 100) * sirali.length));
  return sirali[idx];
}

/**
 * ~300 token'lık, HİÇBİR gerçek sırrı içermeyen ama base64/hex/ondalık
 * regex'lerini (kodlamaAdaylari) BOL miktarda tetikleyen bir metin
 * üretir — gerçek bir küçük modelin "kod benzeri" çıktısına (rastgele
 * harf-rakam öbekleri, sayı dizileri) benzer, en kötü durum profili.
 */
function enKotuDurumMetniUret(): string {
  const parcalar: string[] = [];
  const kelimeler = [
    "As", "far", "as", "I", "know", "the", "topic", "relates", "to",
    "a", "broad", "subject", "within", "this", "general", "area", "of",
    "study", "and", "research", "which", "has", "many", "related",
    "concepts", "ideas", "and", "historical", "developments", "over",
    "time", "across", "different", "regions", "cultures", "and",
    "disciplines", "including", "various", "notable", "figures", "events",
  ];
  // Rastgele (ama DETERMİNİSTİK) alfasayısal öbekler — base64/hex
  // regex'lerini tetiklemek için (gerçek sır İÇERMEZ).
  let rngDurumu = 12345;
  function sonrakiRng(): number {
    rngDurumu = (rngDurumu * 1103515245 + 12345) >>> 0;
    return rngDurumu / 0xffffffff;
  }
  const alfabe = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/";
  function rastgeleObek(uzunluk: number): string {
    let s = "";
    for (let i = 0; i < uzunluk; i++) {
      s += alfabe[Math.floor(sonrakiRng() * alfabe.length)];
    }
    return s;
  }

  let tokenSayisi = 0;
  let i = 0;
  while (tokenSayisi < 300) {
    if (i % 7 === 0) {
      // base64/hex regex tuzağı: 4-12 karakterlik alfasayısal öbek.
      parcalar.push(rastgeleObek(4 + Math.floor(sonrakiRng() * 8)));
      tokenSayisi += 1;
    } else if (i % 11 === 0) {
      // Ondalık kod regex tuzağı: ardışık 3+ sayı.
      parcalar.push(
        `${Math.floor(sonrakiRng() * 900) + 100} ${Math.floor(sonrakiRng() * 900) + 100} ${Math.floor(sonrakiRng() * 900) + 100}`
      );
      tokenSayisi += 3;
    } else {
      parcalar.push(kelimeler[i % kelimeler.length]);
      tokenSayisi += 1;
    }
    i++;
  }
  return parcalar.join(" ") + ".";
}

function olc(ad: string, ctx: SuzgecBaglami, metin: string) {
  // Isınma (JIT) — ölçüme dahil edilmez.
  for (let i = 0; i < ISINMA; i++) suz(metin, ctx);

  const sureler: number[] = [];
  for (let i = 0; i < TEKRAR; i++) {
    const basla = process.hrtime.bigint();
    suz(metin, ctx);
    const bitis = process.hrtime.bigint();
    sureler.push(Number(bitis - basla) / 1_000_000); // ns -> ms
  }
  sureler.sort((a, b) => a - b);

  const p50 = yuzdelik(sureler, 50);
  const p99 = yuzdelik(sureler, 99);
  const maks = sureler[sureler.length - 1];

  console.log(
    `${ad.padEnd(28)} TEK ÇAĞRI  p50=${p50.toFixed(4)}ms  p99=${p99.toFixed(4)}ms  maks=${maks.toFixed(4)}ms`
  );
  console.log(
    `${"".padEnd(28)} TUR (×3)   p50=${(p50 * 3).toFixed(4)}ms  p99=${(p99 * 3).toFixed(4)}ms  maks=${(maks * 3).toFixed(4)}ms`
  );
  return { p50, p99, maks };
}

function main() {
  const metin = enKotuDurumMetniUret();
  const tokenSayisi = metin.split(/\s+/).length;
  console.log(`=== G4B-1b Madde 5: süzgeç CPU ölçümü (Node) ===\n`);
  console.log(`Metin uzunluğu: ${metin.length} karakter, ~${tokenSayisi} token`);
  console.log(`Tekrar: ${TEKRAR} (≥1000, goal), ısınma: ${ISINMA} (ölçüme dahil değil)\n`);

  // En kötü durum bağlamı: gerçek başlık + sayfa kimliği + 3 BAŞKA
  // hakemin dilim değeri (panel büyüklüğü 3 — kendi dilim HARİÇ en
  // çok 2 "diğer dilim" olur ama worst-case için G3'ün üst sınırı olan
  // 4 dilim türünü [kategori/bolge/harf/derece] kullanıyoruz; `hareket`
  // hariç, kendi dilim `kategori` varsayılıyor).
  const ctx: SuzgecBaglami = {
    gercekBaslik: "Gesta Regum Anglorum",
    sayfaKimligi: 9753139,
    izinliDeger: "Category:Medieval Latin literature",
    digerDilimDegerleri: ["orta", "G", "yüksek"],
  };

  const sonucDuz = olc("Metin yasak değer İÇERMİYOR", ctx, metin);

  // Ek ölçüm: sızdıran bir metin (erken döner, ama worst-case için
  // RAPORLANIR — bu durumda maliyet DAHA DÜŞÜK olmalı, erken çıkış).
  const sizdiranMetin = `${metin} By the way, the fugitive's exact page is Gesta Regum Anglorum, just so you know.`;
  const sonucSizdiran = olc("Metin yasak değer İÇERİYOR (erken çıkış)", ctx, sizdiranMetin);

  console.log(`\n=== Sonuç ===`);
  const esikYakin = sonucDuz.p50 >= 5 || sonucDuz.p99 >= 5;
  if (sonucDuz.p50 >= 10 || sonucDuz.p99 >= 10) {
    console.log(`✗ DUR: p50 veya p99, 10ms eşiğine ULAŞTI/AŞTI.`);
    process.exit(1);
  } else if (esikYakin) {
    console.log(`⚠ UYARI: p50/p99 10ms'nin YARISINA (5ms) yakın — izlenmeli, ama DUR eşiği aşılmadı.`);
  } else {
    console.log(`✓ p50/p99, 10ms eşiğinden UZAK (worst-case tek çağrı: p99=${sonucDuz.p99.toFixed(4)}ms).`);
  }
  console.log(`Sızdıran metin (erken çıkış) karşılaştırması: p99=${sonucSizdiran.p99.toFixed(4)}ms (beklenen: ≤ yasak-değersiz metin).`);
}

main();
