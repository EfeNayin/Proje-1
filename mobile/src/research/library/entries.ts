import type { LibraryEntry } from "./types";

/**
 * The Turkish research library: short, source-based explanations of general adult
 * resistance training. Written by hand from the cited records (see sources.ts for how
 * they were checked); not translated by a service, not reviewed by a professional, and
 * not advice for any one person. Scope is deliberately narrow: no rehabilitation,
 * disease, drug or supplement content and no individual prescriptions.
 *
 * Topics looked at and left out because the sources found would not carry the claim:
 * muscle soreness as a sign of growth (two small studies with unusual protocols), and
 * deload weeks (no verified trial or review was set aside for this first release).
 *
 * Every explanation paragraph names the sources it rests on. Keywords may be stems
 * (see search.ts for how a typed word is matched against them); aliases are phrasings
 * of the question that people type, maintained by hand.
 */
const CHECKED = "2026-11-02";

export const LIBRARY_ENTRIES: readonly LibraryEntry[] = [
  {
    id: "weekly-volume",
    title: "Kas gelişimi için haftada kaç set yapılmalı?",
    answer:
      "Araştırmalar, haftalık set sayısı arttıkça kas büyümesinin de genel olarak arttığını, ancak her ek setin getirisinin giderek azaldığını gösteriyor. ACSM’nin 2026 değerlendirmesi, hipertrofi için haftada en az 10 set gibi daha yüksek hacimlerin avantajlı olduğunu bildiriyor.",
    explanation: [
      {
        text: "Schoenfeld ve ark. (2017) 15 çalışmanın meta-regresyonunda, bir kas için haftalık set sayısı arttıkça kas boyutundaki artışın da büyüdüğünü buldu: her ek set, yüzde kazançta yaklaşık %0,37’lik bir artışla ilişkiliydi. Haftada 10 ve üzeri set ile daha düşük gruplar üç kategoride karşılaştırıldığında fark yalnızca bir eğilim olarak kaldı (istatistiksel olarak anlamlı değildi).",
        sourceIds: ["schoenfeld-2017-volume"],
      },
      {
        text: "Pelland ve ark. (2026) 67 çalışmayı kapsayan daha yeni bir meta-regresyonda da hacim arttıkça hipertrofinin arttığını, ancak getirinin azalan olduğunu bildirdi.",
        sourceIds: ["pelland-2026"],
      },
      {
        text: "ACSM’nin 2026 pozisyon bildirisi, 137 sistematik derlemenin özetinde kas büyümesinin daha yüksek hacimlerle (haftada 10 set ve üzeri) ve eksantrik aşırı yüklenmeyle arttığını belirtir.",
        sourceIds: ["acsm-2026"],
      },
    ],
    context:
      "Sağlıklı yetişkinlerde yapılan çalışmalar. Pelland ve ark.’nın analizinde katılımcıların yaklaşık %79’u erkekti, ortalama yaş 25 civarındaydı.",
    limitations: [
      "Bunlar grup ortalamalarıdır; belirli bir kişi için ideal set sayısını belirlemez.",
      "“Haftada 10 set” sihirli bir eşik veya kişisel bir öneri değildir; çalışmalar hacmi farklı biçimlerde saymıştır.",
      "Toparlanma, deneyim ve programa uyum kişiden kişiye değişir; bu özetler kişisel bir üst sınır vermez.",
    ],
    keywords: [
      "hacim",
      "haftalık hacim",
      "antrenman hacmi",
      "set",
      "set sayısı",
      "haftalık set",
      "haftada",
      "hipertrofi",
      "kas gelişimi",
      "kas büyümesi",
      "gelişim",
      "volume",
      "weekly sets",
      "dose-response",
      "azalan getiri",
    ],
    aliases: [
      "kas geliştirmek için haftada kaç set",
      "haftada kaç set yapmalıyım",
      "bir kas için haftada kaç set",
      "kaç set yapmalıyım",
      "çok set yapmak faydalı mı",
      "antrenman hacmi ne kadar olmalı",
      "how many sets per week",
    ],
    sourceIds: ["schoenfeld-2017-volume", "pelland-2026", "acsm-2026"],
    sourcesCheckedOn: CHECKED,
  },
  {
    id: "training-frequency",
    title: "Bir kası haftada kaç kez çalıştırmak gerekir?",
    answer:
      "Haftalık toplam set sayısı eşit tutulduğunda, bir kasın haftada kaç güne yayıldığının kas büyümesine etkisi küçük veya belirsiz bulunuyor. Yazarlar, sıklığın kişisel tercihe göre seçilebileceğini belirtiyor.",
    explanation: [
      {
        text: "2016’daki ilk meta-analiz (10 çalışma), hacim eşitlenmiş karşılaştırmalarda bir kası haftada 2 gün çalıştırmanın haftada 1 güne göre daha iyi hipertrofi sağladığını bildirmişti; haftada 3 günün 2 günden üstün olup olmadığı belirsiz kalmıştı.",
        sourceIds: ["schoenfeld-2016-frequency"],
      },
      {
        text: "2019’daki daha kapsamlı analiz (25 çalışma) hacim eşitlendiğinde yüksek ve düşük sıklık arasında anlamlı fark bulmadı. Hacim eşitlenmediğinde yüksek sıklık lehine, ancak küçük bir fark görüldü. Yazarlar, belirli bir hacim için haftalık sıklığın kişisel tercihe göre seçilebileceği sonucuna vardı.",
        sourceIds: ["schoenfeld-2019-frequency"],
      },
      {
        text: "Pelland ve ark. (2026) 67 çalışmalık meta-regresyonda sıklığın hipertrofi üzerindeki etkisinin ihmal edilebilir düzeyle uyumlu olduğunu, kuvvet kazanımında ise sıklıkla artan (azalan getirili) bir ilişki bulunduğunu bildirdi. ACSM’nin 2026 özetinde kuvvetin haftada en az 2 seansla arttığı, hipertrofiyi artıran etkenler arasında ise sıklığın değil hacmin ve eksantrik aşırı yüklenmenin sayıldığı belirtilir.",
        sourceIds: ["pelland-2026", "acsm-2026"],
      },
    ],
    context:
      "Sağlıklı yetişkinlerde, çoğunlukla genç erkeklerde yapılan çalışmalar. Bu giriş yalnızca kas büyümesini ele alır.",
    limitations: [
      "2016 ve 2019 sonuçları farklıdır; daha kapsamlı olan 2019 analizi hacim eşitlendiğinde fark bulmamıştır.",
      "Hacim eşitlenmediğinde görülen küçük fark, sıklığın mı yoksa daha fazla toplam hacmin mi sonucu olduğu bu özetlerden ayırt edilemez.",
      "Kuvvet kazanımı için sonuçlar farklıdır ve burada ele alınmaz. Bu bir kişisel program önerisi değildir.",
    ],
    keywords: [
      "sıklık",
      "antrenman sıklığı",
      "frekans",
      "haftada kaç gün",
      "kaç gün",
      "gün",
      "haftada kaç kez",
      "kaç kez",
      "frequency",
      "training frequency",
      "hipertrofi",
      "kas gelişimi",
    ],
    aliases: [
      "bir kası haftada kaç kez çalıştırmalıyım",
      "haftada kaç gün antrenman yapmalıyım",
      "her kas grubu haftada kaç gün",
      "haftada bir mi iki mi çalıştırmalı",
      "antrenman sıklığı kas gelişimini etkiler mi",
      "how often should i train a muscle",
    ],
    sourceIds: ["schoenfeld-2016-frequency", "schoenfeld-2019-frequency", "pelland-2026", "acsm-2026"],
    sourcesCheckedOn: CHECKED,
  },
  {
    id: "repetition-range",
    title: "Kas büyümesi için ağır mı hafif mi çalışmalı, kaç tekrar yapılmalı?",
    answer:
      "Setler tükenişe yakın yapıldığında, geniş bir yük ve tekrar aralığında benzer kas büyümesi görülüyor. Maksimal kuvvet için ise ağır yükler daha avantajlı.",
    explanation: [
      {
        text: "Schoenfeld ve ark. (2017), 21 çalışmayı birleştiren meta-analizde (bütün setler tükenişe kadar; düşük yük 1TM’nin %60’ı ve altı, yüksek yük %60’ın üstü) kas büyümesinin iki koşulda benzer olduğunu, 1TM kuvvet kazancının ise yüksek yük lehine daha fazla olduğunu buldu.",
        sourceIds: ["schoenfeld-2017-load"],
      },
      {
        text: "Lopez ve ark. (2021) ağ meta-analizinde (28 çalışma, 747 kişi; setler istemli tükenişe kadar) düşük (15 TM’den fazla), orta (9–15 TM) ve yüksek yük (8 TM ve altı) arasında hipertrofi farkı bulmadı; kuvvet artışı yüksek ve orta yükte düşük yüke göre daha iyiydi.",
        sourceIds: ["lopez-2021-load"],
      },
      {
        text: "ACSM’nin 2026 özetinde kuvvetin ağır yüklerle (1TM’nin yaklaşık %80’i ve üstü) arttığı, hipertrofiyi artıran etkenler arasında ise yükün değil hacmin ve eksantrik aşırı yüklenmenin sayıldığı belirtilir. Eski ACSM rehberi (2009) hipertrofi için ağırlıklı olarak 6–12 TM bölgesini öneriyordu; 2026 bildirisi bu rehberi günceller.",
        sourceIds: ["acsm-2026", "acsm-2009"],
      },
    ],
    context:
      "Sağlıklı yetişkinler. Hafif yük çalışmalarında setler tükenişe (veya çok yakınına) kadar götürülmüştür.",
    limitations: [
      "Hafif yükle benzer sonuç, setlerin tükenişe kadar götürüldüğü çalışmalarda görüldü; hafif yükü tükenişten uzak bir noktada bırakmanın aynı sonucu vereceği buradan çıkarılamaz.",
      "Lopez ve ark.’nın analizinde etkiler antrenmansız katılımcılarda daha büyüktü; sonuçlar deneyim düzeyine göre değişebilir.",
      "Bu giriş tek bir ideal tekrar sayısı önermez ve kişisel program değildir.",
    ],
    keywords: [
      "tekrar",
      "tekrar sayısı",
      "tekrar aralığı",
      "kaç tekrar",
      "yük",
      "ağır",
      "hafif",
      "ağırlık",
      "1rm",
      "1tm",
      "rep",
      "reps",
      "load",
      "repetition range",
      "hipertrofi",
      "kuvvet",
    ],
    aliases: [
      "kaç tekrar yapmalıyım",
      "kas gelişimi için kaç tekrar",
      "ağır mı hafif mi çalışmalı",
      "hafif ağırlıkla kas yapılır mı",
      "düşük tekrar mı yüksek tekrar mı",
      "8-12 tekrar şart mı",
      "how many reps for muscle growth",
    ],
    sourceIds: ["schoenfeld-2017-load", "lopez-2021-load", "acsm-2026", "acsm-2009"],
    sourcesCheckedOn: CHECKED,
  },
  {
    id: "training-to-failure",
    title: "Her seti tükenişe kadar götürmek şart mı?",
    answer:
      "Hayır. Meta-analizler, anlık kas yetmezliğine (tükeniş) kadar gitmenin kas büyümesi için şart olmadığını, tükenişe gitmenin de genel olarak zarar vermediğini gösteriyor.",
    explanation: [
      {
        text: "Refalo ve ark. (2023) 15 çalışmalık meta-analizde, setleri anlık kas yetmezliğine kadar götürmenin götürmemeye göre hipertrofi açısından üstün olduğuna dair kanıt bulmadı. “Set tükenişi” tanımları birlikte alındığında önemsiz derecede küçük bir avantaj görüldü. Yazarlar, tükenişe yakınlık ile hipertrofi arasındaki ilişkinin doğrusal olmayabileceğini belirtti.",
        sourceIds: ["refalo-2023-failure"],
      },
      {
        text: "Grgic ve ark. (2022) 15 çalışmalık meta-analizinde kuvvet ve hipertrofi için tükenişe gitmek ile gitmemek arasında anlamlı fark bulmadı; yazarlar tükenişin şart görünmediğini, ancak zararlı da görünmediğini yazdı. Antrenmanlı katılımcılardan oluşan alt grupta hipertrofi için tükenişe gitme lehine küçük bir etki vardı.",
        sourceIds: ["grgic-2022-failure"],
      },
      {
        text: "ACSM’nin 2026 özetine göre anlık kas yorgunluğuna kadar antrenman, sonuçları tutarlı biçimde etkilemedi.",
        sourceIds: ["acsm-2026"],
      },
    ],
    context:
      "Sağlıklı yetişkinler. Grgic ve ark.’nın incelediği çalışmaların hepsi genç yetişkinlerle yapılmıştı; yaşlı ve çok ileri düzey antrenmanlılar yeterince çalışılmamıştır.",
    limitations: [
      "Bu özetler yalnızca kuvvet ve kas büyümesi sonuçlarına bakar; yorgunluk veya toparlanma gibi diğer sonuçlar bu girişin kapsamı dışındadır.",
      "Hangi yakınlığın “yeterli” olduğu bu kaynaklarla kesin olarak belirlenemez; kalan tekrar tahmini için “RIR” girişine bakın.",
      "Antrenmanlılarda görülen küçük fark güven aralığının alt sınırına yakındır; kesin bir üstünlük olarak okunmamalıdır.",
    ],
    keywords: [
      "tükeniş",
      "tükenmek",
      "tükenişe",
      "yetmezlik",
      "kas yetmezliği",
      "failure",
      "momentary failure",
      "failure training",
      "son tekrar",
      "zorlamak",
      "yakınlık",
      "proximity to failure",
    ],
    aliases: [
      "her set tükenişe gitmeli mi",
      "tükenişe kadar gitmek şart mı",
      "failure şart mı",
      "setleri sonuna kadar zorlamak gerekli mi",
      "tükeniş kas gelişimi için gerekli mi",
      "setin sonuna kadar gitmek gerekir mi",
    ],
    sourceIds: ["refalo-2023-failure", "grgic-2022-failure", "acsm-2026"],
    sourcesCheckedOn: CHECKED,
  },
  {
    id: "reps-in-reserve",
    title: "RIR nedir ve kalan tekrarı doğru tahmin edebilir miyiz?",
    answer:
      "RIR (Repetitions in Reserve), bir setin sonunda yapılabilecek tahmini kalan tekrar sayısıdır. Araştırmalar bu tahminin kusurlu olduğunu gösteriyor: katılımcılar ortalama olarak kalan tekrarı yaklaşık 1 tekrar az tahmin ediyor ve sonuçlar çok değişken. Tahmin, set sonuna yaklaştıkça daha doğru oluyor.",
    explanation: [
      {
        text: "RIR yaklaşımında bir set, “tükenişe kaç tekrar kaldığı” tahminine göre bitirilir. Bastos ve ark.’nın (2024) tarama derlemesinde (31 çalışma, çoğunlukla erkek yetişkin) en yaygın kullanım, hedef bir RIR belirleyip yükü buna göre ayarlamaktı.",
        sourceIds: ["bastos-2024-rir", "halperin-2022-rir"],
      },
      {
        text: "Halperin ve ark. (2022; 12 çalışma, 414 katılımcı) katılımcıların kalan tekrarı ortalama 0,95 tekrar az tahmin ettiğini (yani gerçekte biraz daha tekrar kaldığını) buldu; çalışmalar arasında çok büyük farklılık vardı. Antrenman düzeyi tahmin doğruluğunu belirgin biçimde etkilemedi.",
        sourceIds: ["halperin-2022-rir"],
      },
      {
        text: "Tahminler, set tükenişe yaklaştıkça ve daha ağır yüklerde daha doğru bulundu; sonraki setlerde yalnızca çok küçük bir iyileşme vardı. Bastos ve ark. da tahminin tükenişe yakın yapılmasının doğruluğu artırdığını belirtir.",
        sourceIds: ["halperin-2022-rir", "bastos-2024-rir"],
      },
    ],
    context:
      "Sağlıklı yetişkinler (çoğunlukla erkek). Tahmin hataları, gerçekten tükenişe kadar yapılan test setleriyle ölçülmüştür.",
    limitations: [
      "Ortalama yaklaşık 1 tekrarlık hata tek bir kişi veya egzersiz için geçerli olmayabilir; çalışmalar arasındaki farklılık çok büyüktür.",
      "Bu hatanın kabul edilebilir olup olmadığı yazarlarca belirsiz bırakılmıştır.",
      "Bu giriş RIR kullanmanın kas büyümesini artırdığını söylemez; yalnızca tahminin ne kadar doğru olduğunu ele alır.",
    ],
    keywords: [
      "rir",
      "kalan tekrar",
      "tekrar rezervi",
      "rezerv",
      "repetitions in reserve",
      "reserve",
      "tahmin",
      "yakınlık",
      "proximity to failure",
    ],
    aliases: [
      "rir nedir",
      "rir ne demek",
      "rir nasıl hesaplanır",
      "kaç tekrar kaldığını nasıl anlarım",
      "rir tahmini doğru mu",
      "rir güvenilir mi",
      "reps in reserve",
    ],
    sourceIds: ["bastos-2024-rir", "halperin-2022-rir"],
    sourcesCheckedOn: CHECKED,
  },
  {
    id: "rest-between-sets",
    title: "Setler arasında ne kadar dinlenmek gerekir?",
    answer:
      "Kas büyümesi için kesin bir süre yok: 60 saniyeden uzun dinlenmenin küçük bir avantajı olabilir, 90 saniyeden sonra fark belirgin değil. Kuvvet için, antrenmanlı kişilerde 2 dakikadan uzun dinlenme daha iyi görünüyor.",
    explanation: [
      {
        text: "Singer ve ark. (2024) 9 çalışmalık Bayesçi meta-analizde, 60 saniyeden uzun setler arası dinlenmenin küçük bir hipertrofi avantajı sağlayabileceğini, 90 saniyenin üstünde belirgin bir fark saptanmadığını bildirdi; kısa ve uzun dinlenme gruplarının ikisinde de kas kazanımı görüldü. Avantajın, hacim yükündeki azalmanın önlenmesinden kaynaklanabileceği düşünülüyor.",
        sourceIds: ["singer-2024-rest"],
      },
      {
        text: "Schoenfeld ve ark. (2016) 21 antrenmanlı genç erkekle 8 hafta süren bir denemede, 3 dakika dinlenen grupta 1 dakika dinlenen gruba göre kuvvet ve uyluk ön kas kalınlığı daha fazla arttı.",
        sourceIds: ["schoenfeld-2016-rest"],
      },
      {
        text: "Grgic ve ark. (2018) 23 çalışmalık derlemede 60 saniyenin altındaki dinlenmelerle bile sağlam kuvvet kazancı görüldüğünü, antrenmanlı kişilerde kuvvetin en çok 2 dakikadan uzun dinlenmeyle arttığını, antrenmansızlarda ise 60–120 saniyenin yeterli göründüğünü bildirdi. Eski ACSM rehberi (2009) hipertrofi için 1–2 dakika, ağır kuvvet çalışması için 3–5 dakika öneriyordu.",
        sourceIds: ["grgic-2018-rest", "acsm-2009"],
      },
    ],
    context:
      "Sağlıklı yetişkinler. Schoenfeld ve ark.’nın çalışması 21 kişilik küçük bir denemedir.",
    limitations: [
      "Singer ve ark.’nın analizinde çalışmalar arasında belirgin farklılık vardı; küçük farklar kesin sayılmamalıdır.",
      "Dinlenme süresi, yapılabilen toplam hacmi etkileyebilir; bu nedenle etki doğrudan mı dolaylı mı belirsizdir.",
      "Bu giriş tek bir ideal süre önermez ve kişisel program değildir.",
    ],
    keywords: [
      "dinlenme",
      "dinlen",
      "set arası",
      "setler arası",
      "dinlenme süresi",
      "mola",
      "bekleme",
      "rest",
      "rest interval",
      "rest period",
      "dakika",
      "saniye",
    ],
    aliases: [
      "setler arasında ne kadar dinlenmeliyim",
      "set arası dinlenme kaç dakika olmalı",
      "kaç dakika dinlenmeliyim",
      "set aralarında ne kadar beklemeliyim",
      "kısa dinlenme mi uzun dinlenme mi",
      "how long to rest between sets",
    ],
    sourceIds: ["singer-2024-rest", "schoenfeld-2016-rest", "grgic-2018-rest", "acsm-2009"],
    sourcesCheckedOn: CHECKED,
  },
  {
    id: "progression",
    title: "Antrenmanda nasıl ilerleme sağlanır?",
    answer:
      "ACSM, sağlıklı yetişkinlerin kas fonksiyonunu ve büyümesini artırmak için ilerlemeli (kademeli artan) direnç antrenmanı yapmasını öneriyor. Eski ACSM rehberi örnek olarak, hedeflenen tekrar sayısı 1–2 tekrar aşılabildiğinde yükün %2–10 artırılmasını veriyor.",
    explanation: [
      {
        text: "ACSM’nin 2026 pozisyon bildirisi, 137 sistematik derlemenin özetine dayanarak sağlıklı yetişkinlerin kas fonksiyonunu, büyüklüğünü ve fiziksel performansını artırmak için ilerlemeli direnç antrenmanı yapması gerektiği sonucuna varır. Bildiri, 2009 rehberini günceller.",
        sourceIds: ["acsm-2026"],
      },
      {
        text: "2009 rehberi bir ilerleme ölçütü örneği verir: kişi mevcut yükü hedeflenen tekrar sayısının 1–2 tekrar üstüne çıkarabiliyorsa yük %2–10 artırılır. Rehber, önerilerin kişinin hedefine, kapasitesine ve antrenman durumuna göre uygulanması gerektiğini de vurgular.",
        sourceIds: ["acsm-2009"],
      },
    ],
    context:
      "Sağlıklı yetişkinler için genel çerçeve. ACSM 2026 özeti 30.000’den fazla katılımcıyı kapsayan 137 sistematik derlemeye dayanır.",
    limitations: [
      "%2–10 ölçütü 2009 rehberindendir; 2026 özetinde yer almaz.",
      "Bu giriş ilerlemenin hangi yolla (yük, tekrar, set) yapılmasının daha iyi olduğunu ele almaz.",
      "Genel bir çerçevedir; kişisel program veya yük önerisi değildir.",
    ],
    keywords: [
      "ilerleme",
      "ilerlemek",
      "progresyon",
      "progresif",
      "progressive overload",
      "aşırı yüklenme",
      "yükleme",
      "ağırlık artırma",
      "yük artırma",
      "kademeli",
      "ağırlığı artırmak",
    ],
    aliases: [
      "nasıl ilerlemeliyim",
      "ağırlığı ne zaman artırmalıyım",
      "ne zaman ağırlık artırılır",
      "progressive overload nedir",
      "ağırlık ne kadar artırılmalı",
      "yük artırma kuralı",
    ],
    sourceIds: ["acsm-2026", "acsm-2009"],
    sourcesCheckedOn: CHECKED,
  },
  {
    id: "exercise-selection",
    title: "Egzersiz seçerken tam hareket açıklığı önemli mi?",
    answer:
      "Belirli bir egzersiz listesi dayatan bir kanıt yok. Alt vücutta tam hareket açıklığı, kısmi açıklığa göre kas büyümesi için avantajlı görünüyor; üst vücutta kanıt sınırlı ve çelişkili. ACSM (2026) ekipman türünün ve egzersiz karmaşıklığının sonuçları tutarlı biçimde etkilemediğini bildiriyor.",
    explanation: [
      {
        text: "Schoenfeld ve Grgic (2020) 6 çalışmalık derlemede (135 katılımcı, çoğu erkek) tam hareket açıklığının alt vücut kaslarında kısmi açıklığa göre hipertrofiye yararlı olduğunu, üst ekstremite için araştırmanın sınırlı ve çelişkili olduğunu, gövde kasları için hiç çalışma bulunmadığını bildirdi. Yanıtın kasa göre değişebileceğine dair bazı ipuçları da vardı.",
        sourceIds: ["schoenfeld-2020-rom"],
      },
      {
        text: "Wolf ve ark. (2025) 30 antrenmanlı katılımcıyla 8 hafta süren, her kolun rastgele atandığı bir denemede, kasın uzamış (gerilmiş) pozisyonunda yapılan kısmi tekrarlar ile tam hareket açıklığının benzer kas kalınlığı artışı sağladığını buldu; yazarlar kas boyutunu artırmak isteyenlerin gerilmiş pozisyona vurgu yapması gerektiğini belirtti.",
        sourceIds: ["wolf-2025-lengthened"],
      },
      {
        text: "ACSM’nin 2026 özetinde kuvvetin tam hareket açıklığıyla arttığı, ekipman türü ve egzersiz karmaşıklığının ise sonuçları tutarlı biçimde etkilemediği belirtilir. Eski rehber (2009) kuvvet programları için, yoğunluğun korunması amacıyla büyük kas grubu egzersizlerini küçüklerden, çok eklemli egzersizleri tek eklemlilerden önce yapmayı önerir ve hipertrofi için egzersiz seçiminde benzer bir tasarım önerir.",
        sourceIds: ["acsm-2026", "acsm-2009"],
      },
    ],
    context:
      "Sağlıklı yetişkinler. Alt vücut bulgusu altı küçük çalışmaya, üst vücuttaki yeni bulgu tek bir 30 kişilik denemeye dayanır.",
    limitations: [
      "Kanıt tabanı küçüktür ve kasa göre değişebilir; gövde kasları hiç çalışılmamıştır.",
      "Bu giriş tek tek egzersizleri (ör. squat ile leg press) karşılaştırmaz.",
      "Sıralama önerileri 2009 rehberindendir ve kuvvet programları içindir. Bu bir kişisel program önerisi değildir.",
    ],
    keywords: [
      "egzersiz seçimi",
      "hareket seçimi",
      "hangi egzersiz",
      "hareket açıklığı",
      "tam açıklık",
      "kısmi tekrar",
      "kısmi",
      "rom",
      "range of motion",
      "çok eklemli",
      "tek eklemli",
      "compound",
      "ekipman",
      "makine",
      "serbest ağırlık",
      "gerilmiş pozisyon",
      "uzamış pozisyon",
    ],
    aliases: [
      "hangi egzersizleri seçmeliyim",
      "tam hareket açıklığı gerekli mi",
      "kısmi tekrar işe yarar mı",
      "makine mi serbest ağırlık mı",
      "çok eklemli mi tek eklemli mi",
      "egzersiz sırası nasıl olmalı",
      "full range of motion",
    ],
    sourceIds: ["schoenfeld-2020-rom", "wolf-2025-lengthened", "acsm-2026", "acsm-2009"],
    sourcesCheckedOn: CHECKED,
  },
  {
    id: "warm-up",
    title: "Isınma gerekli mi, performansı veya yaralanmayı etkiler mi?",
    answer:
      "Bir meta-analiz, ısınmanın incelenen performans ölçütlerinin %79’unda performansı artırdığını ve zararlı olduğuna dair az kanıt bulunduğunu bildiriyor. Yaralanmayı önleme konusunda ise kanıt yetersiz, ancak ağırlığı yaralanma riskinin azalması yönünde.",
    explanation: [
      {
        text: "Fradkin ve ark. (2010) 32 çalışmayı (hepsi yüksek kaliteli) birleştirdi: germe dışı etkinlikler içeren ısınmalar, incelenen ölçütlerin %79’unda performansı iyileştirdi ve ısınmanın zararlı olduğunu gösteren kanıt azdı. İyi kurgulanmış randomize kontrollü çalışma sayısının az olduğu belirtilir.",
        sourceIds: ["fradkin-2010-warmup"],
      },
      {
        text: "Fradkin ve ark.’nın (2006) yaralanma derlemesinde 5 randomize kontrollü çalışmanın üçü ısınmanın yaralanma riskini anlamlı azalttığını, ikisi anlamlı fark olmadığını bildirdi. Yazarlar, rutin ısınmayı onaylamak veya bırakmak için kanıtın yetersiz olduğunu, ancak kanıt ağırlığının azalmış risk yönünde olduğunu yazdı.",
        sourceIds: ["fradkin-2006-injury"],
      },
    ],
    context:
      "Spor ve fiziksel aktivite yapan kişilerde yapılmış çalışmalar. Özetlerde direnç antrenmanına özgü bir ısınma protokolü karşılaştırması yer almaz.",
    limitations: [
      "Isınmanın içeriği, süresi ve ısınma seti sayısı bu kaynaklarla belirlenemez.",
      "Yaralanma derlemesi 2005 yılına kadar yapılan aramalara ve 5 çalışmaya dayanır.",
      "Kas büyümesi ölçülmemiştir. Bir sağlık sorunu veya sakatlık için ısınma önerisi değildir.",
    ],
    keywords: [
      "ısınma",
      "ısınmak",
      "ısınma seti",
      "ısınma setleri",
      "warm-up",
      "warm up",
      "yaralanma",
      "sakatlık",
      "sakatlanma",
      "performans",
    ],
    aliases: [
      "ısınma gerekli mi",
      "ısınma yapmak zorunda mıyım",
      "ısınmak performansı artırır mı",
      "ısınma yaralanmayı önler mi",
      "ısınma seti gerekli mi",
      "is warming up necessary",
    ],
    sourceIds: ["fradkin-2010-warmup", "fradkin-2006-injury"],
    sourcesCheckedOn: CHECKED,
  },
  {
    id: "sleep-and-recovery",
    title: "Uyku ve toparlanma: yetersiz uyku antrenmanı ve kas gelişimini etkiler mi?",
    answer:
      "Yetişkinler için AASM/SRS uzlaşı bildirisi, sağlık için düzenli olarak 7 saat veya daha fazla uyumayı öneriyor. Bir meta-analiz, kısa uykunun egzersiz performansını ortalama %7,6 düşürdüğünü gösteriyor; uykunun kas büyümesine uzun vadeli etkisi ise bu kaynaklarla gösterilmiyor.",
    explanation: [
      {
        text: "Amerikan Uyku Tıbbı Akademisi ile Uyku Araştırma Derneği’nin (2015) ortak bildirisi, yetişkinlerin sağlıklarını korumak için düzenli olarak 7 saat veya daha fazla uyuması gerektiğini söyler. Bu, genel sağlık içindir; kas büyümesine özgü bir öneri değildir.",
        sourceIds: ["aasm-srs-2015-sleep"],
      },
      {
        text: "Craven ve ark. (2022) 69 yayın ve 227 ölçümü birleştirdi (katılımcıların %89’u erkek). 24 saat içinde 6 saat ve altı uyku, egzersiz performansında ortalama %7,56’lık bir düşüşle ilişkiliydi ve etki incelenen bütün egzersiz kategorilerinde anlamlıydı. Tutarlı olumsuz etki, tam uykusuzluk ve erken uyanmayla kısıtlanan uykuda görüldü; sabah egzersizleri büyük ölçüde etkilenmedi.",
        sourceIds: ["craven-2022-sleep-loss"],
      },
      {
        text: "Lamon ve ark. (2021) 13 sağlıklı genç yetişkinde bir gecelik tam uykusuzluğun yemek sonrası kas protein sentezini %18 azalttığını, kan kortizolünü %21 artırıp testosteronunu %24 düşürdüğünü buldu. Yazarlar bunları, kronik uyku kaybının sonuçlarına yol açabilecek olası mekanizmalar olarak yorumluyor.",
        sourceIds: ["lamon-2021-sleep"],
      },
    ],
    context:
      "Sağlıklı genç yetişkinler. Lamon ve ark.’nın çalışması 13 kişilik, tek geceli bir deneydir.",
    limitations: [
      "Lamon ve ark.’nın bulgusu tek gece tam uykusuzluğa dayanır; günlük kısmi uyku kısıtını temsil etmez ve kas protein sentezi ölçümü kas büyümesi ölçümü değildir.",
      "Craven ve ark.’nın sonuçları çalışmalar arasında çok büyük farklılık gösterir ve kas büyümesini değil egzersiz performansını ölçer.",
      "Bu kaynaklar yetersiz uykunun uzun dönemli hipertrofiye etkisini ölçen bir antrenman çalışması içermez. Antrenman günleri arası dinlenme ve beslenme gibi diğer toparlanma etkenleri bu girişin kapsamı dışındadır.",
    ],
    keywords: [
      "uyku",
      "uykusuzluk",
      "uyku süresi",
      "uyumak",
      "kaç saat uyumalı",
      "toparlanma",
      "recovery",
      "sleep",
      "sleep loss",
      "sleep deprivation",
    ],
    aliases: [
      "uyku kas gelişimini etkiler mi",
      "kaç saat uyumalıyım",
      "uyku antrenman performansını etkiler mi",
      "az uyursam kas kaybeder miyim",
      "uyku ve toparlanma",
      "does sleep affect muscle growth",
    ],
    sourceIds: ["aasm-srs-2015-sleep", "craven-2022-sleep-loss", "lamon-2021-sleep"],
    sourcesCheckedOn: CHECKED,
  },
  {
    id: "body-weight-changes",
    title: "Vücut ağırlığındaki değişim kas kazandığımı veya kaybettiğimi gösterir mi?",
    answer:
      "Tek başına göstermez. Vücut ağırlığı gün ve hafta içinde doğal olarak dalgalanır, glikojen suyla birlikte depolandığı için kısa vadede kiloyu değiştirebilir ve kilo değişimi yağ ile yağsız kütlenin karışımıdır.",
    explanation: [
      {
        text: "Orsama ve ark. (2014) 80 yetişkinin 4.657 günlük tartı ölçümünü inceledi: grup düzeyinde kilo hafta sonu artıyor, hafta içi azalıyordu (en yüksek değerler Pazar ve Pazartesi). Yazarlar, hafta sonu ile hafta içi arasındaki farkların kilo alımı belirtisi değil, normal sayılması gerektiğini belirtti.",
        sourceIds: ["orsama-2014-weight-rhythm"],
      },
      {
        text: "Kreitzman ve ark. (1992) glikojenin karaciğerde, kasta ve yağ hücrelerinde 3–4 kısım suyla birlikte depolandığını, bu nedenle glikojen değişimlerinin kilo dalgalanmalarını etkilediğini tartıştı (çok düşük kalorili diyetteki 11 kişide ölçüm).",
        sourceIds: ["kreitzman-1992-glycogen"],
      },
      {
        text: "Hall (2008) matematiksel modeli, kilo değişiminin yağ ve yağsız kütle karışımı olduğunu, bu karışımın başlangıçtaki vücut yağına göre değiştiğini ve kilo kaybının bir kısmının yağsız kütleden gelebileceğini öngörür.",
        sourceIds: ["hall-2008-weight-loss"],
      },
    ],
    context:
      "Bu kaynaklar kas kazanımını ölçmez; yalnızca kilonun neden tek başına yanıltıcı olabileceğini gösterir. Orsama ve ark. yetişkinlerde grup ortalaması, Kreitzman ve ark. çok düşük kalorili diyet ortamı, Hall ise kilo kaybı için bir modeldir.",
    limitations: [
      "Hiçbir kaynak direnç antrenmanı yapan kişilerde kas kütlesindeki değişimi ölçmez.",
      "Orsama ve ark.’nın bulgusu grup düzeyindedir; tek bir kişinin dalgalanması farklı olabilir.",
      "Bu giriş kas kütlesini ölçme yöntemi veya tartı sıklığı önermez; kişisel yorum değildir.",
    ],
    keywords: [
      "kilo",
      "vücut ağırlığı",
      "tartı",
      "kilo değişimi",
      "kilo alma",
      "kilo verme",
      "kilo artışı",
      "kilo dalgalanması",
      "glikojen",
      "su",
      "yağsız kütle",
      "kas kütlesi",
      "body weight",
    ],
    aliases: [
      "kilo aldım kas mı yağ mı",
      "tartıda kilo arttı kas mı",
      "kilom neden dalgalanıyor",
      "kilo kas kazandığımı gösterir mi",
      "tartı kas gelişimini gösterir mi",
      "does body weight show muscle gain",
    ],
    sourceIds: ["orsama-2014-weight-rhythm", "kreitzman-1992-glycogen", "hall-2008-weight-loss"],
    sourcesCheckedOn: CHECKED,
  },
];
