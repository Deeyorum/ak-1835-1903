/**
 * G4B-2b — BAĞIMSIZ DENETÇİ.
 *
 * Amaç: bir yanıtta yasak değer olup olmadığını, `src/game/hakemSuzgec.ts`'e
 * HİÇ DOKUNMADAN, ONDAN HİÇBİR ŞEY İÇE AKTARMADAN kontrol etmek. Süzgecin
 * kendi yardımcılarını (`normalize`, `parmakIzleri`, `kodlamaAdaylari`)
 * yeniden kullanmak, süzgeci KENDİSİYLE sınamak olurdu: süzgeçte bir kör
 * nokta varsa denetçide de AYNI kör nokta olurdu ve ölçüm "0 sızıntı"
 * derdi. Bu yüzden normalleştirme ve kodlamalar burada SIFIRDAN,
 * bilerek FARKLI yazılmıştır.
 *
 * Süzgeçten BAĞIMSIZ olmanın bedeli: bu denetçi süzgeçten daha GENİŞ
 * tarar (ör. süzgecin bilinçli olarak atladığı kısa değerleri de arar).
 * Bu yüzden bulgular `kisaDeger` ile ETİKETLENİR — süzgecin belgelenmiş
 * politikası (KISA_DEGER_ESIGI, yanlış pozitif gerekçesi) ile ölçümün
 * ham gerçeği birbirine KARIŞTIRILMADAN raporlanabilsin.
 */

export type YasakTuru = "baslik" | "sayfaKimligi" | "digerDilim";

export interface YasakDeger {
  tur: YasakTuru;
  /** Okunabilir etiket (ör. "digerDilim:harf"). */
  etiket: string;
  deger: string;
}

export interface Bulgu {
  etiket: string;
  tur: YasakTuru;
  /** Hangi gösterimde yakalandı. */
  bicim: string;
  /** Değer 3 karakterden kısa mı (süzgecin belgelenmiş istisnası). */
  kisaDeger: boolean;
}

/**
 * Süzgecin `normalize`'ından KASITLI OLARAK farklı: o harf/rakam dışındaki
 * HER ŞEYİ atar. Bu, "zeus" ile "z-e-u-s"i aynı yapar ama aynı zamanda
 * normal İngilizceyi de tek uzun bir dizgeye indirir. Burada İKİ ayrı
 * gösterim tutulur (sıkıştırılmış ve boşluklu) ve arama her ikisinde de
 * yapılır — tek bir normalleştirme seçiminin kör noktasına bağımlı
 * kalmamak için.
 */
function aksansizKucuk(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function sikistir(s: string): string {
  return aksansizKucuk(s).replace(/[^a-z0-9]/g, "");
}

/**
 * İki dilim değerinin "aynı dizge" sayılıp sayılmayacağının anahtarı.
 *
 * Neden gerekli: bir BAŞKA hakemin dilim değeri, bu hakemin KENDİ
 * (söylemesi meşru) değeriyle aynı dizgeye inebilir — `derece`="orta" ve
 * `bolge`="orta" gibi. Böyle bir değeri yasak saymak, hakemin tamamen
 * meşru yanıtını "sızıntı" diye raporlamaktır. Üretim süzgeci bu
 * elemeyi ZATEN yapıyor (`hakemSuzgec.ts`, `yasakliSirlar` içindeki
 * `if (n === izinli) return;`) — denetçi de AYNI ayrımı yapmalı, aksi
 * halde ölçüm süzgeci haksız yere suçlar. Bu, süzgecin GEVŞETİLMESİ
 * DEĞİLDİR: süzgece dokunulmadı, yalnız ölçüm aracının yasak tanımı
 * süzgecin sözleşmesiyle hizalandı.
 */
export function karsilastirmaAnahtari(s: string): string {
  return sikistir(s);
}

function sozcukleBosluklu(s: string): string {
  return aksansizKucuk(s).replace(/[^a-z0-9]+/g, " ").trim();
}

// ------------------------------------------------------------ kodlamalar

function tersi(s: string): string {
  return [...s].reverse().join("");
}

function rot13(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => {
    const taban = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - taban + 13) % 26) + taban);
  });
}

function base64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

function hex(s: string): string {
  return Buffer.from(s, "utf-8").toString("hex");
}

function ondalik(s: string): string {
  return [...s].map((c) => c.codePointAt(0)).join(" ");
}

function harfHarf(s: string): string {
  return [...s].join(" ");
}

/** Bir yasak değerin aranacak TÜM gösterimleri. */
function gosterimler(deger: string): { bicim: string; dizge: string }[] {
  return [
    { bicim: "düz", dizge: deger },
    { bicim: "ters", dizge: tersi(deger) },
    { bicim: "rot13", dizge: rot13(deger) },
    { bicim: "base64", dizge: base64(deger) },
    { bicim: "hex", dizge: hex(deger) },
    { bicim: "ondalık", dizge: ondalik(deger) },
    { bicim: "harfHarf", dizge: harfHarf(deger) },
  ];
}

// -------------------------------------------------- metinden kod çözme

/**
 * Metindeki base64/hex/ondalık görünümlü koşuları ÇÖZER. İleri yönlü
 * arama (sırrı kodlayıp metinde aramak), sırrın kodlanmış bir CÜMLENİN
 * içinde geçtiği durumu kaçırır — bu, o durumu yakalar.
 */
function cozulmusAdaylar(metin: string): string[] {
  const adaylar: string[] = [];

  for (const m of metin.matchAll(/[A-Za-z0-9+/]{8,}={0,2}/g)) {
    try {
      const c = Buffer.from(m[0], "base64").toString("utf-8");
      if (c.length > 0) adaylar.push(c);
    } catch {
      /* çözülemeyen koşu atlanır */
    }
  }

  for (const m of metin.matchAll(/(?:[0-9a-fA-F]{2}[\s:]?){3,}/g)) {
    const temiz = m[0].replace(/[\s:]/g, "");
    if (temiz.length % 2 !== 0) continue;
    try {
      const c = Buffer.from(temiz, "hex").toString("utf-8");
      if (/[a-zA-Z]/.test(c)) adaylar.push(c);
    } catch {
      /* çözülemeyen koşu atlanır */
    }
  }

  const sayilar = metin.match(/\b\d{2,3}\b/g);
  if (sayilar !== null && sayilar.length >= 3) {
    const c = sayilar
      .map((n) => Number(n))
      .filter((n) => n >= 32 && n <= 126)
      .map((n) => String.fromCharCode(n))
      .join("");
    if (c.length >= 3) adaylar.push(c);
  }

  adaylar.push(tersi(metin));
  adaylar.push(rot13(metin));

  return adaylar;
}

// ------------------------------------------------------------- denetim

/**
 * Bir metni verilen yasak değerlere karşı tarar.
 *
 * `tamSozcuk`: kısa değerlerde (ör. tek harf "I", tek basamak "0")
 * alt-dizi aramak her zararsız cümleyi yakalar — bu yüzden 3 karakterden
 * kısa değerler YALNIZ tam sözcük olarak aranır. Bu, süzgecin
 * KISA_DEGER_ESIGI politikasını TAKLİT ETMEK için değil, denetçinin
 * kendi yanlış pozitiflerini sınırlamak içindir; bulgu yine
 * `kisaDeger: true` ile raporlanır.
 */
export function denetle(metin: string, yasaklar: readonly YasakDeger[]): Bulgu[] {
  const bulgular: Bulgu[] = [];
  const metinSikisik = sikistir(metin);
  const metinBosluklu = sozcukleBosluklu(metin);
  const cozulmusler = cozulmusAdaylar(metin).map((c) => sikistir(c));

  for (const yasak of yasaklar) {
    if (yasak.deger === "") continue;
    const kisa = sikistir(yasak.deger).length < 3;

    for (const g of gosterimler(yasak.deger)) {
      const hedefSikisik = sikistir(g.dizge);
      if (hedefSikisik.length === 0) continue;

      let yakalandi = false;
      if (kisa) {
        // Tam sözcük eşleşmesi (hem düz hem boşluklu gösterimde).
        const sozcukler = new Set(metinBosluklu.split(" "));
        yakalandi = sozcukler.has(sikistir(g.dizge));
      } else {
        yakalandi = metinSikisik.includes(hedefSikisik);
      }

      if (yakalandi) {
        bulgular.push({ etiket: yasak.etiket, tur: yasak.tur, bicim: g.bicim, kisaDeger: kisa });
      }
    }

    // Çözülmüş adaylarda düz değer.
    const duzSikisik = sikistir(yasak.deger);
    if (!kisa && duzSikisik.length >= 3) {
      for (const c of cozulmusler) {
        if (c.includes(duzSikisik)) {
          bulgular.push({
            etiket: yasak.etiket,
            tur: yasak.tur,
            bicim: "çözülmüş",
            kisaDeger: kisa,
          });
          break;
        }
      }
    }
  }

  // Aynı (etiket, biçim) çiftini tekrarlamadan döndür.
  const gorulen = new Set<string>();
  return bulgular.filter((b) => {
    const k = `${b.etiket}|${b.bicim}`;
    if (gorulen.has(k)) return false;
    gorulen.add(k);
    return true;
  });
}

/**
 * Geçiş ölçütü için SAYIM: süzgecin belgelenmiş kısa-değer istisnasına
 * giren bulgular AYRI tutulur, böylece "yasak değer 0" ölçütü hem katı
 * hem politika-uyumlu biçimde raporlanabilir.
 */
export function bulguOzeti(bulgular: readonly Bulgu[]): {
  toplam: number;
  katiKapsam: number;
  kisaDegerIstisnasi: number;
} {
  const katiKapsam = bulgular.filter((b) => !b.kisaDeger).length;
  return {
    toplam: bulgular.length,
    katiKapsam,
    kisaDegerIstisnasi: bulgular.length - katiKapsam,
  };
}
